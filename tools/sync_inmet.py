#!/usr/bin/env python3
"""Atualiza estações automáticas do INMET a partir dos ZIPs anuais oficiais.
Preserva histórico, adiciona estações, publica estatísticas com cobertura por variável.
Uso: python tools/sync_inmet.py --years 2025 2026
"""
import argparse
import calendar
import datetime as dt
import hashlib
import importlib.util
import io
import json
import math
import pathlib
import re
import urllib.request
import zipfile
import copy
import os
import tempfile
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
spec = importlib.util.spec_from_file_location("legacy_inmet", ROOT/"tools"/"build_all_years_inmet.py")
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
# INMET altera o formato de data entre séries: incluir AAAA/MM/DD.
_orig_parse = legacy.parse_date_time
def parse_date_time(date_str, hour_str):
    cleaned = str(date_str).strip()
    if re.fullmatch(r"\d{4}/\d{2}/\d{2}", cleaned):
        cleaned = cleaned.replace("/", "-")
    return _orig_parse(cleaned, hour_str)
legacy.parse_date_time = parse_date_time
URL = "https://portal.inmet.gov.br/uploads/dadoshistoricos/{year}.zip"
CODE_RE = re.compile(r"^[A-Z]\d{3,4}$")

def download(year):
    req = urllib.request.Request(URL.format(year=year), headers={"User-Agent":"ClimogramasBR-UNEMAT/1.0 (public academic analysis)"})
    with urllib.request.urlopen(req, timeout=180) as response:
        data = response.read(320_000_001)
    if len(data)>320_000_000 or not zipfile.is_zipfile(io.BytesIO(data)):
        raise RuntimeError(f"Pacote {year} inválido ou excessivamente grande")
    return data

def coverage(rows,year):
    count = defaultdict(lambda:defaultdict(set))
    for r in rows:
        t=r["dt"]
        if t.year != year: continue
        for k in ("temp","prec","rh","press","rad","wind"):
            if r.get(k) is not None and math.isfinite(r[k]):
                count[t.month][k].add(t.strftime("%Y-%m-%dT%H:%M"))
    result={}
    today=dt.datetime.now(dt.timezone.utc).date()
    for month in range(1,13):
        last=calendar.monthrange(year,month)[1]
        end=dt.date(year,month,last)
        if dt.date(year,month,1)>today:
            expected=0
        else:
            expected= (min(end,today)-dt.date(year,month,1)).days*24+24
        result[str(month)]={k:{"valid_hours":len(count[month][k]),"expected_hours":expected,
                              "coverage_pct":round(min(100,100*len(count[month][k])/expected),1) if expected else None}
                            for k in ("temp","prec","rh","press","rad","wind")}
    return result

def station_code(meta, filename):
    # Nomes INMET usam _A001_ ou _A001_...; \b não funciona junto a underscores.
    raw = str(meta.get("id") or "").strip().upper()
    m = re.search(r"(?<![A-Z0-9])([A-Z][0-9]{3,4})(?![A-Z0-9])", raw)
    if m: return m.group(1)
    m = re.search(r"(?:^|_)([A-Z][0-9]{3,4})(?:_|\\.|$)", pathlib.Path(filename).name.upper())
    return m.group(1) if m else None

def process_year(year,raw,sha,catalog,output_assets,checked_utc):
    grouped=defaultdict(list)
    metas={}
    bad=0
    failure_examples=[]
    zip_csv_count=0
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for entry in z.infolist():
            if not entry.filename.lower().endswith(".csv") or entry.file_size>35_000_000:continue
            zip_csv_count+=1
            try:
                # O leitor legado recebe caminho em disco; diretório temporário isolado.
                import tempfile
                with tempfile.TemporaryDirectory() as tmp:
                    dest=pathlib.Path(tmp)/"estacao.csv"
                    dest.write_bytes(z.read(entry))
                    meta,rows=legacy.read_inmet_csv(str(dest))
                code=station_code(meta,entry.filename)
                if not code or not CODE_RE.fullmatch(code):
                    if len(failure_examples)<5: failure_examples.append({"file":entry.filename,"error":"station_code_unrecognized","meta_id":meta.get("id")})
                    continue
                grouped[code].extend(r for r in rows if r["dt"].year==year)
                metas.setdefault(code,meta)
            except Exception as exc:
                bad+=1
                if len(failure_examples)<5: failure_examples.append({"file":entry.filename,"error":type(exc).__name__,"message":str(exc)[:160]})
    print(json.dumps({"year":year,"zip_csv_files":zip_csv_count,"station_count":len(grouped),"invalid_files":bad,"examples":failure_examples},ensure_ascii=False),flush=True)
    if not grouped:raise RuntimeError(f"Nenhuma estação aproveitável no arquivo {year}; consultar exemplos acima")
    outcount=0
    for code,rows in grouped.items():
        if not rows:continue
        # Releituras sobrepostas: a última ocorrência não deve duplicar a hora.
        dedup={r["dt"]:r for r in rows}
        rows=sorted(dedup.values(),key=lambda r:r["dt"])
        payload=legacy.build_year_json(metas[code],code,year,rows)
        # Adaptar o formato do pipeline ao contrato já usado pelo front-end.
        # Não somar precipitação horária como "total mensal" com cobertura insuficiente.
        qc=coverage(rows,year)
        for month in payload["months"]:
            key=str(month["m"])
            ctemp=qc[key]["temp"]["coverage_pct"]
            cprec=qc[key]["prec"]["coverage_pct"]
            month["tmean"]=month.get("tmean_c") if ctemp is not None and ctemp>=90 else None
            month["tmin"]=month.get("tmin_c") if ctemp is not None and ctemp>=90 else None
            month["tmax"]=month.get("tmax_c") if ctemp is not None and ctemp>=90 else None
            month["p"]=month.get("prec_mm") if cprec is not None and cprec>=90 else None
        payload["annual"]["tmean"]=payload["annual"].get("tmean_c")
        payload["annual"]["p_total"]=sum(m["p"] for m in payload["months"] if m["p"] is not None) if sum(m["p"] is not None for m in payload["months"])==12 else None
        payload["annual"]["coverage"]=round(sum(1 for m in payload["months"] if m["tmean"] is not None)/12,3)
        payload["quality"]={"status":"provisional" if year==dt.date.today().year else "archive",
                            "monthly_hourly_coverage":qc,
                            "coverage_as_of_utc":checked_utc,
                            "note":"Cobertura calculada por horas observadas; totais de chuva com lacunas não representam totais completos."}
        payload["provenance"]={"source":URL.format(year=year),"zip_sha256":sha,
                                "processed_utc":checked_utc,"last_observation_raw":rows[-1]["dt"].isoformat()}
        directory=output_assets/"data"/code
        directory.mkdir(parents=True,exist_ok=True)
        (directory/f"{year}.json").write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8")
        rec=catalog.setdefault(code,{"id":code,"years":[]})
        for key in ("name","uf","lat","lon","alt"):
            if not rec.get(key) and metas[code].get(key) is not None:rec[key]=metas[code][key]
            if key in ("name","uf") and isinstance(rec.get(key),str):rec[key]=rec[key].lstrip(";").strip()
        rec["years"]=sorted(set(rec.get("years",[]))|{year})
        outcount+=1

    if not outcount:raise RuntimeError(f"Nenhuma estação com observações no ano {year}")
    return {"year":year,"stations":outcount,"skipped_files":bad,"source_sha256":sha}

class RegressionError(RuntimeError):
    def __init__(self,details):
        super().__init__("regression_preserved");self.details=details

def regression_reasons(previous,candidate):
    reasons=[]
    oldqc=previous.get("quality",{}).get("monthly_hourly_coverage",{})
    newqc=candidate.get("quality",{}).get("monthly_hourly_coverage",{})
    for month,variables in oldqc.items():
        for variable,meta in variables.items():
            old=meta.get("valid_hours",0) or 0
            new=newqc.get(month,{}).get(variable,{}).get("valid_hours",0) or 0
            # Quarantine an entire lost month or a reduction >5% (minimum24h).
            if old>0 and (new==0 or old-new>max(24,old*.05)):
                reasons.append({"month":month,"variable":variable,"previous_hours":old,"candidate_hours":new})
    old_last=previous.get("provenance",{}).get("last_observation_raw")
    new_last=candidate.get("provenance",{}).get("last_observation_raw")
    if old_last and new_last and new_last<old_last:reasons.append({"last_observation_regressed":True})
    return reasons

def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def write_if_changed(path, payload, pretty=False):
    text=json.dumps(payload,ensure_ascii=False,indent=2 if pretty else None,separators=None if pretty else (",",":"))+"\n"
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists() and path.read_text(encoding="utf8")==text:return False
    temp=path.with_suffix(path.suffix+".tmp")
    temp.write_text(text,encoding="utf8")
    os.replace(temp,path)
    return True

def sync_years(years, force=False):
    stations_path=ASSETS/"stations.json"
    catalog={s["id"]:s for s in json.loads(stations_path.read_text(encoding="utf8"))}
    status_path=ASSETS/"inmet-update-status.json"
    old=json.loads(status_path.read_text(encoding="utf8")) if status_path.exists() else {}
    status=copy.deepcopy(old)
    entries={int(x["year"]):x for x in old.get("years",[])}
    last_success=old.get("last_success_utc") or old.get("updated_utc")
    failed=[];changed=False
    for year in sorted(set(years)):
        if year<2000 or year>dt.datetime.now(dt.timezone.utc).year:raise ValueError("Ano inválido")
        checked=utcnow();previous=entries.get(year,{"year":year})
        entry=copy.deepcopy(previous)
        entry.setdefault("processed_utc",previous.get("processed_utc") or old.get("updated_utc"))
        entry.setdefault("last_success_utc",previous.get("last_success_utc") or old.get("updated_utc"))
        entry["checked_utc"]=checked
        try:
            raw=download(year)
            sha=hashlib.sha256(raw).hexdigest()
            # The hash was stored only after a full successful processing/publication.
            # If unchanged, skip CSV expansion, statistics and station-file rewrites.
            if not force and sha==previous.get("rejected_source_sha256"):
                raise RegressionError(previous.get("regressions",[]))
            if not force and sha==previous.get("source_sha256"):
                entry.update(status="unchanged",last_check_ok=True,last_success_utc=checked)
            else:
                staged_catalog=copy.deepcopy(catalog)
                with tempfile.TemporaryDirectory(prefix="inmet-stage-") as tmp:
                    stage=pathlib.Path(tmp)
                    info=process_year(year,raw,sha,staged_catalog,stage,checked)
                    # Processing errors cannot replace any existing station file.
                    # Validate the complete candidate before promoting files.
                    files=list((stage/"data").glob(f"*/{year}.json"))
                    if len(files)!=info["stations"]:raise RuntimeError("Contagem de arquivos inconsistente")
                    for file in files:
                        data=json.loads(file.read_text(encoding="utf8"))
                        if len(data.get("months",[]))!=12 or "quality" not in data:raise RuntimeError("JSON de estação inválido")
                    regressions=[]
                    candidates={file.parent.name:file for file in files}
                    for target in (ASSETS/"data").glob(f"*/{year}.json"):
                        code=target.parent.name
                        if code not in candidates:
                            regressions.append({"station":code,"missing_from_candidate":True});continue
                        previous_data=json.loads(target.read_text(encoding="utf8"))
                        candidate=json.loads(candidates[code].read_text(encoding="utf8"))
                        reasons=regression_reasons(previous_data,candidate)
                        if reasons:regressions.append({"station":code,"reasons":reasons})
                    if regressions:raise RegressionError(regressions)
                    for file in files:
                        target=ASSETS/file.relative_to(stage)
                        write_if_changed(target,json.loads(file.read_text(encoding="utf8")))
                catalog=staged_catalog;changed=True
                entry.update(info,status="updated",last_check_ok=True,processed_utc=checked,last_success_utc=checked)
                status["updated_utc"]=checked
            entry.pop("error",None)
            entry.pop("rejected_source_sha256",None);entry.pop("regressions",None)
            last_success=checked
        except Exception as exc:
            # Keep previous source SHA, data, processed time and last successful check.
            entry.update(status="error",last_check_ok=False,error=type(exc).__name__)
            if isinstance(exc,RegressionError):entry.update(status="regression_preserved",rejected_source_sha256=sha,regressions=exc.details)
            failed.append(year)
            print(json.dumps({"year":year,"status":"error","error":type(exc).__name__}),flush=True)
        entries[year]=entry
    if changed:
        write_if_changed(stations_path,sorted(catalog.values(),key=lambda x:(x.get("uf") or "",x.get("name") or x["id"])))
        write_if_changed(ASSETS/"years.json",{"years":sorted({y for x in catalog.values() for y in x.get("years",[])})})
    status.update(checked_utc=utcnow(),last_success_utc=last_success,status="error" if failed else "ok",years=[entries[y] for y in sorted(entries)])
    write_if_changed(status_path,status,pretty=True)
    return failed

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--years",nargs="+",type=int,default=[dt.datetime.now(dt.timezone.utc).year])
    ap.add_argument("--force",action="store_true",help="Reprocessar mesmo SHA (mudança de algoritmo ou auditoria explícita)")
    args=ap.parse_args()
    failed=sync_years(args.years,args.force)
    if failed:raise SystemExit(1)

if __name__=="__main__":main()
