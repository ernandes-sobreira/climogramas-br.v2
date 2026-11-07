const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let ROOT=__dirname;while(!fs.existsSync(path.join(ROOT,'scripts/sync_ana_recent.py'))){const parent=path.dirname(ROOT);if(parent===ROOT)throw Error('Repository root not found');ROOT=parent;}
const jsPath=fs.existsSync(path.join(ROOT,'ana-recent.js'))?path.join(ROOT,'ana-recent.js'):path.join(ROOT,'ui/ana-recent.js');
const {AnaRecentApi,parseCatalogRows,parseSeriesRows,number,validDateTime}=require(jsPath);
const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n+'.json')));const now='2026-11-07T20:00:00Z';
(async()=>{
 assert.deepEqual(parseCatalogRows(read('catalog-sample-rows'),now),read('catalog-sample-expected'));
 for(const c of ['66070004','67100000'])assert.deepEqual(parseSeriesRows(read(c+'-rows'),c,now,'2026-11-06','2026-11-07'),read(c+'-expected'));
 assert.equal(number('0'),0);assert.equal(number('-1.2'),-1.2);for(const x of ['',null,undefined,'-999.1','-999.2',false])assert.equal(number(x),null);
 assert(!validDateTime('2026-02-30 12:00:00'));assert(!validDateTime('2026-11-07T15:00:00Z'));assert(validDateTime('2026-11-07 15:00:00'));
 const fresh=read('66070004-expected');let calls=[];
 const a=new AnaRecentApi({cacheBase:'https://example.invalid/assets/ana/recent/',now:()=>new Date(now),fetchImpl:async(u,o)=>{calls.push([u,o]);return new Response(JSON.stringify(fresh));}});
 const cached=await a.series('66070004');assert.equal(cached.transport,'snapshot');assert.equal(calls.length,1);assert(!calls[0][1].headers);assert.equal(cached.latest.level_cm.datetime_raw,'2026-11-07 15:00:00');
 const b=new AnaRecentApi({cacheBase:'https://example.invalid/assets/ana/recent/',now:()=>new Date('2026-11-08T20:00:00Z'),fetchImpl:async u=>new Response(u.includes('example.invalid')?JSON.stringify(fresh):'failed',{status:u.includes('example.invalid')?200:503})});
 const stale=await b.series('66070004');assert(stale.stale);assert.equal(stale.checked_at,now);assert.equal(stale.transport,'stale_snapshot');
 let rows=read('catalog-sample-rows');global.DOMParser=class{parseFromString(){return{querySelector:()=>null,getElementsByTagName:()=>rows.map(x=>({localName:'Table',children:Object.entries(x).map(([localName,textContent])=>({localName,textContent}))}))}}};
 const c=new AnaRecentApi({cacheBase:'https://example.invalid/',now:()=>new Date(now),fetchImpl:async u=>{calls.push([u]);return new Response(u.includes('example.invalid')?'missing':'<fixture/>',{status:u.includes('example.invalid')?404:200});}});
 const inventory=await c.inventory('PA');assert(inventory.some(x=>x.code==='00047008'));assert(calls.some(([u])=>u.includes('ListaEstacoesTelemetricas?statusEstacoes=&origem=')));
 console.log('PASS JS/Python real fixture parity, leading zeros, duplicate active origins, nulls/sentinels, rawtime/noZ, fresh cache, stale fallback, required public inventory params.');
})();
