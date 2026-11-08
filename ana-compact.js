/* Versioned, lossless monthly summaries; no credentials and no zero-filled gaps. */
(()=>{'use strict';
const ROOT=new URL('assets/ana/compact/',document.currentScript.src);
function decode(b,start,end){
 if(b?.schema_version!==2||JSON.stringify(b.row_columns)!==JSON.stringify(['yyyymm','sum','valid_days','last_day'])||!Array.isArray(b.month_rows)||b.month_rows.length>24000)throw Error('Formato de resumo inválido.');
 const rows=new Map();
 for(const r of b.month_rows){
  if(!Array.isArray(r)||r.length!==4)throw Error('Linha inválida.');
  const [ym,sum,n,last]=r,y=Math.floor(ym/100),m=ym%100,expected=new Date(Date.UTC(y,m,0)).getUTCDate();
  if(!Number.isInteger(ym)||y<1850||y>2200||m<1||m>12||!Number.isFinite(sum)||!Number.isInteger(n)||n<1||n>expected||(last!==null&&(!Number.isInteger(last)||last<n||last>expected))||rows.has(ym))throw Error('Resumo mensal inválido.');
  rows.set(ym,r);
 }
 const annualValues=new Map();
 for(const pair of b.annual_values||[]){if(!Array.isArray(pair)||pair.length!==2||!Number.isInteger(pair[0])||!Number.isFinite(pair[1])||annualValues.has(pair[0]))throw Error('Resumo anual inválido.');annualValues.set(pair[0],pair[1]);}
 const y0=+start.slice(0,4),y1=+end.slice(0,4),months=[],years=[];
 for(let y=y0;y<=y1;y++){
  let total=0,count=0;
  for(let m=1;m<=12;m++){
   const expected=new Date(Date.UTC(y,m,0)).getUTCDate(),r=rows.get(y*100+m),n=r?.[2]||0,sum=r?.[1]||0;
   const observed=n?(b.variable==='chuva'?sum:sum/n):null;
   months.push({ano:y,mes:m,observado:observed,valor:n===expected?observed:null,dias:n,esperados:expected,cobertura:n/expected,completo:n===expected,sum,last_date:r&&r[3]!==null?`${y}-${String(m).padStart(2,'0')}-${String(r[3]).padStart(2,'0')}`:null});
   total+=sum;count+=n;
  }
  const expected=(Date.UTC(y+1,0,1)-Date.UTC(y,0,1))/86400000;
  const derived=count?(b.variable==='chuva'?total:total/count):null,exact=annualValues.get(y);
  if(exact!==undefined&&(derived===null||Math.abs(exact-derived)>Math.max(1e-9,1e-12*Math.abs(derived))))throw Error('Resumo anual inconsistente.');
  years.push({ano:y,valor:exact!==undefined?exact:derived,dias:count,esperados:expected,cobertura:count/expected,completo:count===expected&&y<new Date().getFullYear()});
 }
 return {...b,schema_version:1,months,years};
}
async function bounded(stream,limit){const reader=stream.getReader(),chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>limit){await reader.cancel();throw Error('Resumo excede limite seguro.');}chunks.push(r.value);}const out=new Uint8Array(size);let p=0;for(const c of chunks){out.set(c,p);p+=c.byteLength;}return out;}
async function read({type,station,consistency='2',start,end}){
 if(!['chuva','cotas','vazao'].includes(type)||!/^\d{5,8}$/.test(station)||!['1','2'].includes(String(consistency)))return null;
 try{
  const response=await fetch(new URL(`${type}/${station}/nivel${consistency}.json.gz`,ROOT),{cache:'no-cache'});if(!response.ok)return null;
  let bytes=await bounded(response.body,2*1024*1024);
  if(bytes[0]===31&&bytes[1]===139){if(typeof DecompressionStream==='undefined')return null;bytes=await bounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),8*1024*1024);}
  const payload=JSON.parse(new TextDecoder().decode(bytes));
  if(String(payload.station)!==station||payload.variable!==type||String(payload.consistency)!==String(consistency))return null;
  return decode(payload,start,end);
 }catch{return null;}
}
window.AnaCompact={decode,read};
})();
