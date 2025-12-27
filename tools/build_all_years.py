# tools/build_all_years.py
# Gera assets/data/<stationId>/<year>.json para todos os anos e atualiza:
# - assets/stations.json (campo years por estação)
# - assets/years.json (lista geral de anos disponíveis)
#
# Espera pastas assim:
# raw/estacoes.2000/*.csv
# raw/estacoes.2001/*.csv
# ...
#
# Compatível com nomes de arquivo tipo:
# INMET_CO_DF_A001_BRASILIA_01-01-2020_A_31-12-2020.csv

import argparse
import json
import os
import re
from pathlib import Path
from datetime import datetime

def norm_col(s: str) -> str:
    s = (s or "").strip().lower()
    # normaliza acentos mais comuns (sem depender de libs)
    mapa = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüç", "aaaaaeeeeiiiiooooouuuuc")
    s = s.translate(mapa)
    s = re.sub(r"[\s\-\/]+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "", s)
    return s

def try_parse_date(x: str):
    x = (x or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(x, fmt)
        except:
            pass
    return None

def find_header_line(lines):
    # acha a linha do cabeçalho de dados (tem DATA)
    for i, ln in enumerate(lines[:80]):  # normalmente está no começo
        if "DATA" in ln.upper():
            return i
    return None

def detect_sep(sample_line: str) -> str:
    # INMET costuma ser ; (pt-BR)
    if sample_line.count(";") >= sample_line.count(","):
        return ";"
    return ","

def pick_columns(header_cols):
    cols_norm = [norm_col(c) for c in header_cols]

    # coluna de data
    date_idx = None
    for i, c in enumerate(cols_norm):
        if c in ("data", "date"):
            date_idx = i
            break
    if date_idx is None:
        # tenta achar algo que contenha data
        for i, c in enumerate(cols_norm):
            if "data" in c:
                date_idx = i
                break

    # precipitação total do dia
    p_idx = None
    for i, c in enumerate(cols_norm):
        if "precip" in c and ("total" in c or "mm" in c):
            p_idx = i
            break
    if p_idx is None:
        for i, c in enumerate(cols_norm):
            if "precip" in c:
                p_idx = i
                break

    # temperatura média do dia
    t_idx = None
    for i, c in enumerate(cols_norm):
        # pega "temp" e "media" (ou "tmedia")
        if ("temp" in c or c.startswith("t_") or c.startswith("tmedia") or "temperatura" in c) and ("media" in c or "mean" in c):
            t_idx = i
            break
    if t_idx is None:
        # fallback: primeira coluna que tenha temp
        for i, c in enumerate(cols_norm):
            if "temp" in c or "temperatura" in c:
                t_idx = i
                break

    return date_idx, t_idx, p_idx

def parse_number_ptbr(x: str):
    if x is None:
        return None
    s = str(x).strip()
    if s == "" or s.upper() in ("NA", "N/A", "NULL"):
        return None
    # normaliza decimal vírgula
    s = s.replace(".", "").replace(",", ".") if (s.count(",") == 1 and s.count(".") >= 1) else s.replace(",", ".")
    # remove lixo
    s = re.sub(r"[^0-9\.\-]+", "", s)
    if s in ("", "-", ".", "-."):
        return None
    try:
        v = float(s)
        # INMET às vezes usa -9999
        if v <= -999:
            return None
        return v
    except:
        return None

def station_id_from_filename(fname: str):
    s = fname.upper()
    # pega A001 mesmo quando vem colado em "_" (ex: _A001_)
    m = re.search(r"(?:^|_)A\d{3}(?:_|\.|$)", s)
    if m:
        return re.search(r"A\d{3}", m.group(0)).group(0)

    # fallback mais permissivo
    m2 = re.search(r"A\d{3}", s)
    return m2.group(0) if m2 else None

def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def build_monthly(daily_rows):
    # daily_rows: lista de (date, tmean, precip)
    by_month = {m: {"t": [], "p": []} for m in range(1, 13)}
    for dt, t, p in daily_rows:
        m = dt.month
        if t is not None:
            by_month[m]["t"].append(t)
        if p is not None:
            by_month[m]["p"].append(p)

    months = []
    for m in range(1, 13):
        tvals = by_month[m]["t"]
        pvals = by_month[m]["p"]
        tmean = sum(tvals)/len(tvals) if tvals else None
        ptotal = sum(pvals) if pvals else None
        months.append({"m": m, "tmean": tmean, "p": ptotal})
    return months

def compute_annual(months):
    t_list = [x["tmean"] for x in months if x["tmean"] is not None]
    p_list = [x["p"] for x in months if x["p"] is not None]

    annual = {}
    annual["tmin"] = min(t_list) if t_list else None
    annual["tmax"] = max(t_list) if t_list else None
    annual["tmean"] = (sum(t_list)/len(t_list)) if t_list else None

    annual["p_total"] = sum(p_list) if p_list else None
    annual["p_month_min"] = min(p_list) if p_list else None
    annual["p_month_max"] = max(p_list) if p_list else None
    annual["p_month_mean"] = (sum(p_list)/len(p_list)) if p_list else None
    return annual

def read_inmet_csv(path: Path):
    # lê como texto primeiro para achar cabeçalho
    raw = path.read_text(encoding="latin-1", errors="ignore").splitlines()
    hline = find_header_line(raw)
    if hline is None:
        return None  # não parece ter tabela
    sep = detect_sep(raw[hline])

    header = [c.strip() for c in raw[hline].split(sep)]
    date_idx, t_idx, p_idx = pick_columns(header)
    if date_idx is None:
        return None

    daily = []
    for ln in raw[hline+1:]:
        if not ln.strip():
            continue
        parts = [p.strip() for p in ln.split(sep)]
        if len(parts) <= date_idx:
            continue

        dt = try_parse_date(parts[date_idx])
        if not dt:
            continue

        t = parse_number_ptbr(parts[t_idx]) if (t_idx is not None and t_idx < len(parts)) else None
        p = parse_number_ptbr(parts[p_idx]) if (p_idx is not None and p_idx < len(parts)) else None
        daily.append((dt, t, p))

    return daily

def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def save_json(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="Pasta raw (onde tem estacoes.AAAA)")
    ap.add_argument("--out", required=True, help="Pasta de saída (assets/data)")
    ap.add_argument("--stations", required=True, help="assets/stations.json (atualiza years)")
    ap.add_argument("--years", required=True, help="assets/years.json (gera lista geral)")
    ap.add_argument("--start", type=int, required=True)
    ap.add_argument("--end", type=int, required=True)
    args = ap.parse_args()

    raw_dir = Path(args.raw).resolve()
    out_dir = Path(args.out).resolve()
    stations_path = Path(args.stations).resolve()
    years_path = Path(args.years).resolve()

    stations = load_json(stations_path, default=[])
    # mapa id -> objeto estação
    by_id = { (s.get("id") or "").upper(): s for s in stations if isinstance(s, dict) and s.get("id") }

    built_years = set()
    total_files_written = 0

    for year in range(args.start, args.end + 1):
        ydir = raw_dir / f"estacoes.{year}"
        if not ydir.exists():
            print(f"[year {year}] pasta não existe: {ydir}")
            continue

        files = []
        for ext in ("*.csv", "*.CSV", "*.txt", "*.TXT"):
            files.extend(list(ydir.glob(ext)))

        print(f"[year {year}] arquivos encontrados: {len(files)} em {ydir}")

        wrote_this_year = 0

        for f in files:
            sid = station_id_from_filename(f.name)
            if not sid:
                continue

            daily = read_inmet_csv(f)
            if not daily:
                continue

            months = build_monthly(daily)
            annual = compute_annual(months)

            payload = {
                "station": sid,
                "year": year,
                "months": months,
                "annual": annual
            }

            target_dir = out_dir / sid
            ensure_dir(target_dir)
            target_file = target_dir / f"{year}.json"
            save_json(target_file, payload)

            wrote_this_year += 1
            total_files_written += 1
            built_years.add(year)

            # atualiza years da estação (sem destruir outras infos)
            st = by_id.get(sid)
            if st is None:
                st = {"id": sid, "name": sid, "uf": "", "lat": None, "lon": None, "alt": None, "years": []}
                stations.append(st)
                by_id[sid] = st

            ylist = st.get("years") if isinstance(st.get("years"), list) else []
            yset = set(int(x) for x in ylist if isinstance(x, (int, float, str)) and str(x).isdigit())
            yset.add(year)
            st["years"] = sorted(yset)

        print(f"[year {year}] gerado: {wrote_this_year} estações")
        if wrote_this_year > 0:
            built_years.add(year)

    # salva stations.json (com years)
    # opcional: ordenar por UF+name se existir
    def sort_key(s):
        return f"{(s.get('uf') or '')}{(s.get('name') or '')}".lower()
    stations_sorted = sorted(stations, key=sort_key)
    save_json(stations_path, stations_sorted)

    # salva years.json
    years_sorted = sorted(built_years, reverse=True)
    save_json(years_path, years_sorted)

    print(f"\nTOTAL gerado: {total_files_written} arquivos station/year")
    print(f"ANOS encontrados: {years_sorted}")
    print("OK ✅")

if __name__ == "__main__":
    main()
