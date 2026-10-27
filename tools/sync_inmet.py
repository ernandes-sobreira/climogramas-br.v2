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

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--years",nargs="+",type=int,default=[dt.date.today().year])
    args=ap.parse_args()
    stations_path=ASSETS/"stations.json"
    stations=json.loads(stations_path.read_text(encoding="utf8"))
    catalog={s["id"]:s for s in stations}
    successes=[]
    for year in args.years:
        if year<2000 or year>dt.datetime.now(dt.timezone.utc).year: raise ValueError("Ano inválido")
        raw=download(year)
        sha=hashlib.sha256(raw).hexdigest()
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
                                "note":"Cobertura calculada por horas observadas; totais de chuva com lacunas não representam totais completos."}
            payload["provenance"]={"source":URL.format(year=year),"zip_sha256":sha,
                                    "processed_utc":dt.datetime.now(dt.timezone.utc).isoformat()}
            directory=ASSETS/"data"/code
            directory.mkdir(parents=True,exist_ok=True)
            (directory/f"{year}.json").write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8")
            rec=catalog.setdefault(code,{"id":code,"years":[]})
            for key in ("name","uf","lat","lon","alt"):
                if not rec.get(key) and metas[code].get(key) is not None:rec[key]=metas[code][key]
            rec["years"]=sorted(set(rec.get("years",[]))|{year})
            outcount+=1
        successes.append({"year":year,"stations":outcount,"skipped_files":bad,"source_sha256":sha})
    stations_path.write_text(json.dumps(sorted(catalog.values(),key=lambda s:(s.get("uf") or "",s.get("name") or s["id"])),ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8")
    (ASSETS/"years.json").write_text(json.dumps({"years":sorted({y for s in catalog.values() for y in s.get("years",[])})})+"\n",encoding="utf8")
    (ASSETS/"inmet-update-status.json").write_text(json.dumps({"updated_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"years":successes},ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(json.dumps(successes,ensure_ascii=False))
if __name__=="__main__":main()
