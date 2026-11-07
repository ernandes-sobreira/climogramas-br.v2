#!/usr/bin/env python3
"""Bounded public ANA telemetry snapshots. No credentials; rainfall is not aggregated."""
import argparse,datetime as dt,json,math,pathlib,re,urllib.parse,urllib.request,xml.etree.ElementTree as ET,os,time
BASE='https://telemetriaws1.ana.gov.br/ServiceANA.asmx/'
UFS=set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split())
ROOT=pathlib.Path(__file__).resolve().parents[1]
SENTINELS={-999,-999.1,-999.2,-9999,-99999}
def utcnow():return dt.datetime.now(dt.timezone.utc)
def iso(t):return t.isoformat().replace('+00:00','Z')
def num(v):
    if v is None or isinstance(v,bool) or not str(v).strip():return None
    try:n=float(str(v).strip().replace(',','.'))
    except(ValueError,TypeError):return None
    return n if math.isfinite(n) and n not in SENTINELS else None
def rows(xml,tag):
    root=ET.fromstring(xml)
    return [{c.tag.split('}')[-1]:(c.text or '').strip() for c in row} for row in root.iter() if row.tag.split('}')[-1]==tag]
def parse_catalog(xml,checked_at):
    bycode={};duplicates=0
    for x in rows(xml,'Table'):
        code=x.get('CodEstacao','')
        if not re.fullmatch(r'\d{5,8}',code):continue
        cityuf=x.get('Municipio-UF','');match=re.search(r'-\s*([A-Z]{2})\s*$',cityuf);uf=match.group(1) if match and match.group(1) in UFS else None
        if code in bycode:
            duplicates+=1;rec=bycode[code]
            rec['origins']=sorted(set(rec['origins']+[x.get('Origem','')])-{''});rec['statuses']=sorted(set(rec['statuses']+[x.get('StatusEstacao','')])-{''});rec['active']=any(v.lower()=='ativo' for v in rec['statuses']);rec['status']='Ativo' if rec['active'] else (rec['statuses'][0] if rec['statuses'] else '')
            if not rec['uf'] and uf:rec['uf']=uf;rec['municipality_uf']=cityuf
            continue
        bycode[code]={'code':code,'name':x.get('NomeEstacao',''),'uf':uf,'municipality_uf':cityuf,'lat':num(x.get('Latitude')),'lon':num(x.get('Longitude')),'river':x.get('NomeRio',''),'status':x.get('StatusEstacao',''),'statuses':[x.get('StatusEstacao','')],'origins':[x.get('Origem','')],'active':x.get('StatusEstacao','').lower()=='ativo'}
    if not bycode:raise ValueError('empty_catalog')
    return {'schema_version':1,'checked_at':checked_at,'source':BASE+'ListaEstacoesTelemetricas','stations':sorted(bycode.values(),key=lambda x:x['code']),'quality':{'duplicate_codes':duplicates},'coverage':'telemetric_catalog_not_all_historical_stations'}
def valid_datetime(raw):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}',raw or ''):return False
    try:dt.datetime.strptime(raw.replace('T',' '),'%Y-%m-%d %H:%M:%S');return True
    except ValueError:return False
def parse_series(xml,station,checked_at,requested_start=None,requested_end=None):
    if not re.fullmatch(r'\d{5,8}',station):raise ValueError('invalid_station')
    bytime={};quality={'station_mismatches':0,'invalid_datetime':0,'duplicate_rows':0,'conflicts':0,'records_without_level_or_flow':0}
    for x in rows(xml,'DadosHidrometereologicos'):
        if x.get('CodEstacao')!=station:quality['station_mismatches']+=1;continue
        raw=x.get('DataHora','').strip()
        if not valid_datetime(raw):quality['invalid_datetime']+=1;continue
        if requested_start and raw[:10]<requested_start or requested_end and raw[:10]>requested_end:continue
        level=num(x.get('Nivel'));flow=num(x.get('Vazao'))
        row={'station':station,'datetime_raw':raw,'level_cm':level,'flow_m3_s':flow}
        key=raw.replace('T',' ')
        if key in bytime:
            if bytime[key]==row:quality['duplicate_rows']+=1
            else:bytime[key]=None;quality['conflicts']+=1
        else:bytime[key]=row
    records=[bytime[k] for k in sorted(bytime) if bytime[k] is not None]
    quality['records_without_level_or_flow']=sum(r['level_cm'] is None and r['flow_m3_s'] is None for r in records)
    latest={field:next(({'datetime_raw':r['datetime_raw'],'value':r[field]}for r in reversed(records)if r[field] is not None),None)for field in ('level_cm','flow_m3_s')}
    return {'schema_version':1,'code':station,'checked_at':checked_at,'source':BASE+'DadosHidrometeorologicos','requested_start':requested_start,'requested_end':requested_end,'quality_status':'provisional_unverified','datetime_timezone':'not_declared_by_source','records':records,'latest':latest,'last_record_raw':records[-1]['datetime_raw'] if records else None,'quality':quality,'rainfall':'not_exposed_interval_and_accumulation_unverified'}
def fetch_xml(route,params=None,limit=8_000_000):
    url=BASE+route+('?' + urllib.parse.urlencode(params) if params is not None else '')
    req=urllib.request.Request(url,headers={'User-Agent':'ClimogramasBR public hydrological data','Accept':'application/xml,text/xml'})
    with urllib.request.urlopen(req,timeout=60) as r:data=r.read(limit+1)
    if len(data)>limit:raise ValueError('body_limit')
    return data
def load(path,default=None):
    try:return json.loads(path.read_text())
    except FileNotFoundError:return default

def save(path,value):
    text=json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n';path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix('.tmp');temp.write_text(text);os.replace(temp,path)

def cache_size(base):return sum(p.stat().st_size for p in base.rglob('*.json') if p.is_file())
def save_budgeted(path,value,base,max_bytes,total_max_bytes):
    # Reserve status capacity; at the cap an existing file may still shrink.
    encoded=(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf8')
    old=path.stat().st_size if path.exists() else 0
    total=cache_size(base);reserve=min(2*1024*1024,max_bytes//4)
    shared_root=base.parent if base.name=='recent' else base
    global_total=cache_size(shared_root)
    over=total-old+len(encoded)>max_bytes-reserve or global_total-old+len(encoded)>total_max_bytes-reserve
    if over and not (old and len(encoded)<=old):return False
    save(path,value);return True

def sync(base,budget=20,now=None,fetch=fetch_xml,max_seconds=300,max_bytes=150*1024*1024,total_max_bytes=350*1024*1024):
    if not 1<=budget<=50:raise ValueError('budget_out_of_bounds')
    if not 90<=max_seconds<=3600:raise ValueError('time_budget_out_of_bounds')
    if max_bytes<=0 or total_max_bytes<=0:raise ValueError('storage_cap_out_of_bounds')
    deadline=time.monotonic()+max_seconds
    now=now or utcnow();checked=iso(now);old=load(base/'status.json',{});status=dict(old);status.update(schema_version=1,last_attempt_utc=checked,budget=budget)
    catalog=load(base/'catalog.json');catalog_failure=None
    try:
        last=dt.datetime.fromisoformat(catalog['checked_at'].replace('Z','+00:00')) if catalog else None
        if not last or now-last>dt.timedelta(days=7):
            catalog=parse_catalog(fetch('ListaEstacoesTelemetricas',{'statusEstacoes':'','origem':''},16_000_000),checked)
            if not save_budgeted(base/'catalog.json',catalog,base,max_bytes,total_max_bytes):catalog_failure='storage_limit_preserved'
    except Exception as exc:catalog_failure=type(exc).__name__
    if not catalog:
        status.update(status='error',error='catalog_unavailable',catalog_error=catalog_failure);save(base/'status.json',status);return status
    stations=[s for s in catalog['stations'] if s.get('uf') in UFS];codes=[s['code'] for s in stations]
    if not codes:raise ValueError('no_brazil_stations')
    cursor=int(old.get('cursor',0))%len(codes);chosen=[codes[(cursor+i)%len(codes)]for i in range(min(budget,len(codes)))];success=0;failures=[];attempted=0;time_exhausted=False;storage_limited=[]
    start=(now.date()-dt.timedelta(days=1)).isoformat();end=now.date().isoformat();entries=dict(old.get('stations',{}))
    for code in chosen:
        if deadline-time.monotonic()<65:time_exhausted=True;break
        attempted+=1
        entry=dict(entries.get(code,{}));entry['last_attempt_utc']=checked
        try:
            payload=parse_series(fetch('DadosHidrometeorologicos',{'codEstacao':code,'dataInicio':dt.date.fromisoformat(start).strftime('%d/%m/%Y'),'dataFim':dt.date.fromisoformat(end).strftime('%d/%m/%Y')},8_000_000),code,checked,start,end)
            # Empty newer response is evidence of no current observations, not permission to erase older valid data.
            target=base/'stations'/f'{code}.json';prior=load(target)
            usable=any(r['level_cm'] is not None or r['flow_m3_s'] is not None for r in payload['records'])
            prior_usable=prior and any(r.get('level_cm') is not None or r.get('flow_m3_s') is not None for r in prior.get('records',[]))
            if not usable and prior_usable:
                entry.update(status='no_recent_level_or_flow',last_success_utc=checked,records=len(payload['records']),preserved_previous=True)
            else:
                if save_budgeted(target,payload,base,max_bytes,total_max_bytes):entry.update(status='ok',last_success_utc=checked,records=len(payload['records']),preserved_previous=False)
                else:entry.update(status='storage_limit_preserved',last_query_success_utc=checked,preserved_previous=bool(prior));storage_limited.append(code)
            entry.pop('error',None);success+=1
        except Exception as exc:entry.update(status='error',error=type(exc).__name__);failures.append(code)
        entries[code]=entry
    status.update(status='partial' if failures or catalog_failure or time_exhausted or storage_limited else 'ok',catalog_error=catalog_failure,cursor=(cursor+attempted)%len(codes),catalog_brazil_stations=len(codes),checked_this_run=attempted,time_budget_exhausted=time_exhausted,success_this_run=success,failed_this_run=failures,storage_limited_this_run=storage_limited,storage_cap_bytes=max_bytes,total_ana_cap_bytes=total_max_bytes,snapshots_persisted=len(list((base/'stations').glob('*.json'))),rotation_runs_at_budget=math.ceil(len(codes)/budget),stations=entries,coverage_note='Rotational bounded sample. Not all Brazilian stations are checked every run.')
    if success:status['last_success_utc']=checked
    status['cache_bytes']=cache_size(base);save(base/'status.json',status);status['cache_bytes']=cache_size(base);save(base/'status.json',status);return status

def main():
    p=argparse.ArgumentParser();p.add_argument('--budget',type=int,default=20);p.add_argument('--max-seconds',type=int,default=300);p.add_argument('--max-mib',type=float,default=150);p.add_argument('--total-ana-max-mib',type=float,default=350);p.add_argument('--base',type=pathlib.Path,default=ROOT/'assets/ana/recent');a=p.parse_args();s=sync(a.base,a.budget,max_seconds=a.max_seconds,max_bytes=int(a.max_mib*1024*1024),total_max_bytes=int(a.total_ana_max_mib*1024*1024));print(json.dumps({k:v for k,v in s.items()if k!='stations'}));return 1 if s['status']=='error' else 0
if __name__=='__main__':raise SystemExit(main())
