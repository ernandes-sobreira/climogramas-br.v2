# build_all_years_inmet.py
# Gera JSONs por estação/ano para o app (assets/data/<ID>/<ANO>.json)
# e atualiza:
# - assets/stations.json (lista de estações + anos disponíveis por estação)
# - assets/years.json (lista de anos existentes no dataset gerado)
#
# Uso (Windows):
#   cd C:\Users\User\Documents\climogramas-br\tools
#   py build_all_years_inmet.py --raw ..\raw --out ..\assets\data --stations ..\assets\stations.json --years ..\assets\years.json --start 2000 --end 2024
#
# Estrutura de entrada (RAW):
#   raw/estacoes.2000/*.CSV
#   raw/estacoes.2001/*.CSV
#   ...
#
# Observação: o script tenta ser tolerante a variações de cabeçalho do INMET.

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any


# -------------------------
# Helpers
# -------------------------

def log(msg: str) -> None:
    print(msg, flush=True)


def num_pt(s: str) -> Optional[float]:
    """Converte número pt-BR para float (ex: '1.234,5' -> 1234.5).
    Retorna None para vazio/invalid.
    """
    if s is None:
        return None
    s = str(s).strip()
    if s == "":
        return None

    # remove espaços e caracteres estranhos
    s = s.replace("\u00a0", " ").strip()

    # casos tipo "#######" no Excel exportado, etc.
    if set(s) <= {"#", "*"}:
        return None

    # remove separador de milhar '.' e troca ',' por '.'
    s2 = s.replace(".", "").replace(",", ".")
    try:
        return float(s2)
    except Exception:
        return None


def safe_str(x: Any) -> str:
    return "" if x is None else str(x)


def detect_delimiter(path: Path) -> str:
    sample = path.read_bytes()[:4096]
    try:
        txt = sample.decode("latin-1", errors="replace")
    except Exception:
        txt = sample.decode("utf-8", errors="replace")

    try:
        dialect = csv.Sniffer().sniff(txt, delimiters=";,\t")
        return dialect.delimiter
    except Exception:
        # INMET normalmente é ';'
        return ";"


def extract_year_month(date_str: str) -> Tuple[Optional[int], Optional[int]]:
    """Aceita 'YYYY-MM-DD' ou 'DD/MM/YYYY'. Retorna (ano, mês)."""
    if not date_str:
        return None, None

    date_str = date_str.strip()

    # YYYY-MM-DD
    if "-" in date_str:
        parts = date_str.split("-")
        if len(parts) >= 2 and parts[0].isdigit():
            y = int(parts[0])
            try:
                m = int(parts[1])
            except Exception:
                m = None
            return y, m

    # DD/MM/YYYY
    if "/" in date_str:
        parts = date_str.split("/")
        if len(parts) == 3 and parts[2].isdigit():
            y = int(parts[2])
            try:
                m = int(parts[1])
            except Exception:
                m = None
            return y, m

    return None, None


def normalize_station_id_from_filename(name: str) -> Optional[str]:
    """Tenta inferir ID tipo A001 do nome do arquivo, se necessário."""
    m = re.search(r"\b(A\d{3})\b", name.upper())
    if m:
        return m.group(1)
    return None


# -------------------------
# Parsing INMET CSV
# -------------------------

@dataclass
class StationMeta:
    id: str
    name: str = ""
    uf: str = ""
    region: str = ""
    lat: Optional[float] = None
    lon: Optional[float] = None
    alt: Optional[float] = None


def parse_inmet_csv(path: Path) -> Tuple[Optional[StationMeta], Optional[List[str]], Optional[List[List[str]]]]:
    """Lê um CSV INMET e retorna (meta, headers, rows).
    - meta: StationMeta
    - headers: lista de nomes de coluna da tabela
    - rows: lista de linhas (strings), apenas após o cabeçalho
    """
    delim = detect_delimiter(path)

    meta: Dict[str, Any] = {}
    headers: Optional[List[str]] = None
    rows: List[List[str]] = []

    with open(path, "r", encoding="latin-1", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter=delim)

        # 1) varre topo até encontrar a linha de cabeçalho da TABELA (DATA/HORA)
        for row in reader:
            if not row:
                continue

            cells = [c.strip() for c in row]
            if not cells:
                continue

            key = cells[0] if cells else ""

            # pega o primeiro valor não-vazio depois da coluna 0 (pode estar na B, C, D...)
            val = ""
            for c in cells[1:]:
                if c != "":
                    val = c
                    break

            k_up = key.upper()

            if k_up.startswith("REGI"):
                meta["region"] = val
            elif k_up.startswith("UF"):
                meta["uf"] = val
            elif k_up.startswith("ESTA"):
                meta["name"] = val
            elif ("CODIGO" in k_up) or ("CÓDIGO" in k_up) or ("WMO" in k_up):
                meta["id"] = val
            elif k_up.startswith("LAT"):
                meta["lat"] = num_pt(val)
            elif k_up.startswith("LON"):
                meta["lon"] = num_pt(val)
            elif k_up.startswith("ALT"):
                meta["alt"] = num_pt(val)

            # detecta cabeçalho (DATA e HORA em qualquer coluna)
            upcells = [c.upper() for c in cells]
            has_data = any("DATA" in c for c in upcells)
            has_hora = any("HORA" in c for c in upcells)
            if has_data and has_hora:
                headers = cells
                break

        if headers is None:
            return None, None, None

        # 2) lê o resto como tabela
        for row in reader:
            if not row:
                continue
            cells = [c.strip() for c in row]
            # pula linhas muito pequenas
            if len(cells) < 2:
                continue
            rows.append(cells)

    # fallback: tenta inferir id pelo filename se não veio no cabeçalho
    if not meta.get("id"):
        inferred = normalize_station_id_from_filename(path.name)
        if inferred:
            meta["id"] = inferred

    if not meta.get("id"):
        return None, None, None

    st = StationMeta(
        id=str(meta.get("id")).strip().upper(),
        name=str(meta.get("name") or "").strip(),
        uf=str(meta.get("uf") or "").strip().upper(),
        region=str(meta.get("region") or "").strip().upper(),
        lat=meta.get("lat", None),
        lon=meta.get("lon", None),
        alt=meta.get("alt", None),
    )

    if not st.name:
        st.name = st.id

    return st, headers, rows


def find_col(headers: List[str], candidates: List[str]) -> Optional[int]:
    """Acha a coluna cujo header contém algum termo candidato (case-insensitive)."""
    up = [h.upper() for h in headers]
    for cand in candidates:
        c = cand.upper()
        for i, h in enumerate(up):
            if c in h:
                return i
    return None


# -------------------------
# Build year JSON from one station CSV
# -------------------------

def build_station_year_from_csv(csv_path: Path, year: int) -> Tuple[Optional[StationMeta], Optional[dict]]:
    st, headers, rows = parse_inmet_csv(csv_path)
    if st is None or headers is None or rows is None:
        return None, None

    # Colunas essenciais
    # Data
    col_date = find_col(headers, ["DATA"])  # geralmente existe
    if col_date is None:
        col_date = 0

    # Precipitação (existem variações)
    col_p = find_col(headers, ["PRECIPITAÇÃO", "PRECIPITACAO", "PRECIP"])
    # Temperatura do ar (varia muito; pegamos a mais provável)
    col_t = find_col(headers, ["TEMPERATURA DO AR", "TEMPERATURA"])

    # fallback caso não encontre (pelo seu print, precip costuma ficar cedo e temp no meio)
    if col_p is None:
        col_p = 2
    if col_t is None:
        col_t = 7

    months = defaultdict(lambda: {"p": [], "t": []})

    for r in rows:
        if len(r) <= max(col_date, col_p, col_t):
            continue

        date_str = r[col_date].strip()
        y, m = extract_year_month(date_str)
        if y != year or m is None or not (1 <= m <= 12):
            continue

        p = num_pt(r[col_p])
        t = num_pt(r[col_t])

        # validações leves
        if p is not None and p != -9999 and p >= 0:
            months[m]["p"].append(p)

        if t is not None and t != -9999 and -80 < t < 80:
            months[m]["t"].append(t)

    if not months:
        return st, None

    out_months = []
    for mm in range(1, 13):
        if mm not in months:
            out_months.append({"m": mm, "p": None, "tmean": None})
            continue

        p_sum = sum(months[mm]["p"]) if months[mm]["p"] else None
        t_mean = (sum(months[mm]["t"]) / len(months[mm]["t"])) if months[mm]["t"] else None

        out_months.append({
            "m": mm,
            "p": round(p_sum, 1) if p_sum is not None else None,
            "tmean": round(t_mean, 1) if t_mean is not None else None
        })

    p_vals = [x["p"] for x in out_months if isinstance(x["p"], (int, float))]
    t_vals = [x["tmean"] for x in out_months if isinstance(x["tmean"], (int, float))]

    annual = {
        "p_total": round(sum(p_vals), 1) if p_vals else None,
        "p_month_mean": round(sum(p_vals)/len(p_vals), 1) if p_vals else None,
        "p_month_min": round(min(p_vals), 1) if p_vals else None,
        "p_month_max": round(max(p_vals), 1) if p_vals else None,
        "tmean": round(sum(t_vals)/len(t_vals), 1) if t_vals else None,
        "tmin": round(min(t_vals), 1) if t_vals else None,
        "tmax": round(max(t_vals), 1) if t_vals else None,
    }

    data = {
        "station": st.id,
        "year": year,
        "months": out_months,
        "annual": annual
    }

    return st, data


# -------------------------
# Stations + years index
# -------------------------

def load_existing_stations(stations_path: Path) -> Dict[str, dict]:
    if not stations_path.exists():
        return {}
    try:
        obj = json.loads(stations_path.read_text(encoding="utf-8"))
        if isinstance(obj, list):
            return {str(s.get("id")): s for s in obj if isinstance(s, dict) and s.get("id")}
    except Exception:
        pass
    return {}


def write_stations_json(stations_path: Path, stations: Dict[str, dict]) -> None:
    lst = list(stations.values())
    # ordena por UF+nome para ficar bonito
    lst.sort(key=lambda s: (safe_str(s.get("uf")), safe_str(s.get("name"))))
    stations_path.parent.mkdir(parents=True, exist_ok=True)
    stations_path.write_text(json.dumps(lst, ensure_ascii=False, indent=2), encoding="utf-8")


def write_years_json(years_path: Path, years: List[int]) -> None:
    years_path.parent.mkdir(parents=True, exist_ok=True)
    years_path.write_text(json.dumps(sorted(years, reverse=True), ensure_ascii=False, indent=2), encoding="utf-8")


# -------------------------
# Main
# -------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="Pasta raw (contendo estacoes.ANO)")
    ap.add_argument("--out", required=True, help="Pasta de saída assets/data")
    ap.add_argument("--stations", required=True, help="Caminho assets/stations.json")
    ap.add_argument("--years", required=True, help="Caminho assets/years.json")
    ap.add_argument("--start", type=int, required=True, help="Ano inicial (ex: 2000)")
    ap.add_argument("--end", type=int, required=True, help="Ano final (ex: 2024)")
    ap.add_argument("--ext", default=".CSV", help="Extensão dos arquivos (default .CSV)")
    ap.add_argument("--limit", type=int, default=0, help="Limitar N arquivos por ano (debug). 0 = sem limite")
    args = ap.parse_args()

    raw_dir = Path(args.raw).resolve()
    out_dir = Path(args.out).resolve()
    stations_path = Path(args.stations).resolve()
    years_path = Path(args.years).resolve()

    start = int(args.start)
    end = int(args.end)

    if not raw_dir.exists():
        raise SystemExit(f"RAW não existe: {raw_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)

    existing_stations = load_existing_stations(stations_path)
    stations_map: Dict[str, dict] = dict(existing_stations)  # id -> station dict

    generated_years: set[int] = set()
    generated_pairs = 0

    # Para performance: cache por (ano -> lista arquivos)
    for year in range(start, end + 1):
        year_folder = raw_dir / f"estacoes.{year}"
        if not year_folder.exists():
            log(f"[year {year}] pasta não encontrada: {year_folder}")
            continue

        files = sorted([p for p in year_folder.glob(f"*{args.ext}") if p.is_file()])
        log(f"[year {year}] arquivos encontrados: {len(files)} em {year_folder}")

        if args.limit and len(files) > args.limit:
            files = files[: args.limit]
            log(f"[year {year}] (limit) processando só {len(files)} arquivos")

        for csv_path in files:
            st, data = build_station_year_from_csv(csv_path, year)
            if st is None or data is None:
                continue

            # atualiza stations_map
            sid = st.id
            rec = stations_map.get(sid, {
                "id": sid,
                "name": st.name,
                "uf": st.uf,
                "lat": st.lat,
                "lon": st.lon,
                "alt": st.alt,
                "years": []
            })

            # garante campos base (não sobrescreve se já tiver algo melhor)
            rec["name"] = rec.get("name") or st.name
            rec["uf"] = rec.get("uf") or st.uf
            rec["lat"] = rec.get("lat") if rec.get("lat") is not None else st.lat
            rec["lon"] = rec.get("lon") if rec.get("lon") is not None else st.lon
            rec["alt"] = rec.get("alt") if rec.get("alt") is not None else st.alt

            yrs = rec.get("years") or []
            if year not in yrs:
                yrs.append(year)
                yrs.sort()
            rec["years"] = yrs

            stations_map[sid] = rec

            # escreve JSON do station/year
            station_out = out_dir / sid
            station_out.mkdir(parents=True, exist_ok=True)
            out_json = station_out / f"{year}.json"
            out_json.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

            generated_years.add(year)
            generated_pairs += 1

        log(f"[year {year}] concluído")

    # Atualiza índices
    write_stations_json(stations_path, stations_map)
    write_years_json(years_path, sorted(list(generated_years)))

    log("")
    log(f"TOTAL station/year gerados: {generated_pairs}")
    log(f"ANOS encontrados: {sorted(list(generated_years))}")
    log(f"ESTAÇÕES: {len(stations_map)}")
    log("FIM ✅")


if __name__ == "__main__":
    main()
