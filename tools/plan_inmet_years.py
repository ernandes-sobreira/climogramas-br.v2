#!/usr/bin/env python3
"""One current year plus at most one missing national archive per run."""
import datetime as dt
import json
import pathlib
import argparse

def plan(status, current, now, start=2000, include_previous=False, present_years=()):
    entries={int(x['year']):x for x in status.get('years',[])}
    years=[current]
    # Existing packs establish visibility, NOT completed national processing.
    # Fill wholly absent years first, then audit legacy years without source SHA.
    present=set(present_years)
    candidates=sorted(range(current-1,start-1,-1),key=lambda y:(y in present,-y))
    if include_previous and current-1>=start:
        years.append(current-1)
        return sorted(set(years))
    for year in candidates:
        entry=entries.get(year,{})
        # Only a successfully processed national ZIP proves backfill completion.
        if entry.get('source_sha256') and entry.get('stations',0)>0:continue
        checked=entry.get('checked_utc')
        if checked:
            try:
                age=now-dt.datetime.fromisoformat(checked.replace('Z','+00:00'))
                if age<dt.timedelta(days=7):continue
            except (ValueError,TypeError):pass
        years.append(year);break
    return sorted(set(years))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--status',default='assets/inmet-update-status.json');ap.add_argument('--include-previous',action='store_true');ap.add_argument('--start',type=int,default=2000);ap.add_argument('--data',default='assets/data')
    args=ap.parse_args();now=dt.datetime.now(dt.timezone.utc);path=pathlib.Path(args.status)
    status=json.loads(path.read_text()) if path.exists() else {}
    present={int(p.stem) for p in pathlib.Path(args.data).glob('*/*.json') if p.stem.isdigit()}
    print(' '.join(map(str,plan(status,now.year,now,args.start,args.include_previous,present))))
if __name__=='__main__':main()
