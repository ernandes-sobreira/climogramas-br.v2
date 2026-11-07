(()=>{
'use strict';
const specs={chuva:{field:'Chuva',unit:'mm',label:'Chuva'},cotas:{field:'Cota',unit:'cm',label:'Cota'},vazao:{field:'Vazao',unit:'m³/s',label:'Vazão'}};
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
function aggregate(points,type,y0,y1){
 const spec=specs[type];if(!spec)throw Error('Variável ANA inválida.');
 const days=new Map();for(const p of points){const value=p[spec.field];if(!/^\d{4}-\d{2}-\d{2}$/.test(p.Data)||!Number.isFinite(value))continue;if(!days.has(p.Data))days.set(p.Data,value);else if(days.get(p.Data)!==value)days.set(p.Data,null);}
 const months=[],years=[];
 for(let y=y0;y<=y1;y++){
  let all=[];
  for(let m=1;m<=12;m++){
   const expected=new Date(Date.UTC(y,m,0)).getUTCDate(),vals=[];
   for(let d=1;d<=expected;d++){const v=days.get(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);if(Number.isFinite(v))vals.push(v);}
   all.push(...vals);const observed=vals.length?(type==='chuva'?vals.reduce((a,b)=>a+b,0):avg(vals)):null;
   months.push({ano:y,mes:m,observado:observed,valor:vals.length===expected?observed:null,dias:vals.length,esperados:expected,cobertura:vals.length/expected,completo:vals.length===expected});
  }
  const expected=(Date.UTC(y+1,0,1)-Date.UTC(y,0,1))/86400000;
  years.push({ano:y,valor:all.length?(type==='chuva'?all.reduce((a,b)=>a+b,0):avg(all)):null,dias:all.length,esperados:expected,cobertura:all.length/expected,completo:all.length===expected&&y<new Date().getFullYear()});
 }
 const climatology=Array.from({length:12},(_,i)=>{const rows=months.filter(x=>x.mes===i+1&&x.completo);return{mes:i+1,valor:avg(rows.map(x=>x.valor)),anos_completos:rows.length};});
 return{spec,months,years,climatology,lastDate:[...days.keys()].filter(k=>Number.isFinite(days.get(k))).sort().at(-1)||null};
}
window.ANAMain={specs,aggregate};
})();
