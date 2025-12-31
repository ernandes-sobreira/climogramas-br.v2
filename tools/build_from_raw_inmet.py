import os
import re
import json
from datetime import datetime
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW_DIR = os.path.join(ROOT, "raw")
OUT_DIR = os.path.join(ROOT, "assets", "data")

# --- util ---
def safe_float(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip()
    if not s or s.upper() in {"NA", "N/A", "NULL"}:
        return None
    # INMET às vezes usa vírgula
    s = s.replace(",", ".")
    try:
        return float(s)
    except:
        return None

def month_stats(df, col):
    # retorna: mean, min, max (ignorando NaN)
    if col not in df.columns:
        return None, None, None
    s = pd.to_numeric(df[col], errors="coerce")
    if s.dropna().empty:
        return None, None, None
    return float(s.mean()), float(s.min()), float(s.max())

def month_sum(df, col):
    if col not in df.columns:
        return None
    s = pd.to_numeric(df[col], errors="coerce")
    if s.dropna().empty:
        return None
    return float(s.sum())

def parse_meta_from_file(filepath):
    meta = {}
    # primeiras 8 linhas são metadados no padrão INMET
    with open(filepath, "r", encoding="latin1", errors="ignore") as f:
        head = [f.readline().strip() for _ in range(8)]
    text = "\n".join(head)

    def grab(key):
        # Ex: "CODIGO (WMO): A001"
        m = re.search(rf"^{re.escape(key)}\s*:\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
        return m.group(1).strip() if m else None

    meta["region"] = grab("REGIAO")
    meta["uf"] = grab("UF")
    meta["name"] = grab("ESTACAO")
    code = grab("CODIGO (WMO)")
    meta["id"] = code if code else None

    # lat/lon/alt podem vir com vírgula
    meta["lat"] = safe_float(grab("LATITUDE"))
    meta["lon"] = safe_float(grab("LONGITUDE"))
    meta["alt_m"] = safe_float(grab("ALTITUDE"))
    return meta

def infer_id_year(filepath):
    fn = os.path.basename(filepath)

    # padrão INMET: INMET_CO_DF_A001_BRASILIA_01-01-2021_A_31-12-2021.CSV
    m = re.search(r"_([A-Z]\d{3})_.*?(\d{2})-(\d{2})-(\d{4})_A_", fn)
    if m:
        station_id = m.group(1)
        year = int(m.group(4))
        return station_id, year

    # fallback: tenta achar A000 e ano
    m2 = re.search(r"(A\d{3}).*(20\d{2})", fn)
    if m2:
        return m2.group(1), int(m2.group(2))

    return None, None

def build_one_csv(filepath):
    station_id, year = infer_id_year(filepath)
    if not station_id or not year:
        print(f"[skip] não consegui inferir ID/ano do nome: {filepath}")
        return None

    meta = parse_meta_from_file(filepath)
    meta["id"] = meta.get("id") or station_id

    # dados começam após 8 linhas
    df = pd.read_csv(filepath, sep=";", decimal=",", encoding="latin1", skiprows=8)

    # Normaliza nome da coluna de data
    if "Data" not in df.columns:
        print(f"[skip] sem coluna Data: {filepath}")
        return None

    # Parse datas: no CSV veio "2021/01/01"
    df["Data"] = pd.to_datetime(df["Data"], errors="coerce")
    df = df[df["Data"].notna()].copy()
    df["year"] = df["Data"].dt.year
    df["month"] = df["Data"].dt.month

    df = df[df["year"] == year].copy()
    if df.empty:
        print(f"[skip] ano {year} sem linhas: {filepath}")
        return None

    # Colunas-alvo (nomes exatos do INMET)
    COL_RAIN = "PRECIPITAÇÃO TOTAL, HORÁRIO (mm)"
    COL_TEMP = "TEMPERATURA DO AR - BULBO SECO, HORARIA (°C)"
    COL_RH   = "UMIDADE RELATIVA DO AR, HORARIA (%)"
    COL_RAD  = "RADIACAO GLOBAL (Kj/m²)"  # no seu CSV está assim
    COL_PRESS= "PRESSAO ATMOSFERICA AO NIVEL DA ESTACAO, HORARIA (mB)"
    COL_WIND = "VENTO, VELOCIDADE HORARIA (m/s)"

    months_out = []
    # guardamos variáveis extras como séries mensais (12)
    vars_months = {
        "rh":   [None]*12,
        "rad":  [None]*12,
        "press":[None]*12,
        "wind": [None]*12,
    }

    annual_temp_min = None
    annual_temp_max = None

    for m in range(1, 13):
        dm = df[df["month"] == m]

        # chuva: soma do mês
        rain = month_sum(dm, COL_RAIN)

        # temperatura: média do mês + extremos do mês
        tmean, tmin, tmax = month_stats(dm, COL_TEMP)

        # atualiza anual min/max (extremos do ano)
        if tmin is not None:
            annual_temp_min = tmin if annual_temp_min is None else min(annual_temp_min, tmin)
        if tmax is not None:
            annual_temp_max = tmax if annual_temp_max is None else max(annual_temp_max, tmax)

        months_out.append({
            "m": m,
            "prec_mm": rain,
            "tmean_c": tmean,
            "tmin_c": tmin,
            "tmax_c": tmax
        })

        # extras (média do mês)
        rh_mean, _, _ = month_stats(dm, COL_RH)
        rad_mean, _, _ = month_stats(dm, COL_RAD)
        press_mean, _, _ = month_stats(dm, COL_PRESS)
        wind_mean, _, _ = month_stats(dm, COL_WIND)

        vars_months["rh"][m-1] = rh_mean
        vars_months["rad"][m-1] = rad_mean
        vars_months["press"][m-1] = press_mean
        vars_months["wind"][m-1] = wind_mean

    # anuais
    # tmean anual = média das médias mensais existentes
    tmeans = [x["tmean_c"] for x in months_out if x["tmean_c"] is not None]
    annual_tmean = sum(tmeans)/len(tmeans) if tmeans else None

    # chuva total = soma meses existentes
    rains = [x["prec_mm"] for x in months_out if x["prec_mm"] is not None]
    annual_rain_total = sum(rains) if rains else None

    out = {
        "year": year,
        "meta": meta,
        "annual": {
            "tmin_c": annual_temp_min,
            "tmean_c": annual_tmean,
            "tmax_c": annual_temp_max,
            "prec_total_mm": annual_rain_total
        },
        "months": months_out,
        "vars": {
            "rh":   {"label":"Umidade relativa (%)", "months": vars_months["rh"]},
            "rad":  {"label":"Radiação global (kJ/m²)", "months": vars_months["rad"]},
            "press":{"label":"Pressão (mB)", "months": vars_months["press"]},
            "wind": {"label":"Vento (m/s)", "months": vars_months["wind"]},
        }
    }
    return station_id, year, out

def main():
    if not os.path.isdir(RAW_DIR):
        print(f"[erro] pasta raw não existe: {RAW_DIR}")
        return

    os.makedirs(OUT_DIR, exist_ok=True)

    built = 0
    seen_years = set()

    for root, _, files in os.walk(RAW_DIR):
        for fn in files:
            if not fn.lower().endswith(".csv"):
                continue
            fp = os.path.join(root, fn)
            res = build_one_csv(fp)
            if not res:
                continue
            station_id, year, payload = res

            out_station_dir = os.path.join(OUT_DIR, station_id)
            os.makedirs(out_station_dir, exist_ok=True)

            out_path = os.path.join(out_station_dir, f"{year}.json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

            built += 1
            seen_years.add(year)
            print(f"[ok] {station_id}/{year}.json")

    print(f"\nTOTAL gerados: {built}")
    print(f"ANOS encontrados: {sorted(seen_years)}")

if __name__ == "__main__":
    main()
