(() => {
  "use strict";

  function cleanBase(url){ return String(url||"").trim().replace(/\/+$/,""); }
  async function getJson(url){
    const r=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"});
    let body=null; try{body=await r.json();}catch(_){}
    if(!r.ok) throw new Error(body?.message || `HTTP ${r.status}`);
    return body;
  }
  function items(body){
    if(Array.isArray(body)) return body;
    if(Array.isArray(body?.items)) return body.items;
    if(Array.isArray(body?.data)) return body.data;
    return [];
  }

  class AnaApi {
    constructor(base){ this.base=cleanBase(base); }
    ensure(){ if(!this.base) throw new Error("Informe o endpoint seguro do proxy ANA."); }

    async health(){
      this.ensure();
      return getJson(this.base+"/health");
    }
    async inventory(uf){
      this.ensure();
      const body=await getJson(this.base+"/inventory?uf="+encodeURIComponent(uf));
      return items(body);
    }
    async series({type,station,start,end}){
      this.ensure();
      const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("Data inválida.");const d=new Date(value+"T00:00:00Z");if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)throw new Error("Data inválida.");return d;};
      let cursor=parse(start);const final=parse(end);
      if(cursor>final || final-cursor>60*366*86400000)throw new Error("Período inválido ou superior a 60 anos.");
      const result=[];
      // Publish nothing on partial failure. Each official call is at most 366 days.
      while(cursor<=final){
        const last=new Date(Math.min(+cursor+365*86400000,+final));
        const qs=new URLSearchParams({type,station,start:cursor.toISOString().slice(0,10),end:last.toISOString().slice(0,10)});
        const body=await getJson(this.base+"/series?"+qs.toString());
        result.push(...items(body));cursor=new Date(+last+86400000);
      }
      return result;
    }
  }

  window.AnaApi=AnaApi;
})();
