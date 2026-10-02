/**
 * Proxy serverless para a API HidroWebService/ANA.
 * Exemplo pronto para Cloudflare Workers, sem dependencias.
 *
 * Secrets obrigatorios no ambiente:
 *   ANA_IDENTIFICADOR  (CPF/CNPJ autorizado pela ANA)
 *   ANA_SENHA
 *
 * IMPORTANTE: nunca coloque essas credenciais no GitHub Pages.
 */
const ANA_BASE = "https://www.ana.gov.br/hidrowebservice/EstacoesTelemetricas";
let tokenCache = { token: null, expiresAt: 0 };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{...cors,"Content-Type":"application/json; charset=utf-8"}
  });
}

async function parseAna(res){
  const text=await res.text();
  let body;
  try{ body=JSON.parse(text); }catch(_){ throw new Error("ANA respondeu em formato inesperado: "+text.slice(0,180)); }
  if(!res.ok || (body?.code && Number(body.code)>=400)) throw new Error(body?.message || "Erro ANA HTTP "+res.status);
  return body;
}

async function getToken(env){
  const now=Date.now();
  if(tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;
  if(!env.ANA_IDENTIFICADOR || !env.ANA_SENHA) throw new Error("Credenciais ANA nao configuradas no proxy.");

  const res=await fetch(ANA_BASE+"/OAUth/v1",{
    headers:{
      "Identificador":env.ANA_IDENTIFICADOR,
      "Senha":env.ANA_SENHA,
      "Accept":"application/json"
    }
  });
  const body=await parseAna(res);
  const token=body?.items?.tokenautenticacao || body?.items?.tokenAutenticacao || body?.items?.token || body?.tokenautenticacao;
  if(!token) throw new Error("Token ANA nao encontrado na resposta de autenticacao.");
  // O manual informa 60 min; renovamos antes para evitar corrida no limite.
  tokenCache={token,expiresAt:now+50*60*1000};
  return token;
}

async function anaGet(env, route, params){
  const token=await getToken(env);
  const url=new URL(ANA_BASE+"/"+route);
  for(const [k,v] of Object.entries(params||{})){
    if(v!==undefined && v!==null && String(v)!=="") url.searchParams.set(k,String(v));
  }
  let res=await fetch(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
  if(res.status===401 || res.status===403){
    tokenCache={token:null,expiresAt:0};
    const retryToken=await getToken(env);
    res=await fetch(url,{headers:{Authorization:"Bearer "+retryToken,Accept:"application/json"}});
  }
  return parseAna(res);
}

function iso(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }

async function getSeries(env,type,station,start,end){
  const routes={chuva:"HidroSerieChuva/v1",cotas:"HidroSerieCotas/v1",vazao:"HidroSerieVazao/v1"};
  const route=routes[type];
  if(!route) throw new Error("Tipo de serie invalido.");
  if(!/^\d+$/.test(String(station||""))) throw new Error("Codigo de estacao invalido.");

  const d0=new Date(start+"T00:00:00Z"), d1=new Date(end+"T00:00:00Z");
  if(Number.isNaN(d0.getTime())||Number.isNaN(d1.getTime())||d0>d1) throw new Error("Periodo invalido.");

  const items=[];
  let cursor=d0;
  while(cursor<=d1){
    const chunkEnd=new Date(Math.min(addDays(cursor,365).getTime(),d1.getTime()));
    const body=await anaGet(env,route,{
      "Código da Estação":station,
      "Tipo Filtro Data":"DATA_LEITURA",
      "Data Inicial (yyyy-MM-dd)":iso(cursor),
      "Data Final (yyyy-MM-dd)":iso(chunkEnd)
    });
    if(Array.isArray(body?.items)) items.push(...body.items);
    cursor=addDays(chunkEnd,1);
  }
  return {status:"OK",code:200,message:"Sucesso",items};
}

export default {
  async fetch(request, env){
    if(request.method==="OPTIONS") return new Response(null,{headers:cors});
    if(request.method!=="GET") return json({message:"Metodo nao permitido."},405);

    try{
      const u=new URL(request.url);
      if(u.pathname==="/health"){
        const token=await getToken(env);
        return json({ok:true,ana:true,token:!!token});
      }
      if(u.pathname==="/inventory"){
        const uf=(u.searchParams.get("uf")||"").toUpperCase();
        if(!/^[A-Z]{2}$/.test(uf)) return json({message:"UF invalida."},400);
        const body=await anaGet(env,"HidroInventarioEstacoes/v1",{"Unidade Federativa":uf});
        return json(body);
      }
      if(u.pathname==="/series"){
        const body=await getSeries(
          env,
          u.searchParams.get("type"),
          u.searchParams.get("station"),
          u.searchParams.get("start"),
          u.searchParams.get("end")
        );
        return json(body);
      }
      return json({message:"Rota nao encontrada."},404);
    }catch(err){
      return json({message:err?.message || String(err)},502);
    }
  }
};