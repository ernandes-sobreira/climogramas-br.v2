/* Public ANA recent telemetry. Raw measurement dates have no inferred timezone. */
((root)=>{
'use strict';
const BASE='https://telemetriaws1.ana.gov.br/ServiceANA.asmx/';
const DEFAULT_CACHE_BASE=new URL('assets/ana/recent/',new URL('.',root.document?.currentScript?.src||root.document?.baseURI||root.location?.href||'https://ernandes-sobreira.github.io/climogramas-br.v2/')).href;
const UFS=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const validCode=x=>typeof x==='string'&&/^\d{5,8}$/.test(x);
function number(v){if(v===null||v===undefined||typeof v==='boolean'||!String(v).trim())return null;const n=Number(String(v).trim().replace(',','.'));return Number.isFinite(n)&&![-999,-999.1,-999.2,-9999,-99999].includes(n)?n:null;}
function xmlRows(xml,tag){const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('XML ANA inválido.');return Array.from(doc.getElementsByTagName('*')).filter(x=>x.localName===tag).map(x=>Object.fromEntries(Array.from(x.children).map(c=>[c.localName,c.textContent.trim()])));}
function parseCatalogRows(rows,checkedAt){
 const stations=new Map();let duplicates=0;
 for(const x of rows){const code=String(x.CodEstacao||'');if(!validCode(code))continue;const city=String(x['Municipio-UF']||''),match=city.match(/-\s*([A-Z]{2})\s*$/),uf=match&&UFS.has(match[1])?match[1]:null;
  if(stations.has(code)){duplicates++;const r=stations.get(code);r.origins=[...new Set([...r.origins,x.Origem||''])].filter(Boolean).sort();r.statuses=[...new Set([...r.statuses,x.StatusEstacao||''])].filter(Boolean).sort();r.active=r.statuses.some(s=>s.toLowerCase()==='ativo');r.status=r.active?'Ativo':r.statuses[0]||'';if(!r.uf&&uf){r.uf=uf;r.municipality_uf=city;}continue;}
  stations.set(code,{code,name:x.NomeEstacao||'',uf,municipality_uf:city,lat:number(x.Latitude),lon:number(x.Longitude),river:x.NomeRio||'',status:x.StatusEstacao||'',statuses:[x.StatusEstacao||''],origins:[x.Origem||''],active:String(x.StatusEstacao||'').toLowerCase()==='ativo'});
 }
 if(!stations.size)throw Error('Catálogo telemétrico vazio.');
 return {schema_version:1,checked_at:checkedAt,source:BASE+'ListaEstacoesTelemetricas',stations:[...stations.values()].sort((a,b)=>a.code.localeCompare(b.code)),quality:{duplicate_codes:duplicates},coverage:'telemetric_catalog_not_all_historical_stations'};
}
function validDateTime(raw){const m=String(raw||'').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);if(!m)return false;const [y,mo,d,h,mi,se]=m.slice(1).map(Number);const date=new Date(Date.UTC(y,mo-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d&&h<24&&mi<60&&se<60;}
function parseSeriesRows(rows,station,checkedAt,start=null,end=null){
 if(!validCode(station))throw Error('Código de estação inválido.');
 const map=new Map(),quality={station_mismatches:0,invalid_datetime:0,duplicate_rows:0,conflicts:0,records_without_level_or_flow:0};
 for(const x of rows){if(x.CodEstacao!==station){quality.station_mismatches++;continue;}const raw=String(x.DataHora||'').trim();if(!validDateTime(raw)){quality.invalid_datetime++;continue;}if(start&&raw.slice(0,10)<start||end&&raw.slice(0,10)>end)continue;
  const level=number(x.Nivel);const flow=number(x.Vazao);
  const r={station,datetime_raw:raw,level_cm:level,flow_m3_s:flow},key=raw.replace('T',' ');
  if(map.has(key)){const old=map.get(key);if(old&&JSON.stringify(old)===JSON.stringify(r))quality.duplicate_rows++;else{map.set(key,null);quality.conflicts++;}}else map.set(key,r);
 }
 const records=[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(x=>x[1]).filter(Boolean);quality.records_without_level_or_flow=records.filter(x=>x.level_cm===null&&x.flow_m3_s===null).length;
 const latest={};for(const key of ['level_cm','flow_m3_s']){const r=[...records].reverse().find(x=>x[key]!==null);latest[key]=r?{datetime_raw:r.datetime_raw,value:r[key]}:null;}
 return{schema_version:1,code:station,checked_at:checkedAt,source:BASE+'DadosHidrometeorologicos',requested_start:start,requested_end:end,quality_status:'provisional_unverified',datetime_timezone:'not_declared_by_source',records,latest,last_record_raw:records.at(-1)?.datetime_raw||null,quality,rainfall:'not_exposed_interval_and_accumulation_unverified'};
}
async function boundedText(response,limit){if(!response.ok)throw Error('HTTP '+response.status);if(Number(response.headers?.get('content-length')||0)>limit)throw Error('Resposta acima do limite.');if(!response.body){const s=await response.text();if(s.length>limit)throw Error('Resposta acima do limite.');return s;}const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Resposta acima do limite.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let off=0;for(const part of parts){bytes.set(part,off);off+=part.length;}return new TextDecoder().decode(bytes);}
class AnaRecentApi{
 constructor({cacheBase,fetchImpl=root.fetch?.bind(root),now=()=>new Date(),cacheMaxAgeMs=6*60*60*1000}={}){this.base=cacheBase||DEFAULT_CACHE_BASE;this.fetch=fetchImpl;this.now=now;this.ttl=cacheMaxAgeMs;this.memoryCatalog=null;}
 async get(url,limit){return boundedText(await this.fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(90000)}),limit);}
 async cached(path,validate){try{const data=JSON.parse(await this.get(new URL(path,this.base).href,16_000_000));return validate(data)?data:null;}catch{return null;}}
 fresh(c,maxAge=this.ttl){const t=Date.parse(c?.checked_at);return Number.isFinite(t)&&+this.now()-t>=0&&+this.now()-t<=maxAge;}
 async inventory(uf){if(!UFS.has(uf))throw Error('UF inválida.');let data=this.memoryCatalog;let transport='memory';if(!data){data=await this.cached('catalog.json',c=>c.schema_version===1&&Array.isArray(c.stations)&&c.stations.every(s=>validCode(s.code)));transport='snapshot';}
  if(!this.fresh(data,7*86400000)){try{data=parseCatalogRows(xmlRows(await this.get(BASE+'ListaEstacoesTelemetricas?statusEstacoes=&origem=',16_000_000),'Table'),this.now().toISOString());transport='public';}catch(e){if(!data)throw Error('Catálogo recente indisponível. '+e.message);transport='stale_snapshot';}}
  this.memoryCatalog=data;const result=data.stations.filter(s=>s.uf===uf);result.meta={checked_at:data.checked_at,transport,stale:!this.fresh(data,7*86400000),coverage:data.coverage};return result;
 }
 async series(station){if(!validCode(station))throw Error('Código de estação inválido.');const cached=await this.cached('stations/'+station+'.json',x=>x.schema_version===1&&x.code===station&&Array.isArray(x.records)&&x.records.every(r=>r.station===station&&validDateTime(r.datetime_raw)&&['level_cm','flow_m3_s'].every(k=>r[k]===null||typeof r[k]==='number'&&Number.isFinite(r[k]))));
  if(cached&&this.fresh(cached))return{...cached,transport:'snapshot',stale:false};
  const now=this.now(),end=now.toISOString().slice(0,10),start=new Date(+now-86400000).toISOString().slice(0,10);const br=d=>d.split('-').reverse().join('/');
  const params=new URLSearchParams({codEstacao:station,dataInicio:br(start),dataFim:br(end)});
  try{const parsed=parseSeriesRows(xmlRows(await this.get(BASE+'DadosHidrometeorologicos?'+params,8_000_000),'DadosHidrometereologicos'),station,now.toISOString(),start,end);if(!parsed.records.some(r=>r.level_cm!==null||r.flow_m3_s!==null)&&cached?.records.some(r=>r.level_cm!==null||r.flow_m3_s!==null))return{...cached,transport:'stale_snapshot',stale:true,last_attempt_at:now.toISOString(),warning:'Consulta atual sem nível/vazão; último snapshot preservado.'};return{...parsed,transport:'public',stale:false};}
  catch(e){if(cached)return{...cached,transport:'stale_snapshot',stale:true,last_attempt_at:now.toISOString(),warning:'Fonte indisponível; último snapshot preservado.'};throw Error('Telemetria recente indisponível. '+e.message);}
 }
}
root.AnaRecentApi=AnaRecentApi;root.AnaRecentParser={parseCatalogRows,parseSeriesRows,validDateTime,number,xmlRows};
if(typeof module!=='undefined'&&module.exports)module.exports={AnaRecentApi,...root.AnaRecentParser};
})(typeof window!=='undefined'?window:globalThis);
