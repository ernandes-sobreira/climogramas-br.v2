const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/../../ana-persisted.js','utf8');
let calls=0,live=0,fail=false;
const ctx={URL,URLSearchParams,Date,Map,console,ANAMain:{specs:{chuva:{unit:'mm'}}},document:{currentScript:{src:'https://x/ana-persisted.js'}},window:{},fetch:async url=>{calls++;return {ok:false}},AnaPublicApi:class{async series(){live++;if(fail)throw Error('offline');return [{Data:'2020-01-01',Chuva:2,NivelConsistencia:'1',Status:'1'}]}}};
vm.createContext(ctx);vm.runInContext(src,ctx);
const args={type:'chuva',station:'1657000',start:'2020-01-01',end:'2020-12-31',consistency:'1'};
(async()=>{
let a=await new ctx.window.AnaPersistentApi().series(args);let n=calls;assert.equal(live,1);
let b=await new ctx.window.AnaPersistentApi().series(args);assert.strictEqual(a,b);assert.equal(calls,n);assert.equal(live,1);
await new ctx.window.AnaPersistentApi().series({...args,consistency:'2'});assert.equal(live,2);
fail=true;for(let i=0;i<2;i++)await assert.rejects(new ctx.window.AnaPersistentApi().series({...args,station:'1657001'}));assert.equal(live,4);
await assert.rejects(new ctx.window.AnaPersistentApi().series({...args,station:'../secret'}));
let summary={schema_version:1,station:'1657002',variable:'chuva',consistency:'1',checked_ranges:[{start:'2020-01-01',end:'2020-12-31'}],months:[{ano:2020,mes:1,valor:31,observado:31,dias:31,completo:true,last_date:'2020-01-31'}],years:[{ano:2020,dias:31,valor:31,completo:false}]};
ctx.fetch=async()=>({ok:true,json:async()=>summary});
a=await new ctx.window.AnaPersistentApi().series({...args,station:'1657002'});assert.equal(a.precomputed.climatology[0].valor,31);assert.equal(a.precomputed.lastDate,'2020-01-31');assert.equal(live,4);
summary={...summary,station:'1657003',checked_ranges:[{start:'2020-01-01',end:'2020-06-30'}]};
await assert.rejects(new ctx.window.AnaPersistentApi().series({...args,station:'1657003'}));assert.equal(live,5);
// INMET loader: catalog years only, max 4 concurrent GETs, sorted, failure explicit.
const app=fs.readFileSync(__dirname+'/../../app.js','utf8');const f=app.slice(app.indexOf('  async function loadPacksForRange'),app.indexOf('  function collectVarsFromPacks'));
let active=0,peak=0,seen=[];const c={stations:[{code:'A',years:[2010,2012,2014,2018,2020,2021]}],loadPack:async(code,y)=>{active++;peak=Math.max(peak,active);seen.push(y);await new Promise(r=>setTimeout(r,5));active--;return{year:y}},Promise};vm.createContext(c);vm.runInContext(f,c);
let packs=await c.loadPacksForRange('A',2011,2021);assert.equal(seen.length,5);assert(peak<=4);assert.equal(packs[0].year,2012);
c.loadPack=async()=>{throw Error('offline')};await assert.rejects(c.loadPacksForRange('A',2012,2012));
ctx.window.AnaPersistentApi.clearCache(); fail=false; const before=live;ctx.fetch=async()=>({ok:false});await new ctx.window.AnaPersistentApi().series(args);assert.equal(live,before+1);
assert(app.includes('if(selectedStation && lastRows.length)run();'));assert(app.includes('AnaPersistentApi.clearCache();run();'));
console.log('PASS: cached modes, level isolation, failed retry, summary coverage, invalid params, 4-worker INMET, explicit errors');
})().catch(e=>{console.error(e);process.exit(1)});
