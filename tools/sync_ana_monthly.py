#!/usr/bin/env python3
"""Bounded national archive bootstrap and monthly summaries; no credentials.
Independent outputs: never modifies the original catalog or daily snapshots.
"""
import argparse, calendar, datetime as dt, hashlib, json, pathlib, time
from sync_ana import TYPES, STATES, fetch, parse_series, read, write, utcnow

PERIODS={'chuva':'PeriodoPluviometro','cotas':'PeriodoEscala','vazao':'PeriodoDescLiquida'}
def year_of(value, fallback, current_year=None):
    try: return max(1850,min(current_year or dt.date.today().year,int(str(value)[:4])))
    except (TypeError,ValueError): return fallback

def tasks(catalogs, today):
    groups={}
    for uf,stations in catalogs.items():
        group=[]
        for s in sorted(stations,key=lambda x:x['code']):
            for kind in s.get('candidate_variables',[]):
                if kind not in TYPES: continue
                periods=s.get('periods',{}); prefix=PERIODS[kind]
                first=year_of(periods.get(prefix+'Inicio'),1850,today.year)
                last=year_of(periods.get(prefix+'Fim'),today.year,today.year)
                if last<first: first=1850
                # Keep inactive stations: historic climate records are valuable.
                for level in ('1','2'):
                    for start in reversed(list(range(first,last+1,10))):
                        group.append(dict(uf=uf,code=s['code'],kind=kind,level=level,start=start,end=min(start+9,last)))
        groups[uf]=sorted(group,key=lambda t:-t['end'])
    for i in range(max(map(len,groups.values()),default=0)):
        for uf in STATES:
            if i<len(groups.get(uf,[])): yield groups[uf][i]

def key(t): return ':'.join(str(t[k]) for k in ('uf','code','kind','level','start','end'))
def summarize(parsed,year,level,kind):
    valid={r['date']:r['value'] for r in parsed['observations'] if r['consistency']==level and r['usable']}
    rows=[]
    for month in range(1,13):
        days=calendar.monthrange(year,month)[1];prefix=f'{year}-{month:02d}-'
        values=[v for d,v in valid.items() if d.startswith(prefix)]
        total=sum(values); observed=(total if kind=='chuva' else total/len(values)) if values else None
        rows.append(dict(ano=year,mes=month,observado=observed,valor=observed if len(values)==days else None,dias=len(values),esperados=days,cobertura=len(values)/days,completo=len(values)==days,sum=total,last_date=max((d for d in valid if d.startswith(prefix)),default=None)))
    return rows

def annual(months,kind,today):
    result=[]
    for year in sorted({m['ano'] for m in months}):
        selected=[m for m in months if m['ano']==year];n=sum(m['dias'] for m in selected);total=sum(m['sum'] for m in selected);expected=366 if calendar.isleap(year) else 365
        result.append(dict(ano=year,valor=(total if kind=='chuva' else total/n) if n else None,dias=n,esperados=expected,cobertura=n/expected,completo=n==expected and year<today.year))
    return result

def merge(old, incoming, task, attempt, today):
    months={(m['ano'],m['mes']):m for m in old.get('months',[])}; regressions=[]
    for row in incoming:
        k=(row['ano'],row['mes']);prev=months.get(k)
        # A truncated/empty response must not erase valid archived measurements.
        if prev and row['dias']<prev['dias']:
            regressions.append({'ano':k[0],'mes':k[1],'retained_days':prev['dias'],'incoming_days':row['dias']});continue
        months[k]=row
    result=sorted(months.values(),key=lambda m:(m['ano'],m['mes']))
    ranges=old.get('checked_ranges',[])
    bounds={'start':f"{task['start']}-01-01",'end':f"{task['end']}-12-31"}
    if bounds not in ranges:ranges=ranges+[bounds]
    return dict(schema_version=1,station=task['code'],uf=task['uf'],variable=task['kind'],consistency=task['level'],unit=TYPES[task['kind']][2],source='ANA public legacy HidroSerieHistorica',months=result,years=annual(result,task['kind'],today),lastDate=max((m['last_date'] for m in result if m['last_date']),default=None),last_success_utc=attempt,collected_utc=attempt,complete_archive=False,checked_ranges=ranges,retained_after_regression=regressions,stale=bool(regressions) or old.get('stale',False),warning='Monthly archive; collection date is not measurement date. Incomplete months are excluded from climatology.')

def due_queue(all_tasks,state,today,now):
    monthly=[];bootstrap=[];historical=[]
    for t in all_tasks:
        r=state['tasks'].get(key(t),{});last=r.get('last_success_utc')
        if (r.get('retry_after') or '')>now:continue
        if not last:bootstrap.append(t)
        elif t['end']>=today.year-1 and last[:7]!=today.strftime('%Y-%m'):monthly.append(t)
        elif last[:4]!=str(today.year):historical.append(t)
    oldest=lambda t:state['tasks'].get(key(t),{}).get('last_attempt_utc','')
    monthly.sort(key=oldest);historical.sort(key=oldest)
    # Stable UF round-robin retained for ties. Newer windows first for discovery.
    bootstrap.sort(key=lambda t:(oldest(t),-t['end']))
    # Fair share to every class; spare capacity immediately used by other queues.
    result=[]
    for i in range(max(len(monthly),len(bootstrap),len(historical))):
        for group in (monthly,bootstrap,historical):
            if i<len(group):result.append(group[i])
    return result

def run(args, request=fetch, today=None):
    today=today or dt.date.today(); root=pathlib.Path(args.root);statepath=root/'monthly-state.json'
    state=read(statepath,{'tasks':{},'schema_version':1});write(statepath,state);catalogs={uf:read(root/'catalog'/f'{uf}.json',{}).get('stations',[]) for uf in STATES}
    all_tasks=list(tasks(catalogs,today));now=utcnow();queue=due_queue(all_tasks,state,today,now)
    begun=time.monotonic();attempted=0;success=0;limited=False
    for task in queue:
        if attempted>=args.budget or time.monotonic()-begun>=args.max_seconds:break
        attempted+=1;k=key(task);record={**state['tasks'].get(k,{}),'last_attempt_utc':utcnow()}
        path=root/'summaries'/task['kind']/task['code']/f"nivel{task['level']}.json"
        try:
            params={'codEstacao':task['code'],'dataInicio':f"01/01/{task['start']}",'dataFim':f"31/12/{task['end']}",'tipoDados':TYPES[task['kind']][0],'nivelConsistencia':task['level']}
            xml=request('HidroSerieHistorica',params,timeout=60,limit=8*1024*1024)
            incoming=[]
            for year in range(task['start'],task['end']+1): incoming.extend(summarize(parse_series(xml,task['code'],task['kind'],year),year,task['level'],task['kind']))
            output=merge(read(path,{}),incoming,task,record['last_attempt_utc'],today)
            output['response_sha256']=hashlib.sha256(xml).hexdigest()
            size=sum(p.stat().st_size for p in (root/'summaries').rglob('*.json')) if (root/'summaries').exists() else 0
            growth=len(json.dumps(output,ensure_ascii=False,separators=(',',':')).encode())+1-(path.stat().st_size if path.exists() else 0)
            if size+max(0,growth)>args.max_mib*1024*1024:limited=True;raise RuntimeError('summary_storage_limit')
            write(path,output);record.update(status='ok',last_success_utc=record['last_attempt_utc'],retry_after=None);success+=1
        except Exception as exc:
            record.update(status='error_preserved',error_type=type(exc).__name__,retry_after=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=24)).isoformat())
        state['tasks'][k]=record;write(statepath,state)
        if args.delay:time.sleep(args.delay)
    status=dict(schema_version=1,last_run_utc=now,requests_this_run=attempted,success_this_run=success,catalog_ufs=sum(bool(s) for s in catalogs.values()),tasks_total=len(all_tasks),tasks_completed=sum(bool(state['tasks'].get(key(t),{}).get('last_success_utc')) for t in all_tasks),storage_limited=limited,national_series_complete=False,warning='Staged national bootstrap including inactive stations. Successful empty queries do not imply observations exist. Monthly revisions; no guarantee all stations are current.')
    write(root/'monthly-status.json',status);return status

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',default='assets/ana');p.add_argument('--budget',type=int,default=100);p.add_argument('--max-seconds',type=int,default=1500);p.add_argument('--max-mib',type=int,default=150);p.add_argument('--delay',type=float,default=2)
    args=p.parse_args()
    if not 0<=args.budget<=100 or not 1<=args.max_seconds<=1800 or not 1<=args.max_mib<=350 or not 1<=args.delay<=10:p.error('Unsafe budget')
    print(json.dumps(run(args),ensure_ascii=False))
if __name__=='__main__':main()
