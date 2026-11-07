#!/usr/bin/env python3
"""One current year plus at most one missing national archive per run."""
import datetime as dt
import json
import pathlib
import argparse

def plan(status, current, now, start=2019, include_previous=False):
    entries={int(x['year']):x for x in status.get('years',[])}
    years=[current]
    candidates=list(range(current-1,start-1,-1))
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
    ap=argparse.ArgumentParser();ap.add_argument('--status',default='assets/inmet-update-status.json');ap.add_argument('--include-previous',action='store_true');ap.add_argument('--start',type=int,default=2019)
    args=ap.parse_args();now=dt.datetime.now(dt.timezone.utc);path=pathlib.Path(args.status)
    status=json.loads(path.read_text()) if path.exists() else {}
    print(' '.join(map(str,plan(status,now.year,now,args.start,args.include_previous))))
if __name__=='__main__':main()
