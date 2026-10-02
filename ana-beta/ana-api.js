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
    async series({type,station,start,end,consistency="2"}){
      this.ensure();
      const qs=new URLSearchParams({type,station,start,end,consistency});
      const body=await getJson(this.base+"/series?"+qs.toString());
      return items(body);
    }
  }

  window.AnaApi=AnaApi;
})();