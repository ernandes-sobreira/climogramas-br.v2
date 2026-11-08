#!/usr/bin/env python3
"""Bounded, resumable ANA public collector. No authentication, no third-party deps.
Fetches only explicitly budgeted requests; does not claim every station is current.
"""
import argparse, calendar, datetime as dt, hashlib, json, math, pathlib, time, unicodedata
import urllib.parse, urllib.request, xml.etree.ElementTree as ET
BASE='https://telemetriaws1.ana.gov.br/ServiceANA.asmx/'
STATES=dict(zip('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(),['ACRE','ALAGOAS','AMAPÁ','AMAZONAS','BAHIA','CEARÁ','DISTRITO FEDERAL','ESPÍRITO SANTO','GOIÁS','MARANHÃO','MATO GROSSO','MATO GROSSO DO SUL','MINAS GERAIS','PARÁ','PARAÍBA','PARANÁ','PERNAMBUCO','PIAUÍ','RIO DE JANEIRO','RIO GRANDE DO NORTE','RIO GRANDE DO SUL','RONDÔNIA','RORAIMA','SANTA CATARINA','SÃO PAULO','SERGIPE','TOCANTINS']))
TYPES={'chuva':('2','Chuva','mm'),'cotas':('1','Cota','cm'),'vazao':('3','Vazao','m³/s')}
SENTINELS={-999,-999.1,-999.2,-9999,-99999}
def utcnow(): return dt.datetime.now(dt.timezone.utc).isoformat()
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD',str(s or '')) if unicodedata.category(c)!='Mn').strip().upper()
def num(s):
    if s is None or not str(s).strip(): return None
    try: v=float(str(s).strip().replace(',','.'))
    except ValueError: return None
    return v if math.isfinite(v) and v not in SENTINELS else None
def local(tag): return tag.rsplit('}',1)[-1]
def rows(xml,tag):
    # No DTD/entities are needed for official datasets; fail closed.
    if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper(): raise ValueError('unsafe_xml')
    root=ET.fromstring(xml)
    if local(root.tag) not in ('DataSet','NewDataSet','DataTable'): raise ValueError('unexpected_xml_root')
    return [{local(c.tag):c.text or '' for c in el} for el in root.iter() if local(el.tag)==tag]
def parse_inventory(xml,uf):
    out={}
    for r in rows(xml,'Table'):
        if norm(r.get('nmEstado'))!=norm(STATES[uf]): continue
        code=r.get('Codigo','').strip(); typ=r.get('TipoEstacao','')
        if not code.isdigit() or not 5<=len(code)<=8 or typ not in ('1','2'): continue
        variables=['chuva'] if typ=='2' else ['cotas','vazao']
        # All catalog stations, including inactive ones, are retained. Availability
        # of a specific variable must be checked, never inferred from type alone.
        out[code]={'code':code,'name':r.get('Nome',''),'uf':uf,'municipality':r.get('nmMunicipio',''),'river':r.get('RioNome',''),'lat':num(r.get('Latitude')),'lon':num(r.get('Longitude')),'operating':r.get('Operando'),'station_type':typ,'candidate_variables':variables,'periods':{k:r.get(k) for k in ('PeriodoPluviometroInicio','PeriodoPluviometroFim','PeriodoEscalaInicio','PeriodoEscalaFim','PeriodoDescLiquidaInicio','PeriodoDescLiquidaFim')}}
    if not out: raise ValueError('empty_or_unrecognized_inventory')
    return sorted(out.values(),key=lambda x:int(x['code']))
def parse_series(xml,station,kind,year):
    _,prefix,unit=TYPES[kind]; bykey={}; matched=0
    for r in rows(xml,'SerieHistorica'):
        if r.get('EstacaoCodigo','').strip()!=station: continue
        level=r.get('NivelConsistencia','').strip()
        if level not in ('1','2'): continue
        try: month=dt.date.fromisoformat(r.get('DataHora','')[:10])
        except ValueError: continue
        if month.year!=year: continue
        matched+=1
        for day in range(1,calendar.monthrange(year,month.month)[1]+1):
            keyfield=prefix+f'{day:02d}'
            if keyfield not in r: continue
            value=num(r[keyfield]); status=r.get(keyfield+'Status','').strip()
            if kind=='chuva' and value is not None and value<0: value=None
            date=f'{year}-{month.month:02d}-{day:02d}'
            obs={'date':date,'consistency':level,'value':value,'status':status,'usable':value is not None and status=='1'}
            key=(date,level)
            if key in bykey and bykey[key]!=obs:
                bykey[key]={'date':date,'consistency':level,'value':None,'status':'conflict','usable':False}
            else: bykey.setdefault(key,obs)
    return {'unit':unit,'matching_month_rows':matched,'observations':sorted(bykey.values(),key=lambda x:(x['date'],x['consistency']))}
def read(path,default):
    try: return json.loads(path.read_text())
    except FileNotFoundError: return default

def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(path)
def fetch(route,params,timeout=55,limit=32*1024*1024):
    req=urllib.request.Request(BASE+route+'?'+urllib.parse.urlencode(params),headers={'User-Agent':'ClimogramasBR-public-data/1.0','Accept':'application/xml'})
    with urllib.request.urlopen(req,timeout=timeout) as res:
        if res.url.split('?')[0]!=BASE+route: raise ValueError('unexpected_redirect')
        data=res.read(limit+1)
        if len(data)>limit: raise ValueError('response_too_large')
        return data

def catalog_params(uf):
    return {k:(STATES[uf] if k=='nmEstado' else '') for k in ('codEstDE','codEstATE','tpEst','nmEst','nmRio','codSubBacia','codBacia','nmMunicipio','nmEstado','sgResp','sgOper','telemetrica')}
def series_params(task):
    code,kind,year,level=task['code'],task['kind'],task['year'],task['level']
    return {'codEstacao':code,'dataInicio':f'01/01/{year}','dataFim':f'31/12/{year}','tipoDados':TYPES[kind][0],'nivelConsistencia':level}

def build_tasks(catalogs,years,active_only=False):
    # Round-robin UF ordering prevents large states monopolizing the first run.
    groups={}
    for uf,stations in catalogs.items():
        groups[uf]=[{'uf':uf,'code':s['code'],'kind':kind,'year':year,'level':level} for s in stations if not active_only or s.get('operating')=='1' for kind in s['candidate_variables'] for year in years for level in ('1','2')]
    result=[];n=max((len(v) for v in groups.values()),default=0)
    for i in range(n):
        for uf in STATES:
            if i<len(groups.get(uf,[])): result.append(groups[uf][i])
    return result

def timestamp(value):
    try:return dt.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError,AttributeError):return 0

def next_due(attempt,hours):
    return (dt.datetime.fromisoformat(attempt)+dt.timedelta(hours=hours)).isoformat()

def adaptive_tasks(catalogs,years,state,now):
    """Discover latest year once, not four empty year/level combinations.
    Both levels returned by ANA remain separate on disk. A previous-year probe
    is allowed only after current-year discovery or if it already held data.
    Half the request slots favor due proven series; half discover geographically.
    """
    current=max(years); all_tasks=build_tasks(catalogs,[current],active_only=True)
    all_tasks=[t for t in all_tasks if t['level']=='1']
    historical=[]
    for t in all_tasks:
        cur=state['tasks'].get(taskkey(t),{})
        for year in years:
            if year==current:continue
            old={**t,'year':year}; rec=state['tasks'].get(taskkey(old),{})
            if rec.get('usable_response_count',0)>0 or (cur.get('last_success_utc') and not cur.get('usable_response_count',0)):
                historical.append(old)
    all_tasks+=historical
    due=[t for t in all_tasks if timestamp(state['tasks'].get(taskkey(t),{}).get('next_due_utc'))<=timestamp(now)]
    positive=[]; discovery=[]
    for t in due:
        r=state['tasks'].get(taskkey(t),{})
        (positive if r.get('usable_response_count',0)>0 else discovery).append(t)
    positive.sort(key=lambda t:state['tasks'].get(taskkey(t),{}).get('last_attempt_utc',''))
    discovery.sort(key=lambda t:(t['year']!=current,state['tasks'].get(taskkey(t),{}).get('last_attempt_utc','')))
    queue=[]
    for i in range(max(len(positive),len(discovery))):
        if i<len(positive):queue.append(positive[i])
        if i<len(discovery):queue.append(discovery[i])
    return queue,all_tasks

def set_next_due(rec,attempt,year):
    if rec.get('status')=='error':
        rec['consecutive_failures']=rec.get('consecutive_failures',0)+1
        hours=min(168,3*2**min(rec['consecutive_failures']-1,6))
    else:
        rec['consecutive_failures']=0
        if not rec.get('usable_response_count',0):hours=24*30
        elif year<dt.date.today().year:hours=24*30
        elif (dt.date.today()-dt.date.fromisoformat(rec['latest_observation_date'])).days>14:hours=24*7
        else:hours=24
    rec['next_due_utc']=next_due(attempt,hours)

def taskkey(t):return f"{t['uf']}:{t['code']}:{t['kind']}:{t['year']}:{t['level']}"

def merge_success(old,parsed,task,attempt):
    # A syntactically valid empty response is not permission to erase history.
    merged={ (r['date'],r['consistency']):r for r in old.get('observations',[]) }
    for obs in parsed['observations']:
        key=(obs['date'],obs['consistency']);previous=merged.get(key,{})
        unchanged=all(previous.get(k)==v for k,v in obs.items())
        merged[key]={**obs,'last_changed_utc':previous.get('last_changed_utc',attempt) if unchanged else attempt}
    observations=sorted(merged.values(),key=lambda x:(x['date'],x['consistency']))
    usable=[r for r in observations if r.get('usable')]
    return {**old,'schema_version':1,'source':'ANA public legacy HidroSerieHistorica','station':task['code'],'uf':task['uf'],'variable':task['kind'],'year':task['year'],'unit':parsed['unit'],'last_attempt_utc':attempt,'last_success_utc':attempt,'last_response_matching_months':parsed['matching_month_rows'],'last_response_count':len(parsed['observations']),'last_result':'ok' if parsed['observations'] else 'empty_preserved','observations':observations,'latest_observation_date':max((r['date'] for r in usable),default=None),'warning':'Secondary historical source; retrieval date is not measurement date. Retained rows carry their own last_changed_utc.'}

def level_views(data,task,attempt):
    views={}
    _,field,_=TYPES[task['kind']]
    for level in ('1','2'):
        selected=[r for r in data['observations'] if r['consistency']==level]
        usable=[r for r in selected if r.get('usable')]
        count=len(usable);expected=366 if calendar.isleap(task['year']) else 365
        output={'schema_version':1,'source':data['source'],'station':task['code'],'uf':task['uf'],'variable':task['kind'],'year':task['year'],'consistency':level,'unit':data['unit'],
          'last_attempt_utc':attempt,'last_success_utc':max((r.get('last_changed_utc','') for r in selected),default=None),
          'latest_observation_date':max((r['date'] for r in usable),default=None),
          'coverage':{'valid_days':count,'expected_days':expected,'fraction':count/expected,'complete':count==expected and task['year']<dt.date.today().year},
          'quality':{'excludedStatus':sum(r['value'] is not None and r['status'] not in ('1','conflict') for r in selected),'missing':sum(r['value'] is None and r['status']!='conflict' for r in selected),'conflicts':sum(r['status']=='conflict' for r in selected)},
          'items':[{'Data':r['date'],field:r['value'],'NivelConsistencia':level,'Status':r['status'],'last_changed_utc':r.get('last_changed_utc')} for r in usable],
          'warning':data['warning']}
        # Empty unknown levels are still represented, without asserting source success.
        views[level]=output
    return views

def run(args,request=fetch,clock=time.monotonic):
    root=pathlib.Path(args.output);root.mkdir(parents=True,exist_ok=True)
    state=read(root/'state.json',{'catalog_cursor':0,'tasks':{},'catalog_attempts':{},'runs':0})
    started=clock();requests=0;now=utcnow();ufs=list(STATES)
    # Incremental catalog bootstrap/refresh: bounded independent state per UF.
    adaptive=getattr(args,'adaptive',False)
    candidates=ufs[state['catalog_cursor']%27:]+ufs[:state['catalog_cursor']%27]
    if adaptive:
        candidates=[u for u in candidates if timestamp(state['catalog_attempts'].get(u,{}).get('next_due_utc'))<=timestamp(now)]
        candidates.sort(key=lambda u:(bool(state['catalog_attempts'].get(u,{}).get('last_success_utc')),state['catalog_attempts'].get(u,{}).get('last_attempt_utc','')))
    for uf in candidates[:args.catalog_budget]:
        if clock()-started>=args.max_seconds:break
        state['catalog_cursor']=(ufs.index(uf)+1)%len(ufs)
        record={'last_attempt_utc':utcnow()};path=root/'catalog'/f'{uf}.json';previous=read(path,{})
        try:
            requests+=1;xml=request('HidroInventario',catalog_params(uf));stations=parse_inventory(xml,uf)
            if previous.get('stations')!=stations:
                write(path,{'schema_version':1,'uf':uf,'source':'ANA public legacy HidroInventario','fetched_utc':record['last_attempt_utc'],'sha256':hashlib.sha256(xml).hexdigest(),'stations':stations})
            record.update(last_success_utc=record['last_attempt_utc'],status='ok',count=len(stations))
        except Exception as exc:
            record.update(status='error',error_type=type(exc).__name__,last_success_utc=state['catalog_attempts'].get(uf,{}).get('last_success_utc'))
        if adaptive:
            failures=state['catalog_attempts'].get(uf,{}).get('consecutive_failures',0)+1 if record['status']=='error' else 0
            record['consecutive_failures']=failures
            record['next_due_utc']=next_due(record['last_attempt_utc'],min(72,2**min(failures-1,7)) if failures else 24*30)
        state['catalog_attempts'][uf]=record
        write(root/'state.json',state)
        if args.delay_seconds:time.sleep(args.delay_seconds)
    catalogs={uf:read(root/'catalog'/f'{uf}.json',{}).get('stations',[]) for uf in STATES}
    catalogs={uf:v for uf,v in catalogs.items() if v}
    tasks=build_tasks(catalogs,args.years,active_only=not getattr(args,'include_inactive',False))
    # Earliest attempt first; stable geographic round-robin among new tasks.
    tasks.sort(key=lambda t:state['tasks'].get(taskkey(t),{}).get('last_attempt_utc',''))
    all_tasks=tasks
    if adaptive:tasks,all_tasks=adaptive_tasks(catalogs,args.years,state,now)
    completed=0;storage_limited=False;cache_limit=getattr(args,'max_cache_mib',350)*1024*1024
    cache_bytes=sum(p.stat().st_size for p in root.rglob('*.json'))
    storage_limited=cache_bytes>=cache_limit
    for task in tasks:
        if completed>=args.series_budget:break
        if clock()-started>=args.max_seconds:break
        path=root/'series'/task['kind']/task['code']/f"{task['year']}.json"
        if cache_bytes>=cache_limit and not path.exists():
            storage_limited=True;continue
        attempt=utcnow();key=taskkey(task);oldtask=state['tasks'].get(key,{})
        old=read(path,{})
        rec={**oldtask,'last_attempt_utc':attempt}
        try:
            requests+=1;xml=request('HidroSerieHistorica',series_params(task));parsed=parse_series(xml,task['code'],task['kind'],task['year'])
            data=merge_success(old,parsed,task,attempt)
            changed=old.get('observations')!=data['observations'] or not path.exists()
            persisted=True
            if changed:
                planned={path:data,**{path.with_name(f"{task['year']}-nivel{level}.json"):obj for level,obj in level_views(data,task,attempt).items()}}
                growth=sum(len((json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n').encode())-(p.stat().st_size if p.exists() else 0) for p,obj in planned.items())
                if growth>0 and cache_bytes+growth>cache_limit:
                    storage_limited=True;persisted=False
                else:
                    for p,obj in planned.items():write(p,obj)
                    cache_bytes+=growth
            visible=data if persisted else old
            confirmed_levels={r['consistency'] for r in parsed['observations']}
            for level in confirmed_levels | {task['level']}:
                checkpath=path.with_name(f"{task['year']}-nivel{level}-status.json")
                priorcheck=read(checkpath,{})
                levelrows=[r for r in parsed['observations'] if r['consistency']==level]
                retained=[r for r in visible.get('observations',[]) if r['consistency']==level and r.get('usable')]
                write(checkpath,{'last_attempt_utc':attempt,'last_success_utc':attempt,'last_confirmed_utc':attempt if levelrows else priorcheck.get('last_confirmed_utc'),'last_result':('ok' if levelrows else 'empty_preserved') if persisted else 'storage_limit_preserved','latest_observation_date':max((r['date'] for r in retained),default=None),'snapshot_changed':changed and persisted,'requested_consistency':task['level'],'consistency':level,'response_count':len(levelrows)})
            rec.update(status=data['last_result'] if persisted else 'storage_limit_preserved',last_success_utc=attempt,response_count=len(parsed['observations']),usable_response_count=sum(r['usable'] for r in parsed['observations']),latest_observation_date=visible.get('latest_observation_date'),upstream_latest_observation_date=data['latest_observation_date'])
        except Exception as exc:
            rec.update(status='error',error_type=type(exc).__name__)
            priorcheck=read(path.with_name(f"{task['year']}-nivel{task['level']}-status.json"),{})
            write(path.with_name(f"{task['year']}-nivel{task['level']}-status.json"),{**priorcheck,'last_attempt_utc':attempt,'last_result':'error_preserved','error_type':type(exc).__name__})
            # Never write an error into a successful series file or discard it.
        if adaptive:set_next_due(rec,attempt,task['year'])
        state['tasks'][key]=rec;completed+=1;write(root/'state.json',state)
        if args.delay_seconds:time.sleep(args.delay_seconds)
    state['runs']+=1;state['last_run_utc']=now
    if args.catalog_budget>=27:state['bootstrap_attempted']=True
    write(root/'state.json',state)
    records=[state['tasks'].get(taskkey(t),{}) for t in all_tasks]
    status={'schema_version':1,'last_run_utc':now,'requests_this_run':requests,'storage_limited':storage_limited,'cache_limit_bytes':cache_limit,'series_attempts_this_run':completed,'catalog_ufs_available':len(catalogs),'catalog_ufs_expected':27,'catalog_complete':len(catalogs)==27,'catalog_status':state['catalog_attempts'],'catalog_station_count':sum(map(len,catalogs.values())),'years_requested':args.years,'task_count':len(all_tasks),'due_tasks_this_run':len(tasks),'adaptive_queue':adaptive,'queue_policy':'latest-year level1 discovery; separate returned levels; positive refresh plus discovery; empty30days/error backoff' if adaptive else 'legacy exhaustive','tasks_attempted':sum(bool(r) for r in records),'tasks_successful':sum(bool(r.get('last_success_utc')) for r in records),'tasks_with_usable_observations':sum(r.get('usable_response_count',0)>0 for r in records),'tasks_with_retained_data':sum(bool(r.get('latest_observation_date')) for r in records),'recent_queue_active_only':not getattr(args,'include_inactive',False),'inactive_or_unknown_stations_not_in_recent_queue':sum(s.get('operating')!='1' for v in catalogs.values() for s in v),'tasks_last_error':sum(r.get('status')=='error' for r in records),'configured_series_budget_per_run':args.series_budget,'minimum_runs_per_rotation':math.ceil(len(all_tasks)/args.series_budget) if args.series_budget else None,'national_series_complete':False,'last_success_utc':max((r['last_success_utc'] for r in records if r.get('last_success_utc')),default=None),'last_attempt_utc':max((r['last_attempt_utc'] for r in records if r.get('last_attempt_utc')),default=None),'cache_bytes':sum(p.stat().st_size for p in root.rglob('*.json')), 'warning':'Incremental rotating cache, not simultaneous national refresh. Counted tasks include station/variable/year/consistency combinations; successful retrieval does not imply fresh or complete measurements.'}
    write(root/'status.json',status);print(json.dumps(status,ensure_ascii=False));return status

def main():
    p=argparse.ArgumentParser();p.add_argument('--legacy-queue',action='store_true');p.add_argument('--output',default='assets/ana');p.add_argument('--catalog-budget',type=int,default=1);p.add_argument('--series-budget',type=int,default=20);p.add_argument('--max-seconds',type=int,default=900);p.add_argument('--delay-seconds',type=float,default=2);p.add_argument('--years',nargs='+',type=int);p.add_argument('--include-inactive',action='store_true');p.add_argument('--max-cache-mib',type=int,default=350)
    args=p.parse_args();args.adaptive=not args.legacy_queue;args.years=args.years or [dt.date.today().year-1,dt.date.today().year]
    if not 10<=args.max_cache_mib<=500 or not 0<=args.catalog_budget<=27 or not 0<=args.series_budget<=100 or not 1<=args.max_seconds<=1800 or not 1<=len(args.years)<=2 or any(y<1850 or y>dt.date.today().year for y in args.years):p.error('unsafe_budget_or_years')
    run(args)
if __name__=='__main__':main()

