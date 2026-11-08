/* Durable public snapshots are preferred; uncached history stays available from ANA. */
(()=>{
'use strict';
const ROOT=new URL('assets/ana/',document.currentScript.src).toString();
async function read(path){try{const r=await fetch(new URL(path,ROOT),{cache:'no-cache'});if(!r.ok)return null;return await r.json();}catch{return null;}}
// Cache successful results across chart modes, bounded to protect mobile memory.
const seriesCache=new Map();
const CACHE_TTL=15*60*1000;
function covered(ranges,start,end){
 let cursor=start;
 for(const r of [...(ranges||[])].sort((a,b)=>a.start.localeCompare(b.start))){
  if(r.end<cursor)continue;if(r.start>cursor)return false;
  if(r.end>=end)return true;
  cursor=new Date(Date.parse(r.end+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 }return false;
}
async function summary(args){
 const {type,station,start,end,consistency='2'}=args;
 const compact=window.AnaCompact?await window.AnaCompact.read(args):null;
 let b=(compact&&covered(compact.checked_ranges,start,end)?compact:null)||await read(`summaries/${type}/${station}/nivel${consistency}.json`);
 if(!b||!covered(b.checked_ranges,start,end)){
  const api=compact||b;
  if(window.AnaImported)b=await window.AnaImported.merge(api,args);
 }
 if(b?.schema_version!==1||String(b.station)!==station||b.variable!==type||String(b.consistency)!==String(consistency)||!Array.isArray(b.months)||!Array.isArray(b.years)||(!covered(b.checked_ranges,start,end)&&b.imported_requested_coverage!==true))return null;
 const y0=+start.slice(0,4),y1=+end.slice(0,4);
 const months=b.months.filter(x=>x.ano>=y0&&x.ano<=y1),years=b.years.filter(x=>x.ano>=y0&&x.ano<=y1);
 const climatology=Array.from({length:12},(_,i)=>{const rows=months.filter(x=>x.mes===i+1&&x.completo&&Number.isFinite(x.valor));return{mes:i+1,valor:rows.length?rows.reduce((n,x)=>n+x.valor,0)/rows.length:null,anos_completos:rows.length};});
 const result=[];result.precomputed={spec:ANAMain.specs[type],months,years,climatology,lastDate:months.map(x=>x.last_date).filter(Boolean).sort().at(-1)||null};
 result.persistence={snapshots:years.length,summary:true,imported_months:b.imported_months||0,imported_provenance:b.imported_provenance||null,last_success_utc:b.last_success_utc,stale:!!b.stale};result.failedYears=[];
 return result;
}
class AnaPersistentApi extends AnaPublicApi{
 async inventory(uf,type='chuva'){
  const b=await read(`catalog/${uf}.json`);
  if(!Array.isArray(b?.stations))return super.inventory(uf,type);
  const wanted=type==='chuva'?'2':'1';
  return b.stations.filter(x=>String(x.station_type)===wanted).map(x=>({codigoestacao:String(x.code),Estacao_Nome:x.name,UF_Estacao:x.uf,Municipio_Nome:x.municipality,Latitude:x.lat,Longitude:x.lon,Tipo_Estacao:x.station_type,Operando:x.operating,Inicio:x.periods?.[type==='chuva'?'PeriodoPluviometroInicio':type==='cotas'?'PeriodoEscalaInicio':'PeriodoDescLiquidaInicio']||'',Fim:x.periods?.[type==='chuva'?'PeriodoPluviometroFim':type==='cotas'?'PeriodoEscalaFim':'PeriodoDescLiquidaFim']||''}));
 }
 async series(args){
  if(!['chuva','cotas','vazao'].includes(args.type)||!/^\d{5,8}$/.test(args.station||'')||!['1','2'].includes(String(args.consistency||'2'))||!/^\d{4}-\d{2}-\d{2}$/.test(args.start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(args.end||''))throw Error('Consulta inválida.');
  const y0=+args.start.slice(0,4),y1=+args.end.slice(0,4);if(y1<y0||y0<1850||y1>new Date().getFullYear())throw Error('Intervalo fora de 1850 até o ano atual.');
  const key=JSON.stringify([args.type,args.station,args.start,args.end,String(args.consistency||'2')]);
  const cached=seriesCache.get(key);if(cached&&Date.now()-cached.at<CACHE_TTL)return cached.value;
  if(args.isCancelled?.())throw Error('Consulta cancelada.');
  let precomputed=null;try{precomputed=await summary(args);}catch{/* malformed summary never hides the original archive */}
  const value=precomputed||await this.liveSeries(args);
  if(args.isCancelled?.())throw Error('Consulta cancelada.');
  if(!value.failedYears?.length){seriesCache.delete(key);seriesCache.set(key,{at:Date.now(),value});while(seriesCache.size>8)seriesCache.delete(seriesCache.keys().next().value);}
  return value;
 }
 async liveSeries(args){
  const {type,station,start,end,consistency='2'}=args;
  if(!['chuva','cotas','vazao'].includes(type)||!/^\d{5,8}$/.test(station||'')||!['1','2'].includes(String(consistency))||!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||''))throw Error('Consulta inválida.');
  const y0=+start.slice(0,4),y1=+end.slice(0,4);if(y1<y0||y0<1850||y1>new Date().getFullYear())throw Error('Intervalo fora de 1850 até o ano atual.');
  const result=[];result.quality={missing:0,excludedStatus:0,conflicts:0};result.persistence={snapshots:0,live_years:[],last_success_utc:null,last_confirmed_utc:null,stale:false};result.failedYears=[];let completed=0;
  if(y1-y0>59){
   if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
   args.onProgress?.({year:`${y0}–${y1}`,completed:0,total:1});
   const qs=new URLSearchParams({codEstacao:station,dataInicio:start.split('-').reverse().join('/'),dataFim:end.split('-').reverse().join('/'),tipoDados:{chuva:'2',cotas:'1',vazao:'3'}[type],nivelConsistencia:String(consistency)});
   const response=await fetch('https://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroSerieHistorica?'+qs,{signal:AbortSignal.timeout(90000),redirect:'error'});
   if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
   if(!response.ok)throw Error('ANA indisponível (HTTP '+response.status+'). Tente um período menor.');
   const reader=response.body?.getReader();let xml='';
   if(reader){const decoder=new TextDecoder();let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8_000_000||args.isCancelled?.()){await reader.cancel();throw Error(args.isCancelled?.()?'Consulta cancelada.':'Resposta superior a8MB; reduza o período.');}xml+=decoder.decode(value,{stream:true});}xml+=decoder.decode();}
   else{xml=await response.text();if(xml.length>8_000_000)throw Error('Resposta muito grande; reduza o período.');}
   if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
   const parsed=window.AnaPublicParser.parseXml(xml,{type,station,start,end,consistency});result.push(...parsed.items);result.quality=parsed.quality;result.persistence.live_years=Array.from({length:y1-y0+1},(_,i)=>y0+i);
   args.onProgress?.({year:`${y0}–${y1}`,completed:1,total:1});return result;
  }
  for(let year=y0;year<=y1;year++){
   if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
   args.onProgress?.({year,completed,total:y1-y0+1});
   const a=year===y0?start:`${year}-01-01`,z=year===y1?end:`${year}-12-31`;
   const [b,check]=await Promise.all([read(`series/${type}/${station}/${year}-nivel${consistency}.json`),read(`series/${type}/${station}/${year}-nivel${consistency}-status.json`)]);
   if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
   if(Array.isArray(b?.items)&&b.items.length>0){
    result.push(...b.items.filter(x=>x.Data>=a&&x.Data<=z&&String(x.NivelConsistencia)===String(consistency)&&String(x.Status)==='1'));
    for(const k of Object.keys(result.quality))result.quality[k]+=b.quality?.[k]||0;
    result.persistence.snapshots++;
    if(check?.last_confirmed_utc)result.persistence.last_confirmed_utc=check.last_confirmed_utc;
    if(check?.last_result?.includes('error')||check?.last_result?.includes('preserved'))result.persistence.stale=true;
    if(b.last_success_utc&&(!result.persistence.last_success_utc||b.last_success_utc>result.persistence.last_success_utc))result.persistence.last_success_utc=b.last_success_utc;
   }else{
    try{const live=await super.series({...args,start:a,end:z});result.push(...live);result.persistence.live_years.push(year);
    for(const k of Object.keys(result.quality))result.quality[k]+=live.quality?.[k]||0;}catch(error){result.failedYears.push(year);}
   }
   if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
   completed++;args.onProgress?.({year,completed,total:y1-y0+1});
  }
  if(args.isCancelled?.())throw Error('Consulta cancelada; resultado anterior preservado.');
  if(!result.length&&result.failedYears.length)throw Error('Fonte indisponível em '+result.failedYears.length+' ano(s). Não foi possível confirmar ausência de dados.');
  return result;
 }
}
AnaPersistentApi.lastObservation=async function(args){
 const current=new Date().getFullYear(),query={...args,start:'1850-01-01',end:`${current}-12-31`};
 const compact=window.AnaCompact?await window.AnaCompact.read(query):null;
 const b=compact||await read(`summaries/${args.type}/${args.station}/nivel${args.consistency}.json`);
 if(!b||String(b.station)!==args.station||b.variable!==args.type||String(b.consistency)!==String(args.consistency))return null;
 const dates=(b.months||[]).filter(x=>x.dias>0&&/^\d{4}-\d{2}-\d{2}$/.test(x.last_date||'')).map(x=>x.last_date).sort();
 return dates.length?{date:dates.at(-1),source:'acervo de observações',stale:!!b.stale}:null;
};
AnaPersistentApi.clearCache=()=>seriesCache.clear();
window.AnaPersistentApi=AnaPersistentApi;
window.AnaAutomationStatus={read:()=>read('status.json')};
})();


