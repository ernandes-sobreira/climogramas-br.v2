/* Durable public snapshots are preferred; uncached history stays available from ANA. */
(()=>{
'use strict';
const ROOT=new URL('assets/ana/',document.currentScript.src).toString();
async function read(path){try{const r=await fetch(new URL(path,ROOT),{cache:'no-store'});if(!r.ok)return null;return await r.json();}catch{return null;}}
class AnaPersistentApi extends AnaPublicApi{
 async inventory(uf,type='chuva'){
  const b=await read(`catalog/${uf}.json`);
  if(!Array.isArray(b?.stations))return super.inventory(uf,type);
  const wanted=type==='chuva'?'2':'1';
  return b.stations.filter(x=>String(x.station_type)===wanted).map(x=>({codigoestacao:String(x.code),Estacao_Nome:x.name,UF_Estacao:x.uf,Municipio_Nome:x.municipality,Latitude:x.lat,Longitude:x.lon,Tipo_Estacao:x.station_type,Operando:x.operating,Inicio:x.periods?.[type==='chuva'?'PeriodoPluviometroInicio':type==='cotas'?'PeriodoEscalaInicio':'PeriodoDescLiquidaInicio']||'',Fim:x.periods?.[type==='chuva'?'PeriodoPluviometroFim':type==='cotas'?'PeriodoEscalaFim':'PeriodoDescLiquidaFim']||''}));
 }
 async series(args){
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
window.AnaPersistentApi=AnaPersistentApi;
window.AnaAutomationStatus={read:()=>read('status.json')};
})();
