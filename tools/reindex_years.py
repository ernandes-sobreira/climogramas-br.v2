# reindex_years.py
import json
import os
import re
from collections import defaultdict

YEAR_RE = re.compile(r'^(\d{4})\.json$')

def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    data_root = os.path.join(root, "assets", "data")
    stations_path = os.path.join(root, "assets", "stations.json")
    years_path = os.path.join(root, "assets", "years.json")

    with open(stations_path, "r", encoding="utf-8") as f:
        stations = json.load(f)

    by_id = {s.get("id"): s for s in stations if isinstance(s, dict)}
    years_by_station = defaultdict(set)
    all_years = set()

    if os.path.isdir(data_root):
        for sid in os.listdir(data_root):
            p = os.path.join(data_root, sid)
            if not os.path.isdir(p):
                continue
            for fn in os.listdir(p):
                m = YEAR_RE.match(fn)
                if not m:
                    continue
                y = int(m.group(1))
                years_by_station[sid].add(y)
                all_years.add(y)

    changed = 0
    for sid, ys in years_by_station.items():
        if sid not in by_id:
            continue
        old = set(by_id[sid].get("years", []) or [])
        if old != ys:
            by_id[sid]["years"] = sorted(list(ys))
            changed += 1

    with open(stations_path, "w", encoding="utf-8") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)

    years = sorted(list(all_years), reverse=True)
    with open(years_path, "w", encoding="utf-8") as f:
        json.dump(years, f, ensure_ascii=False, indent=2)

    print("OK ✅ Atualizado:")
    print(" -", stations_path)
    print(" -", years_path)
    print("Anos encontrados:", years)
    print("Estações modificadas:", changed)

if __name__ == "__main__":
    main()
