# tools/build_inmet_2023.py
import os, json, csv, re, unicodedata
from datetime import datetime

YEAR = 2023

# Rodar a partir de: ...\climogramas-br\tools
RAW_DIR      = os.path.normpath(r"../raw/estacoes.2023")
OUT_DATA_DIR = os.path.normpath(r"../assets/data")
OUT_STATIONS = os.path.normpath(r"../assets/stations.json")
OUT_REPORT   = os.path.normpath(r"./report_2023.txt")

os.makedirs(OUT_DATA_DIR, exist_ok=True)

MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]

def norm(s: str) -> str:
    if s is None:
        return ""
    s = str(s)
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s

def to_float_pt(x):
    """Converte número pt-BR (vírgula decimal) pra float. Retorna None se vazio/inválido."""
    if x is None:
        return None
    s = str(x).strip()
    if s == "" or s.lower() in ("nan","null","none","-9999","-9999.0"):
        return None
    s = s.replace(".", "")  # caso venha 1.234,56
    s = s.replace(",", ".")
    try:
        return float(s)
    except:
        return None

def pick_col(header_norm, contains_any):
    """retorna índice da coluna cuja versão normalizada contém algum dos termos."""
    for i, hn in enumerate(header_norm):
        for token in contains_any:
            if token in hn:
                return i
    return None

def parse_station_id(fname):
    # Exemplos: INMET_CO_DF_A001_BRASILIA_01-01-2023_A_31-12-2023.CSV
    # Em geral, o código vem como "_A001_" (WMO)
    m = re.search(r"_([A-Z]\d{3})_", fname.upper())
    if m:
        return m.group(1)
    # fallback: tenta pegar algo tipo A001 no nome inteiro
    m2 = re.search(r"([A-Z]\d{3})", fname.upper())
    return m2.group(1) if m2 else None

def parse_station_name_from_fname(fname):
    # pega um pedaço "humano" depois do ID
    base = os.path.splitext(fname)[0]
    parts = base.split("_")
    # tenta achar parte depois do ID
    sid = parse_station_id(fname)
    if sid and sid in parts:
        idx = parts.index(sid)
        # próximo pedaço costuma ser nome da estação (pode ter espaços no arquivo original, aqui vira _)
        if idx + 1 < len(parts):
            return parts[idx+1].replace("-", " ").title()
    # fallback: último campo antes da data
    return parts[4].replace("-", " ").title() if len(parts) > 4 else base.title()

def safe_mean(vals):
    vals = [v for v in vals if v is not None]
    return (sum(vals)/len(vals)) if vals else None

def safe_min(vals):
    vals = [v for v in vals if v is not None]
    return min(vals) if vals else None

def safe_max(vals):
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None

def safe_sum(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None

stations = []
skipped = []

files = [f for f in os.listdir(RAW_DIR) if f.lower().endswith(".csv")]
files.sort()

for idx, fname in enumerate(files, 1):
    path = os.path.join(RAW_DIR, fname)
    sid = parse_station_id(fname)
    if not sid:
        skipped.append((fname, "sem_id", "Não consegui extrair ID tipo A001 do nome"))
        continue

    # --- ler arquivo como CSV ; (latin1 costuma funcionar)
    try:
        with open(path, "r", encoding="latin1", newline="") as f:
            reader = csv.reader(f, delimiter=";")
            rows = list(reader)
    except UnicodeDecodeError:
        # fallback
        with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
            reader = csv.reader(f, delimiter=";")
            rows = list(reader)
    except Exception as e:
        skipped.append((fname, "erro_leitura", str(e)))
        continue

    if len(rows) < 15:
        skipped.append((fname, "vazio_ou_curto", f"Linhas={len(rows)}"))
        continue

    # --- metadados (linhas tipo "UF:;DF")
    meta = {}
    header_row_index = None

    # INMET costuma ter várias linhas de meta e depois uma linha de cabeçalho com "Data;Hora UTC;..."
    for i, r in enumerate(rows[:50]):
        if not r:
            continue
        first = norm(r[0])
        if first.endswith(":") and len(r) >= 2:
            key = first.replace(":", "").strip()
            meta[key] = (r[1].strip() if len(r) > 1 else "")
        # achar a linha de cabeçalho pelos termos "data" e "hora"
        joined = " | ".join([norm(x) for x in r])
        if ("data" in joined) and ("hora" in joined or "utc" in joined) and ("precipit" in joined or "temperat" in joined):
            header_row_index = i
            break

    if header_row_index is None:
        skipped.append((fname, "sem_cabecalho", "Não achei linha de cabeçalho (Data/Hora/Precip/Temp)"))
        continue

    header = rows[header_row_index]
    header_norm = [norm(h) for h in header]

    # colunas principais
    c_date = pick_col(header_norm, ["data"])
    c_hour = pick_col(header_norm, ["hora utc", "hora", "utc"])

    # temperatura bulbo seco horária
    c_temp = pick_col(header_norm, [
        "temperatura do ar - bulbo seco",
        "bulbo seco",
        "temp do ar",
        "temperatura"
    ])

    # precipitação total horário
    c_prec = pick_col(header_norm, [
        "precipitacao total, horario",
        "precipitacao total",
        "precipitacao",
        "chuva"
    ])

    if c_date is None or c_hour is None or c_temp is None or c_prec is None:
        skipped.append((fname, "faltou_coluna",
                        f"DATA={c_date} HORA={c_hour} TEMP={c_temp} PREC={c_prec} | header={header[:6]}..."))
        continue

    # --- ler dados após cabeçalho
    data_rows = rows[header_row_index+1:]

    # acumuladores
    # mês: lista de temps; lista de precips
    temps_by_month = {m: [] for m in range(1,13)}
    prec_by_month  = {m: [] for m in range(1,13)}

    temps_all = []
    prec_all  = []

    valid_days = set()  # dias com pelo menos 1 temperatura válida

    for r in data_rows:
        if not r or len(r) <= max(c_date, c_hour, c_temp, c_prec):
            continue

        ds = r[c_date].strip() if r[c_date] is not None else ""
        hs = r[c_hour].strip() if r[c_hour] is not None else ""
        if not ds:
            continue

        # parse data: pode vir "2023/01/01" ou "01/01/2023"
        dt = None
        for fmt in ("%Y/%m/%d", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                dt = datetime.strptime(ds, fmt)
                break
            except:
                pass
        if dt is None:
            continue

        # hora UTC tipo "0000 UTC" ou "00:00" etc
        hh = None
        m = re.search(r"(\d{2})(\d{2})", hs.replace(":", ""))
        if m:
            hh = int(m.group(1))
        else:
            m2 = re.search(r"(\d{1,2})", hs)
            if m2:
                hh = int(m2.group(1))
        if hh is None or hh < 0 or hh > 23:
            hh = 0

        month = dt.month

        tv = to_float_pt(r[c_temp])
        pv = to_float_pt(r[c_prec])

        temps_by_month[month].append(tv)
        prec_by_month[month].append(pv)

        if tv is not None:
            temps_all.append(tv)
            valid_days.add(dt.date())
        if pv is not None:
            prec_all.append(pv)

    # se não tiver quase nada, pula
    if len(temps_all) < 50 and len(prec_all) < 50:
        skipped.append((fname, "dados_insuficientes", f"temps={len(temps_all)} prec={len(prec_all)}"))
        continue

    months_out = []
    for m in range(1,13):
        tmean_m = safe_mean(temps_by_month[m])
        psum_m  = safe_sum(prec_by_month[m])
        if tmean_m is None and psum_m is None:
            # mês totalmente vazio: ainda assim podemos incluir (deixa null) ou pular
            months_out.append({"m": m, "tmean": None, "p": None})
        else:
            months_out.append({
                "m": m,
                "tmean": round(tmean_m, 2) if tmean_m is not None else None,
                "p": round(psum_m, 1) if psum_m is not None else None
            })

    # anual
    tmin = safe_min(temps_all)
    tmax = safe_max(temps_all)
    tmean = safe_mean(temps_all)
    p_total = safe_sum(prec_all)

    # p_month stats (ignora None)
    p_month_vals = [m["p"] for m in months_out if m["p"] is not None]
    p_month_min = min(p_month_vals) if p_month_vals else None
    p_month_max = max(p_month_vals) if p_month_vals else None
    p_month_mean = (sum(p_month_vals)/12.0) if p_month_vals else None  # mantém /12 para “média mensal no ano”

    coverage = len(valid_days) / 366.0  # 2024 é bissexto

    annual = {
        "tmin": round(tmin, 2) if tmin is not None else None,
        "tmean": round(tmean, 2) if tmean is not None else None,
        "tmax": round(tmax, 2) if tmax is not None else None,
        "p_total": round(p_total, 1) if p_total is not None else None,
        "p_month_min": round(p_month_min, 1) if p_month_min is not None else None,
        "p_month_mean": round(p_month_mean, 1) if p_month_mean is not None else None,
        "p_month_max": round(p_month_max, 1) if p_month_max is not None else None,
        "coverage": round(coverage, 3)
    }

    # metadados básicos para stations.json
    uf = meta.get("uf", "").strip().upper() or None
    name = meta.get("estacao", "").strip() or meta.get("estacao,", "").strip()
    if not name:
        name = parse_station_name_from_fname(fname)

    lat = to_float_pt(meta.get("latitude", None))
    lon = to_float_pt(meta.get("longitude", None))
    alt = to_float_pt(meta.get("altitude", None))

    # salvar JSON
    out_dir = os.path.join(OUT_DATA_DIR, sid)
    os.makedirs(out_dir, exist_ok=True)

    out_json = os.path.join(out_dir, f"{YEAR}.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({
            "station": sid,
            "year": YEAR,
            "months": months_out,
            "annual": annual
        }, f, ensure_ascii=False, indent=2)

    stations.append({
        "id": sid,
        "name": name,
        "uf": uf or "",
        "lat": lat,
        "lon": lon,
        "alt": alt,
        "years": [YEAR]
    })

    if idx % 25 == 0:
        print(f"({idx}/{len(files)}) OK: {sid} - {name}")

# ordena e salva stations.json
stations_sorted = sorted(stations, key=lambda x: ((x.get("uf") or ""), (x.get("name") or "")))
with open(OUT_STATIONS, "w", encoding="utf-8") as f:
    json.dump(stations_sorted, f, ensure_ascii=False, indent=2)

# relatório
with open(OUT_REPORT, "w", encoding="utf-8") as f:
    f.write(f"Relatório INMET {YEAR}\n")
    f.write(f"RAW_DIR: {os.path.abspath(RAW_DIR)}\n")
    f.write(f"Geradas: {len(stations)} estações\n")
    f.write(f"Puladas: {len(skipped)} arquivos\n\n")
    for (fname, code, info) in skipped:
        f.write(f"- {code}: {fname} | {info}\n")

print(f"\nCONCLUÍDO ✅  Geradas: {len(stations)}  |  Puladas: {len(skipped)}")
print(f"Saída dados: {os.path.abspath(OUT_DATA_DIR)}")
print(f"Stations:    {os.path.abspath(OUT_STATIONS)}")
print(f"Relatório:   {os.path.abspath(OUT_REPORT)}")
