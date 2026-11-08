#!/usr/bin/env python3
"""Bounded national archive bootstrap and monthly summaries; no credentials.
Independent outputs: never modifies the original catalog or daily snapshots.
"""
import argparse, calendar, datetime as dt, hashlib, json, pathlib, time, socket, math, unicodedata
from sync_ana import TYPES, STATES, fetch, parse_series, read, write, utcnow
from ana_summary_codec import encode, decode, write_bytes, scientifically_equal

PERIODS={'chuva':'PeriodoPluviometro','cotas':'PeriodoEscala','vazao':'PeriodoDescLiquida'}
# Municipal screening from FCO2025 AnnexVII, not an official biome polygon.
# The entire municipality can extend beyond the Pantanal; do not label its
# stations as inside the biome without a separate point-in-polygon validation.
PANTANAL_MUNICIPALITIES={
 'MT':set("CURVELANDIA|CUIABA|FIGUEIROPOLIS D OESTE|GLORIA D OESTE|MIRASSOL D OESTE|PORTO ESPERIDIAO|VARZEA GRANDE|SANTO ANTONIO DO LEVERGER|BARAO DE MELGACO|CACERES|ITIQUIRA|LAMBARI D OESTE|POCONE|NOSSA SENHORA DO LIVRAMENTO".split('|')),
 'MS':set("RIO VERDE DE MATO GROSSO|LADARIO|PORTO MURTINHO|SONORA|MIRANDA|COXIM|CORUMBA|BODOQUENA|AQUIDAUANA".split('|'))}
def municipality_name(value):
    text=''.join(c for c in unicodedata.normalize('NFKD',str(value or '')) if not unicodedata.combining(c)).upper()
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in text).split())

def station_priority(station,uf):
    try:
        if station.get('lat') is None or station.get('lon') is None:raise ValueError()
        lat=float(station['lat']);lon=float(station['lon'])
        if not math.isfinite(lat) or not math.isfinite(lon) or not -90<=lat<=90 or not -180<=lon<=180:raise ValueError()
        a,b=map(math.radians,(-16.076,-57.681));x,y=map(math.radians,(lat,lon))
        h=math.sin((x-a)/2)**2+math.cos(a)*math.cos(x)*math.sin((y-b)/2)**2
        km=6371.0088*2*math.asin(math.sqrt(min(1,max(0,h))))
        if km<=150:return 1,'caceres_radius_150km'
    except (ValueError,TypeError,OverflowError):pass
    name=municipality_name(station.get('municipality'))
    # ANA legacy inventory may truncate municipality fields. Match only a long,
    # unambiguous prefix within the same UF; never infer a biome polygon.
    if name.startswith('SANTO ANTONIO DE '):name=name.replace('SANTO ANTONIO DE ','SANTO ANTONIO DO ',1)
    known=PANTANAL_MUNICIPALITIES.get(uf,set())
    if name in known:return 2,'pantanal_municipality_screening'
    if len(name)>=15 and sum(candidate.startswith(name) for candidate in known)==1:return 2,'screening_truncated_name'
    return 3,'national'

def regional_queue(ordered):
    near=[t for t in ordered if t.get('priority_rank',3)==1]
    pantanal=[t for t in ordered if t.get('priority_rank',3)==2]
    national=[t for t in ordered if t.get('priority_rank',3)==3]
    from collections import deque
    a,b=deque(near),deque(pantanal);prioritized=[]
    while a or b:
        for _ in range(3):
            if a:prioritized.append(a.popleft())
        if b:prioritized.append(b.popleft())
        elif a:prioritized.append(a.popleft())
    a,b=deque(prioritized),deque(national);result=[]
    while a or b:
        for _ in range(4):
            if a:result.append(a.popleft())
        if b:result.append(b.popleft())
        elif a:result.append(a.popleft())
    return result

def year_of(value, fallback, current_year=None):
    try: return max(1850,min(current_year or dt.date.today().year,int(str(value)[:4])))
    except (TypeError,ValueError): return fallback

def tasks(catalogs, today):
    groups={}
    for uf,stations in catalogs.items():
        group=[]
        for station in sorted(stations,key=lambda x:x['code']):
            rank,reason=station_priority(station,uf)
            for kind in station.get('candidate_variables',[]):
                if kind not in TYPES:continue
                periods=station.get('periods',{});prefix=PERIODS[kind]
                first=year_of(periods.get(prefix+'Inicio'),None,today.year)
                last=year_of(periods.get(prefix+'Fim'),today.year,today.year)
                unknown=first is None or last<first
                # Missing metadata does not mean a 176-year record exists.
                # A bounded recent discovery probe never claims older coverage.
                if unknown:first=max(1850,last-1)
                for start in reversed(list(range(first,last+1,60))):
                    for level in ('1','2'):
                        group.append(dict(uf=uf,code=station['code'],kind=kind,level=level,start=start,end=min(start+59,last),historical_start_unknown=unknown,priority_rank=rank,priority_reason=reason))
        groups[uf]=sorted(group,key=lambda t:(t['historical_start_unknown'],-t['end'],t['level']))
    for i in range(max(map(len,groups.values()),default=0)):
        for uf in STATES:
            if i<len(groups.get(uf,[])):yield groups[uf][i]

def expanded_tasks(base,state):
    out=[]
    def visit(t,not_before=''):
        rec=state['tasks'].get(key(t),{})
        inherited=max(not_before,rec.get('retry_after') or '')
        splits=rec.get('split_tasks')
        if splits:
            for child in splits:visit({**child,**{name:t[name] for name in ('priority_rank','priority_reason') if name in t}},inherited)
        else:out.append({**t,'not_before':inherited} if inherited else t)
    for task in base:visit(task)
    return out

def split_task(task):
    if task['end']-task['start']<10:return []
    # Failed broad window becomes bounded ten-year requests, newest first.
    return [{**task,'start':a,'end':min(a+9,task['end'])} for a in reversed(list(range(task['start'],task['end']+1,10)))]

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
    result=sorted((m for m in months.values() if m['dias']>0),key=lambda m:(m['ano'],m['mes']))
    ranges=old.get('checked_ranges',[])
    bounds={'start':f"{task['start']}-01-01",'end':f"{task['end']}-12-31"}
    if bounds not in ranges:ranges=ranges+[bounds]
    return dict(schema_version=1,station=task['code'],uf=task['uf'],variable=task['kind'],consistency=task['level'],unit=TYPES[task['kind']][2],source='ANA public legacy HidroSerieHistorica',months=result,years=annual(result,task['kind'],today),lastDate=max((m['last_date'] for m in result if m['last_date']),default=None),empty=not result,sparse_months=True,historical_start_unknown=task.get('historical_start_unknown',False),last_success_utc=attempt,collected_utc=attempt,complete_archive=False,checked_ranges=ranges,retained_after_regression=regressions,stale=bool(regressions) or old.get('stale',False),warning='Monthly archive; collection date is not measurement date. Incomplete months are excluded from climatology.')

def due_queue(all_tasks,state,today,now):
    monthly=[];bootstrap=[];historical=[]
    for t in all_tasks:
        r=state['tasks'].get(key(t),{});last=r.get('last_success_utc')
        if max(r.get('retry_after') or '',t.get('not_before') or '')>now:continue
        if not last:bootstrap.append(t)
        elif t['end']>=today.year-1 and last[:7]!=today.strftime('%Y-%m'):monthly.append(t)
        elif last[:4]!=str(today.year):historical.append(t)
    oldest=lambda t:state['tasks'].get(key(t),{}).get('last_attempt_utc','')
    monthly.sort(key=oldest);historical.sort(key=oldest)
    # Stable UF round-robin retained for ties. Newer windows first for discovery.
    bootstrap.sort(key=lambda t:(t.get('historical_start_unknown',False),oldest(t),-t['end'],t['level']))
    # Fair share to every class; spare capacity immediately used by other queues.
    result=[]
    for i in range(max(len(monthly),len(bootstrap),len(historical))):
        for group in (monthly,bootstrap,historical):
            if i<len(group):result.append(group[i])
    return regional_queue(result)

def archive_metrics(root):
    # Count each station/variable/level once; compact takes precedence over legacy.
    files={}
    for folder,pattern in (('summaries','*.json'),('compact','*.json.gz')):
        for p in (root/folder).rglob(pattern):
            relative=str(p.relative_to(root/folder)).removesuffix('.gz')
            files[relative]=p
    useful=set();series=0;observations=0;errors=0
    for path in files.values():
        try:
            data=decode(path.read_bytes()) if path.suffix=='.gz' else read(path,{})
            n=sum(row.get('dias',0) for row in data.get('years',[]))
            if n:
                useful.add(str(data['station']));series+=1;observations+=n
        except Exception:errors+=1
    return dict(archive_series=len(files),archive_useful_series=series,archive_useful_stations=len(useful),aggregate_valid_day_records=observations,metrics_read_errors=errors)

def run(args, request=fetch, today=None):
    today=today or dt.date.today(); root=pathlib.Path(args.root);statepath=root/'monthly-state.json'
    state=read(statepath,{'tasks':{},'schema_version':1});write(statepath,state);catalogs={uf:read(root/'catalog'/f'{uf}.json',{}).get('stations',[]) for uf in STATES}
    all_tasks=expanded_tasks(list(tasks(catalogs,today)),state);now=utcnow();queue=due_queue(all_tasks,state,today,now)
    begun=time.monotonic();attempted=0;success=0;limited=False
    pending=list(queue)
    while pending:
        want_national=attempted%5==4
        position=next((i for i,t in enumerate(pending) if (t.get('priority_rank',3)==3)==want_national),0)
        task=pending.pop(position)
        if attempted>=args.budget or time.monotonic()-begun>=args.max_seconds:break
        # A previous request in this run may already have returned this level.
        if state['tasks'].get(key(task),{}).get('last_success_utc','')>=now:continue
        attempted+=1;k=key(task);record={**state['tasks'].get(k,{}),'last_attempt_utc':utcnow()}
        path=root/'summaries'/task['kind']/task['code']/f"nivel{task['level']}.json"
        try:
            params={'codEstacao':task['code'],'dataInicio':f"01/01/{task['start']}",'dataFim':f"31/12/{task['end']}",'tipoDados':TYPES[task['kind']][0],'nivelConsistencia':task['level']}
            xml=request('HidroSerieHistorica',params,timeout=60,limit=8*1024*1024)
            parsed={year:parse_series(xml,task['code'],task['kind'],year) for year in range(task['start'],task['end']+1)}
            returned={r['consistency'] for data in parsed.values() for r in data['observations']}
            # Empty requested level is confirmed empty. An unreturned OTHER level
            # is not inferred empty and retains its own independent probe.
            levels=returned|{task['level']};planned={}
            for level in levels:
                target={**task,'level':level};incoming=[]
                for year,data in parsed.items():incoming.extend(summarize(data,year,level,task['kind']))
                outpath=path.with_name(f'nivel{level}.json')
                compressed=getattr(args,'compressed',False)
                gzpath=root/'compact'/task['kind']/task['code']/f'nivel{level}.json.gz'
                previous=decode(gzpath.read_bytes(),today=today) if compressed and gzpath.exists() else read(outpath,{})
                output=merge(previous,incoming,target,record['last_attempt_utc'],today)
                output['response_sha256']=hashlib.sha256(xml).hexdigest()
                if compressed:outpath=gzpath
                payload=(gzpath.read_bytes() if gzpath.exists() and scientifically_equal(previous,output) else encode(output)) if compressed else (json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8')
                planned[level]=(outpath,output,target,payload)
            size=sum(p.stat().st_size for dirname in ('summaries','compact') for p in (root/dirname).rglob('*.json*') if p.is_file())
            growth=sum(len(payload)-(p.stat().st_size if p.exists() else 0) for p,obj,_,payload in planned.values())
            if size+max(0,growth)>args.max_mib*1024*1024:limited=True;raise RuntimeError('summary_storage_limit')
            assetsroot=root.parent if root.name=='ana' else root
            assets_bytes=sum(p.stat().st_size for p in assetsroot.rglob('*') if p.is_file())
            if assets_bytes+max(0,growth)>750*1024*1024:limited=True;raise RuntimeError('total_assets_storage_limit')
            for level,(outpath,output,target,payload) in planned.items():
                write_bytes(outpath,payload)
                if level!=task['level']:
                    state['tasks'][key(target)]={**state['tasks'].get(key(target),{}),'status':'ok_shared_response','last_success_utc':record['last_attempt_utc'],'last_attempt_utc':record['last_attempt_utc'],'retry_after':None}
            record.update(status='ok',last_success_utc=record['last_attempt_utc'],retry_after=None);success+=1
        except Exception as exc:
            record.update(status='error_preserved',error_type=type(exc).__name__,retry_after=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=24)).isoformat())
            # Do not split authentication/HTTP/schema failures into more traffic.
            if isinstance(exc,(TimeoutError,socket.timeout)) or str(exc)=='response_too_large':
                children=split_task(task)
                if children:record.update(status='split_pending',split_tasks=children)
        state['tasks'][k]=record;write(statepath,state)
        if args.delay:time.sleep(args.delay)
    status=dict(schema_version=1,last_run_utc=now,requests_this_run=attempted,success_this_run=success,catalog_ufs=sum(bool(s) for s in catalogs.values()),tasks_total=len(all_tasks),tasks_completed=sum(bool(state['tasks'].get(key(t),{}).get('last_success_utc')) for t in all_tasks),storage_limited=limited,unknown_start_tasks=sum(t.get('historical_start_unknown',False) for t in all_tasks),priority_policy='4 regional slots to 1 national; regional 3 radius150km to 1 municipality; municipal screening not biome polygon',priority_tasks={str(rank):sum(t.get('priority_rank',3)==rank for t in all_tasks) for rank in (1,2,3)},national_series_complete=False,warning='Staged national bootstrap including inactive stations. Successful empty queries do not imply observations exist. Monthly revisions; no guarantee all stations are current.')
    status.update(archive_metrics(root))
    write(root/'monthly-status.json',status);return status

def main():
    p=argparse.ArgumentParser();p.add_argument('--compressed',action='store_true');p.add_argument('--root',default='assets/ana');p.add_argument('--budget',type=int,default=100);p.add_argument('--max-seconds',type=int,default=1500);p.add_argument('--max-mib',type=int,default=350);p.add_argument('--delay',type=float,default=2)
    args=p.parse_args()
    if not 0<=args.budget<=100 or not 1<=args.max_seconds<=1800 or not 1<=args.max_mib<=350 or not 1<=args.delay<=10:p.error('Unsafe budget')
    print(json.dumps(run(args),ensure_ascii=False))
if __name__=='__main__':main()
