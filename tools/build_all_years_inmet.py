# -*- coding: utf-8 -*-
"""
Build INMET CSV -> assets/data/<STATION_ID>/<YEAR>.json
Robusto a variações de cabeçalho/colunas do INMET.

Uso (exemplo):
  py build_all_years_inmet.py --raw ..\\raw --out ..\\assets\\data --stations ..\\assets\\stations.json --years ..\\assets\\years.json --start 2000 --end 2024
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from datetime import datetime
from collections import defaultdict

# ---------------- helpers ----------------

def safe_float(x: str):
    if x is None:
        return None
    s = str(x).strip()
    if not s:
        return None
    s = s.replace("\ufeff", "")
    s = s.replace(",", ".")
    # remove "UTC", "hPa", etc
    s = re.sub(r"[^\d\.\-\+]", "", s)
    if not s or s in {".", "-", "+", "+.", "-."}:
        return None
    try:
        return float(s)
    except:
        return None

def safe_int(x: str):
    f = safe_float(x)
    if f is None:
        return None
    try:
        return int(round(f))
    except:
        return None

def clean_text(x: str):
    if x is None:
        return ""
    return str(x).strip().replace("\ufeff", "")

def norm_key(s: str) -> str:
    s = clean_text(s).upper()
    s = s.replace("Á","A").replace("À","A").replace("Ã","A").replace("Â","A")
    s = s.replace("É","E").replace("Ê","E")
    s = s.replace("Í","I")
    s = s.replace("Ó","O").replace("Õ","O").replace("Ô","O")
    s = s.replace("Ú","U")
    s = s.replace("Ç","C")
    s = re.sub(r"[\(\)\[\]\{\}]", " ", s)
    s = re.sub(r"[^A-Z0-9/ ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def parse_date_time(date_str: str, hour_str: str):
    d = clean_text(date_str)
    h = clean_text(hour_str)

    # hour: "0000 UTC", "00:00", "0000"
    h = h.replace("UTC", "").strip()
    h = h.replace(":", "")
    if len(h) == 1: h = "0"+h
    if len(h) == 2: h = h + "00"
    if len(h) >= 4:
        hh = int(h[:2])
        mm = int(h[2:4])
    else:
        hh, mm = 0, 0

    # date: "YYYY-MM-DD" or "DD/MM/YYYY"
    dt = None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            dt0 = datetime.strptime(d, fmt)
            dt = dt0.replace(hour=hh, minute=mm)
            break
        except:
            continue
    return dt

# --------------- INMET column mapping ---------------

def map_columns(headers: list[str]) -> dict[str, int]:
    """Return index mapping for target variables based on header names."""
    mapped = {}

    # Normalize
    H = [norm_key(h) for h in headers]

    def find_one(patterns):
        for p in patterns:
            rp = re.compile(p)
            for i, hh in enumerate(H):
                if rp.search(hh):
                    return i
        return None

    # Required-ish
    mapped["date"] = find_one([r"^DATA", r"DATA YYYY", r"DATA YYYY-MM-DD"])
    mapped["hour"] = find_one([r"HORA", r"HORA UTC"])

    # Precipitation hourly (mm) => monthly sum
    mapped["prec"] = find_one([
        r"PRECIPITACAO.*HORAR", r"PRECIPITACAO TOTAL.*HORAR", r"PRECIPITACAO TOTAL HORARIO",
        r"PRECIPITACAO.*\(MM\)", r"CHUVA.*HORAR"
    ])

    # Air temperature (bulbo seco) hourly
    mapped["temp"] = find_one([
        r"TEMPERATURA DO AR.*BULBO SECO.*HORAR",
        r"TEMPERATURA DO AR.*HORAR",
        r"TEMPERATURA.*BULBO SECO"
    ])

    # Extra variables (monthly means)
    mapped["rh"] = find_one([r"UMIDADE RELATIVA", r"UMIDADE"])
    mapped["press"] = find_one([r"PRESSAO ATMOSFERICA AO NIVEL", r"PRESSAO ATMOSFERICA", r"PRESSAO"])
    mapped["rad"] = find_one([r"RADIACAO GLOBAL", r"RADIACAO"])
    mapped["wind"] = find_one([r"VENTO.*VELOC", r"VELOCIDADE HORARIA", r"VENTO"])

    return mapped

# --------------- CSV parsing ---------------

def read_inmet_csv(path: str):
    """
    Returns: meta(dict), rows(list[dict])
    meta from first lines; data from table
    """
    meta = {
        "id": None, "name": None, "uf": None, "region": None,
        "lat": None, "lon": None, "alt": None
    }

    # INMET files are often Latin-1; try utf-8 then fallback.
    encodings = ["utf-8", "latin-1"]
    content = None
    for enc in encodings:
        try:
            with open(path, "r", encoding=enc, errors="replace") as f:
                content = f.read().splitlines()
            break
        except:
            continue
    if content is None:
        raise RuntimeError(f"Não consegui ler {path}")

    # Find metadata lines before header row
    header_line_idx = None
    sep = ";"  # INMET generally uses ';'
    for i, line in enumerate(content[:60]):
        if "DATA" in line.upper() and "HORA" in line.upper():
            header_line_idx = i
            break

        # meta pattern: "UF: DF" etc
        if ":" in line:
            k, v = line.split(":", 1)
            kk = norm_key(k)
            vv = clean_text(v)
            if "REGIAO" in kk:
                meta["region"] = vv
            elif kk == "UF":
                meta["uf"] = vv
            elif "ESTACAO" in kk:
                meta["name"] = vv
            elif "CODIGO" in kk:
                # e.g. "CODIGO (WMO): A001"
                meta["id"] = vv.strip()
            elif "LATITUDE" in kk:
                meta["lat"] = safe_float(vv)
            elif "LONGITUDE" in kk:
                meta["lon"] = safe_float(vv)
            elif "ALTITUDE" in kk:
                meta["alt"] = safe_float(vv)

    if header_line_idx is None:
        # fallback: try csv sniff
        raise RuntimeError(f"Não encontrei cabeçalho de tabela (DATA/HORA) em {path}")

    # Parse table using csv module from header_line_idx
    table_lines = content[header_line_idx:]
    reader = csv.reader(table_lines, delimiter=sep)
    headers = next(reader)
    headers = [clean_text(h) for h in headers]
    col = map_columns(headers)

    if col.get("date") is None or col.get("hour") is None:
        raise RuntimeError(f"Não identifiquei colunas DATA/HORA em {path}")

    rows = []
    for parts in reader:
        if not parts or len(parts) < 2:
            continue

        dt = parse_date_time(parts[col["date"]], parts[col["hour"]])
        if dt is None:
            continue

        def getv(key):
            idx = col.get(key)
            if idx is None or idx >= len(parts):
                return None
            v = safe_float(parts[idx])
            if v is None:
                return None
            # INMET uses -9999 to indicate missing
            if v <= -9000:
                return None
            return v

        r = {
            "dt": dt,
            "prec": getv("prec"),
            "temp": getv("temp"),
            "rh": getv("rh"),
            "press": getv("press"),
            "rad": getv("rad"),
            "wind": getv("wind"),
        }
        rows.append(r)

    return meta, rows

# --------------- Aggregation ---------------

def aggregate_monthly(rows):
    # Month buckets 1..12
    m = {i: {"prec": [], "temp": [], "rh": [], "press": [], "rad": [], "wind": []} for i in range(1,13)}
    for r in rows:
        mm = r["dt"].month
        for k in ["prec","temp","rh","press","rad","wind"]:
            if r[k] is not None:
                m[mm][k].append(r[k])

    months = []
    for i in range(1,13):
        prec = m[i]["prec"]
        temp = m[i]["temp"]

        # precip monthly is SUM of hourly precipitation
        prec_mm = sum(prec) if prec else None

        # temperature: mean/min/max from hourly
        tmean = (sum(temp)/len(temp)) if temp else None
        tmin = (min(temp)) if temp else None
        tmax = (max(temp)) if temp else None

        def mean_or_none(arr):
            return (sum(arr)/len(arr)) if arr else None

        months.append({
            "m": i,
            "prec_mm": prec_mm,
            "tmean_c": tmean,
            "tmin_c": tmin,
            "tmax_c": tmax,
            "extras": {
                "rh": mean_or_none(m[i]["rh"]),
                "press": mean_or_none(m[i]["press"]),
                "rad": mean_or_none(m[i]["rad"]),
                "wind": mean_or_none(m[i]["wind"]),
            }
        })
    return months

def build_year_json(meta, station_id: str, year: int, rows):
    months = aggregate_monthly(rows)

    # annual metrics
    all_temp = [r["temp"] for r in rows if r["temp"] is not None]
    all_prec = [r["prec"] for r in rows if r["prec"] is not None]

    annual = {
        "prec_total_mm": sum(all_prec) if all_prec else None,
        "tmean_c": (sum(all_temp)/len(all_temp)) if all_temp else None,
        "tmin_c": min(all_temp) if all_temp else None,
        "tmax_c": max(all_temp) if all_temp else None,
    }

    # extras months arrays
    vars_block = {}
    for k in ["rh","press","rad","wind"]:
        arr = [m["extras"][k] for m in months]
        if any(v is not None for v in arr):
            vars_block[k] = {"months": arr}

    # Flatten months: move extras -> vars_block already
    months_out = []
    for m in months:
        months_out.append({
            "m": m["m"],
            "prec_mm": m["prec_mm"],
            "tmean_c": m["tmean_c"],
            "tmin_c": m["tmin_c"],
            "tmax_c": m["tmax_c"],
        })

    return {
        "meta": {
            "id": station_id,
            "name": meta.get("name"),
            "uf": meta.get("uf"),
            "region": meta.get("region"),
            "lat": meta.get("lat"),
            "lon": meta.get("lon"),
            "alt": meta.get("alt"),
            "source": "INMET"
        },
        "year": year,
        "months": months_out,
        "annual": annual,
        "vars": vars_block
    }

# --------------- Main build loop ---------------

def ensure_dir(p):
    os.makedirs(p, exist_ok=True)

def list_csvs(folder):
    out = []
    for root, _, files in os.walk(folder):
        for fn in files:
            if fn.lower().endswith(".csv"):
                out.append(os.path.join(root, fn))
    return out

def extract_station_id(meta, filename):
    # Priority: meta code
    sid = clean_text(meta.get("id") or "")
    if sid:
        return sid

    # Fallback: try filename patterns like "_A001_" or "A001"
    base = os.path.basename(filename).upper()
    m = re.search(r"\b[A-Z]\d{3}\b", base)
    if m:
        return m.group(0)
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="pasta raw (ex: ..\\raw)")
    ap.add_argument("--out", required=True, help="pasta assets/data (ex: ..\\assets\\data)")
    ap.add_argument("--stations", required=True, help="assets/stations.json")
    ap.add_argument("--years", required=True, help="assets/years.json")
    ap.add_argument("--start", type=int, required=True)
    ap.add_argument("--end", type=int, required=True)
    args = ap.parse_args()

    # Load stations.json (we will update with years list)
    if os.path.exists(args.stations):
        with open(args.stations, "r", encoding="utf-8") as f:
            st_obj = json.load(f)
        stations = st_obj if isinstance(st_obj, list) else st_obj.get("stations", [])
    else:
        stations = []

    by_id = {str((s.get("id") or s.get("ID") or s.get("codigo") or "")): s for s in stations if (s.get("id") or s.get("ID") or s.get("codigo"))}

    years_found_global = set()
    station_years = defaultdict(set)

    total_generated = 0

    for year in range(args.start, args.end + 1):
        folder = os.path.join(args.raw, f"estacoes.{year}")
        if not os.path.isdir(folder):
            print(f"[year {year}] pasta não existe: {folder}")
            continue

        csvs = list_csvs(folder)
        print(f"[year {year}] arquivos encontrados: {len(csvs)} em {folder}")

        # group by station id (some stations may have multiple files per year)
        grouped = defaultdict(list)
        meta_cache = {}

        for path in csvs:
            try:
                meta, rows = read_inmet_csv(path)
                sid = extract_station_id(meta, path)
                if not sid:
                    continue
                grouped[sid].append((meta, rows, path))
            except Exception as e:
                # não mata o build inteiro
                print(f"  ! erro lendo {os.path.basename(path)}: {e}")

        for sid, parts in grouped.items():
            # merge rows
            all_rows = []
            meta_best = None
            for meta, rows, _ in parts:
                all_rows.extend(rows)
                if meta_best is None:
                    meta_best = meta

            if not all_rows:
                continue

            # keep only this year rows (proteção)
            all_rows = [r for r in all_rows if r["dt"].year == year]
            if not all_rows:
                continue

            out_dir = os.path.join(args.out, sid)
            ensure_dir(out_dir)

            out_path = os.path.join(out_dir, f"{year}.json")
            data = build_year_json(meta_best or {}, sid, year, all_rows)

            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)

            total_generated += 1
            years_found_global.add(year)
            station_years[sid].add(year)

            # update stations list record (lat/lon/name if missing)
            if sid not in by_id:
                by_id[sid] = {"id": sid}

            rec = by_id[sid]
            if rec.get("name") is None and data["meta"].get("name"):
                rec["name"] = data["meta"]["name"]
            if rec.get("uf") is None and data["meta"].get("uf"):
                rec["uf"] = data["meta"]["uf"]
            if rec.get("lat") is None and data["meta"].get("lat") is not None:
                rec["lat"] = data["meta"]["lat"]
            if rec.get("lon") is None and data["meta"].get("lon") is not None:
                rec["lon"] = data["meta"]["lon"]

    # Rebuild stations.json as array
    stations_out = list(by_id.values())
    # attach years per station
    for s in stations_out:
        sid = str(s.get("id") or "")
        if sid and sid in station_years:
            s["years"] = sorted(station_years[sid])

    stations_out.sort(key=lambda x: str(x.get("name") or x.get("id") or ""))

    with open(args.stations, "w", encoding="utf-8") as f:
        json.dump(stations_out, f, ensure_ascii=False)

    years_out = sorted(list(years_found_global))
    with open(args.years, "w", encoding="utf-8") as f:
        json.dump(years_out, f, ensure_ascii=False)

    print("\nTOTAL station/year gerados:", total_generated)
    print("ANOS encontrados:", years_out)
    print("ESTAÇÕES:", len(stations_out))
    print("FIM")

if __name__ == "__main__":
    main()
