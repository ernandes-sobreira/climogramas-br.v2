/* Historical supplement only. API always wins; unknown months fall back to API. */
(()=>{'use strict';
const ROOT=new URL('assets/ana/imported/',document.currentScript.src);
const ALLOWED=new Set(['chuva:1657000:1','chuva:1657000:2']);
const WARNING='Histórico importado de CSV oficial. Datas do ZIP e de download não garantem atualização; a API permanece prioritária.';
const validDate=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
const monthKey=(y,m)=>`${y}-${String(m).padStart(2,'0')}`;
function argsValid(a){return a&&['chuva','cotas','vazao'].includes(a.type)&&/^\d{5,8}$/.test(a.station||'')&&['1','2'].includes(String(a.consistency||'2'))&&/^\d{4}-01-01$/.test(a.start||'')&&/^\d{4}-12-31$/.test(a.end||'')&&+a.start.slice(0,4)>=1850&&+a.end.slice(0,4)<=new Date().getFullYear()&&a.start<=a.end;}
function identity(b,a){return b?.schema_version===1&&String(b.station)===a.station&&b.variable===a.type&&String(b.consistency)===String(a.consistency||'2')&&Array.isArray(b.months)&&Array.isArray(b.years);}
function checked(ranges,start,end){
 let cursor=start;const list=(Array.isArray(ranges)?ranges:[]).filter(r=>validDate(r?.start)&&validDate(r?.end)&&r.start<=r.end).slice().sort((a,b)=>a.start.localeCompare(b.start));
 for(const r of list){if(r.end<cursor)continue;if(r.start>cursor)return false;if(r.end>=end)return true;const next=new Date(Date.parse(r.end+'T00:00:00Z')+86400000);if(!Number.isFinite(next.getTime()))return false;cursor=next.toISOString().slice(0,10);}return false;
}
function indexMonths(b){
 if(b.months.length>24000)throw Error('Resumo mensal muito grande.');const map=new Map();
 for(const r of b.months){
  if(!Number.isInteger(r.ano)||r.ano<1850||r.ano>2200||!Number.isInteger(r.mes)||r.mes<1||r.mes>12)throw Error('Mês inválido.');
  const k=monthKey(r.ano,r.mes),expected=new Date(Date.UTC(r.ano,r.mes,0)).getUTCDate();
  if(map.has(k)||!Number.isInteger(r.dias)||r.dias<0||r.dias>expected||!Number.isFinite(r.sum)||r.dias===0&&r.sum!==0)throw Error('Cobertura inválida.');
  if(r.last_date!==null&&r.last_date!==undefined){const day=Number(String(r.last_date).slice(8));if(!new RegExp(`^${k}-\\d{2}$`).test(r.last_date)||day<r.dias||day>expected||day<1)throw Error('Data de observação inválida.');}
  map.set(k,r);
 }return map;
}
function normalize(row,y,m,type){
 const expected=new Date(Date.UTC(y,m,0)).getUTCDate(),n=row?.dias||0,sum=n?row.sum:0,observed=n?(type==='chuva'?sum:sum/n):null;
 return {ano:y,mes:m,sum,dias:n,esperados:expected,cobertura:n/expected,completo:n===expected,observado:observed,valor:n===expected?observed:null,last_date:n?row.last_date||null:null};
}
function exactAnnual(source,year,derived,days){
 const candidates=source.years.filter(r=>r.ano===year);if(candidates.length>1)throw Error('Ano duplicado.');
 const row=candidates[0];if(!row)return derived;
 if(row.dias!==days)throw Error('Cobertura anual inconsistente.');
 if(derived===null){if(row.valor!==null)throw Error('Ano vazio com valor.');return null;}
 if(!Number.isFinite(row.valor)||Math.abs(row.valor-derived)>Math.max(1e-9,Math.abs(derived)*1e-12))throw Error('Valor anual inconsistente.');
 return row.valor;
}
function combine(api,imported,args){
 if(!argsValid(args)||!identity(api,args)||!identity(imported,args)||api.unit!==imported.unit||api.unit!==({chuva:'mm',cotas:'cm',vazao:'m³/s'})[args.type]||!Array.isArray(imported.explicit_months)||imported.explicit_months.length>24000)return null;
 try{
  const a=indexMonths(api),b=indexMonths(imported),explicit=new Set();
  for(const k of imported.explicit_months){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)||explicit.has(k))return null;explicit.add(k);}
  for(const [k,r] of b)if(r.dias>0&&!explicit.has(k))return null;
  const months=[],years=[],sources=[],y0=+args.start.slice(0,4),y1=+args.end.slice(0,4);let importedCount=0;
  for(let y=y0;y<=y1;y++){
   let total=0,days=0;const owners=[];
   for(let m=1;m<=12;m++){
    const k=monthKey(y,m),last=new Date(Date.UTC(y,m,0)).getUTCDate();let owner,row;
    if((a.get(k)?.dias||0)>0||checked(api.checked_ranges,k+'-01',k+'-'+last)){owner='api';row=a.get(k);}
    else if(explicit.has(k)){owner='imported';row=b.get(k);importedCount++;}
    else return null;
    const normalized=normalize(row,y,m,args.type);months.push(normalized);owners.push(owner);sources.push({month:k,source:owner});total+=normalized.sum;days+=normalized.dias;
   }
   const expected=(Date.UTC(y+1,0,1)-Date.UTC(y,0,1))/86400000,derived=days?(args.type==='chuva'?total:total/days):null;
   let value=derived;
   if(owners.every(x=>x==='api'))value=exactAnnual(api,y,derived,days);
   else if(owners.every(x=>x==='imported'))value=exactAnnual(imported,y,derived,days);
   years.push({ano:y,valor:value,dias:days,esperados:expected,cobertura:days/expected,completo:days===expected&&y<new Date().getFullYear()});
  }
  const climatology=Array.from({length:12},(_,i)=>{const valid=months.filter(r=>r.mes===i+1&&r.completo&&Number.isFinite(r.valor));return{mes:i+1,valor:valid.length?valid.reduce((n,r)=>n+r.valor,0)/valid.length:null,anos_completos:valid.length};});
  const provenance=imported.provenance||{};
  return {schema_version:1,station:args.station,variable:args.type,consistency:String(args.consistency||'2'),unit:api.unit,months,years,climatology,lastDate:months.map(r=>r.last_date).filter(Boolean).sort().at(-1)||null,checked_ranges:api.checked_ranges||[],imported_requested_coverage:true,imported_months:importedCount,month_sources:sources,imported_provenance:{archive_sha256:provenance.archive_sha256||null,source_page:provenance.source_page||null,warning:WARNING},stale:!!api.stale,last_success_utc:api.last_success_utc||null,source:importedCount?'ANA API + histórico CSV importado':'ANA API'};
 }catch{return null;}
}
async function bounded(stream,limit){if(!stream)throw Error('Resposta sem corpo.');const reader=stream.getReader(),chunks=[];let size=0;try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>limit)throw Error('Resumo excede limite seguro.');chunks.push(r.value);}}catch(e){await reader.cancel();throw e;}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}return bytes;}
async function read(args){
 if(!argsValid(args)||!ALLOWED.has(`${args.type}:${args.station}:${args.consistency||'2'}`)||!window.AnaCompact)return null;
 try{
  const response=await fetch(new URL(`${args.type}/${args.station}/nivel${args.consistency||'2'}.json.gz`,ROOT),{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!response.ok)return null;
  let data=await bounded(response.body,2*1024*1024);
  if(data[0]===31&&data[1]===139){if(typeof DecompressionStream==='undefined')return null;data=await bounded(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')),8*1024*1024);}
  const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
  if(String(payload.station)!==args.station||payload.variable!==args.type||String(payload.consistency)!==String(args.consistency||'2')||!Array.isArray(payload.explicit_months)||!/^[a-f0-9]{64}$/.test(payload.provenance?.archive_sha256||''))return null;
  return window.AnaCompact.decode(payload,args.start,args.end);
 }catch{return null;}
}
async function merge(api,args){if(!argsValid(args)||!identity(api,args))return null;const imported=await read(args);return imported?combine(api,imported,args):null;}
window.AnaImported={merge,read,combine};
})();
