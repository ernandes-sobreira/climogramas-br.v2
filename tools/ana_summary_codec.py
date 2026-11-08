"""Lossless compact monthly summary transport. No raw daily measurements.
Amounts retain JSON numeric precision; no rounding or missing->zero conversion.
"""
import calendar, datetime as dt, gzip, json, math, pathlib
COLUMNS=['yyyymm','sum','valid_days','last_day']
MAX_DECOMPRESSED=16*1024*1024

def compact(summary):
    if summary.get('schema_version')!=1:raise ValueError('Expected summary schema1')
    output={k:v for k,v in summary.items() if k not in ('months','years','schema_version')}
    rows=[]
    for month in summary.get('months',[]):
        year=month['ano'];m=month['mes'];n=month['dias'];total=month['sum']
        if not isinstance(year,int) or not 1850<=year<=2200 or not isinstance(m,int) or not 1<=m<=12:raise ValueError('Invalid month')
        expected=calendar.monthrange(year,m)[1]
        if not isinstance(n,int) or not 0<=n<=expected:raise ValueError('Invalid day count')
        if not n:continue
        if isinstance(total,bool) or not isinstance(total,(int,float)) or not math.isfinite(total):raise ValueError('Invalid sum')
        last=month.get('last_date');last_day=None
        if last:
            date=dt.date.fromisoformat(last)
            if date.year!=year or date.month!=m:raise ValueError('Invalid last date')
            last_day=date.day
        rows.append([year*100+m,total,n,last_day])
    rows.sort(key=lambda r:r[0])
    if len({r[0] for r in rows})!=len(rows):raise ValueError('Duplicate month')
    output.update(schema_version=2,row_columns=COLUMNS,month_rows=rows,annual_values=[[y['ano'],y['valor']] for y in summary.get('years',[]) if y.get('dias',0)>0],sparse_months=True,empty=not rows)
    return output

def expand(packed,today=None):
    today=today or dt.date.today()
    if packed.get('schema_version')!=2 or packed.get('row_columns')!=COLUMNS:raise ValueError('Unsupported schema')
    if packed.get('variable') not in ('chuva','cotas','vazao'):raise ValueError('Unsupported variable')
    months=[];seen=set()
    for row in packed.get('month_rows',[]):
        if not isinstance(row,list) or len(row)!=4:raise ValueError('Invalid compact row')
        ym,total,n,last_day=row
        if not isinstance(ym,int):raise ValueError('Invalid year-month')
        year,m=divmod(ym,100)
        if not 1850<=year<=2200 or not 1<=m<=12 or ym in seen:raise ValueError('Invalid or duplicate year-month')
        expected=calendar.monthrange(year,m)[1];seen.add(ym)
        if isinstance(total,bool) or not isinstance(total,(float,int)) or not math.isfinite(total):raise ValueError('Invalid sum')
        if not isinstance(n,int) or not 1<=n<=expected:raise ValueError('Invalid day count')
        if last_day is not None and (not isinstance(last_day,int) or not n<=last_day<=expected):raise ValueError('Invalid last day')
        observed=total if packed['variable']=='chuva' else total/n
        months.append(dict(ano=year,mes=m,sum=total,dias=n,esperados=expected,cobertura=n/expected,completo=n==expected,observado=observed,valor=observed if n==expected else None,last_date=f'{year:04d}-{m:02d}-{last_day:02d}' if last_day else None))
    months.sort(key=lambda m:(m['ano'],m['mes']))
    overrides={}
    for year,value in packed.get('annual_values',[]):
        if not isinstance(year,int) or not 1850<=year<=2200 or isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('Invalid annual value')
        if year in overrides:raise ValueError('Duplicate annual value')
        overrides[year]=value
    years=[]
    for year in sorted({m['ano'] for m in months}):
        rows=[m for m in months if m['ano']==year];n=sum(m['dias'] for m in rows);s=sum(m['sum'] for m in rows);expected=366 if calendar.isleap(year) else 365
        derived=s if packed['variable']=='chuva' else s/n
        if year in overrides and not math.isclose(overrides[year],derived,rel_tol=1e-12,abs_tol=1e-9):raise ValueError('Annual value inconsistent with monthly summaries')
        years.append(dict(ano=year,valor=overrides.get(year,s if packed['variable']=='chuva' else s/n),dias=n,esperados=expected,cobertura=n/expected,completo=n==expected and year<today.year))
    out={k:v for k,v in packed.items() if k not in ('row_columns','month_rows','schema_version')};out.update(schema_version=1,months=months,years=years)
    return out

def encode(summary):
    payload=json.dumps(compact(summary),ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
    return gzip.compress(payload,compresslevel=9,mtime=0)

def decode(data,today=None):
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:raw=stream.read(MAX_DECOMPRESSED+1)
    if len(raw)>MAX_DECOMPRESSED:raise ValueError('Decompressed summary limit')
    return expand(json.loads(raw),today=today)

def read_compressed(path,fallback,today=None):
    path=pathlib.Path(path)
    if path.exists():return decode(path.read_bytes(),today=today)
    return fallback

def write_bytes(path,payload):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_bytes(payload);temp.replace(path)


def scientifically_equal(left,right):
    ignored={'last_success_utc','collected_utc','last_attempt_utc','response_sha256','checked_utc','last_confirmed_utc'}
    def stable(obj):
        return {k:v for k,v in compact(obj).items() if k not in ignored}
    return bool(left) and stable(left)==stable(right)
