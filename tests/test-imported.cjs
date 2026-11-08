'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),zlib=require('zlib');
const root=path.resolve(__dirname,'..'),existing=path.join(root,'ana-compact.js');
let requests=0,mode='normal';
const context={window:{},document:{currentScript:{src:'https://test.invalid/ana-compact.js'}},URL,Date,TextDecoder,TextEncoder,Blob,DecompressionStream,AbortSignal,console,fetch:async(url)=>{requests++;if(mode==='error')return new Response('',{status:500});if(mode==='oversized')return new Response(new Uint8Array(2*1024*1024+1));const file=path.join(root,new URL(url).pathname);return new Response(fs.readFileSync(file));}};
vm.createContext(context);vm.runInContext(fs.readFileSync(existing,'utf8'),context);context.document.currentScript.src='https://test.invalid/ana-imported.js';vm.runInContext(fs.readFileSync(path.join(root,'ana-imported.js'),'utf8'),context);
const helper=context.window.AnaImported,decode=context.window.AnaCompact.decode;
const args={type:'chuva',station:'1657000',consistency:'1',start:'2020-01-01',end:'2020-12-31'};
function months(value=1){return Array.from({length:12},(_,i)=>{let m=i+1,n=new Date(Date.UTC(2020,m,0)).getUTCDate();return{ano:2020,mes:m,sum:value*n,dias:n,esperados:n,observado:value*n,valor:value*n,completo:true,cobertura:1,last_date:`2020-${String(m).padStart(2,'0')}-${n}`};});}
function source(rows,range=[],explicit=[]){return{schema_version:1,station:'1657000',variable:'chuva',consistency:'1',unit:'mm',months:rows,years:[],checked_ranges:range,explicit_months:explicit};}
const allMonths=months().map(r=>`2020-${String(r.mes).padStart(2,'0')}`),range=[{start:'2020-01-01',end:'2020-12-31'}];
(async()=>{
 let a=source([],[]),b=source(months(),[],allMonths),r=helper.combine(a,b,args);assert(r);assert.equal(r.imported_months,12);assert.equal(r.years[0].valor,366);assert.equal(r.checked_ranges.length,0);
 assert.equal(helper.combine(a,{...b,explicit_months:allMonths.slice(1)},args),null,'unknown month falls back');
 a=source(months(2),range);r=helper.combine(a,b,args);assert.equal(r.imported_months,0);assert.equal(r.years[0].valor,732,'API revision always wins');
 a=source([],range);r=helper.combine(a,b,args);assert.equal(r.imported_months,0);assert.equal(r.years[0].valor,null,'API checked empty remains null, not bulk/zero');
 assert.equal(helper.combine(a,{...b,consistency:'2'},args),null,'levels cannot mix');
 assert.equal(helper.combine(null,b,args),null,'missing API not treated as absence');
 assert.equal(helper.combine(a,b,{...args,start:'2020-02-01'}),null,'partial calendar ranges fall back');
 a=source(months(2).slice(0,1),[]);r=helper.combine(a,b,args);assert.equal(r.imported_months,11);assert.equal(r.years[0].valor,397,'API observation wins even outside checked ranges');
 const row=months()[1];b=source([{...row,dias:1,sum:2,last_date:'2020-02-01'},...months().filter(x=>x.mes!==2)],[],allMonths);r=helper.combine(source([],[]),b,args);assert.equal(r.months[1].valor,null);assert.equal(r.climatology[1].valor,null,'incomplete month excluded from climatology');
 b=source([],[],allMonths);r=helper.combine(source([],[]),b,args);assert.equal(r.years[0].valor,null,'explicit imported empty gives null');
 const cotaArgs={...args,type:'cotas'};a={...source(months(2).slice(0,1),[]),variable:'cotas',unit:'cm'};b={...source(months(),[],allMonths),variable:'cotas',unit:'cm'};r=helper.combine(a,b,cotaArgs);assert.equal(r.years[0].valor,397/366,'mixed-source means weight by days');
 a=source(months(2),range);a.years=[{ano:2020,valor:732.0000000000001,dias:366}];b=source(months(),[],allMonths);r=helper.combine(a,b,args);assert.equal(r.years[0].valor,732.0000000000001,'preserve exact source annual values');
 let before=requests;assert.equal(await helper.merge(source([],[]),{...args,station:'1657003'}),null);assert.equal(requests,before,'allowlist avoids request');
 const apiPath=path.join(root,'tests/fixtures/imported-api/nivel1.json.gz');
 const packed=JSON.parse(zlib.gunzipSync(fs.readFileSync(apiPath)));
 const oldArgs={...args,start:'1913-01-01',end:'1913-12-31'};let api=decode(packed,oldArgs.start,oldArgs.end);r=await helper.merge(api,oldArgs);assert(r,'real year1913 must load');assert.equal(r.imported_months,12);assert.equal(r.imported_provenance.archive_sha256,'9f00c580092f23af4853aac10438e2c2e5ee1c3310a421fd6120c1bbe8b89a3f');
 const unknown={...args,start:'1912-01-01',end:'1912-12-31'};assert.equal(await helper.merge(decode(packed,unknown.start,unknown.end),unknown),null,'real first year has unknown Jan-May');
 mode='error';assert.equal(await helper.merge(api,oldArgs),null,'network error fallback');mode='oversized';assert.equal(await helper.merge(api,oldArgs),null,'bounded gzip transport');
 console.log(JSON.stringify({tests:18,real1913:true,real1912FallsBack:true,requests,passed:true}));
})().catch(e=>{console.error(e);process.exit(1);});
