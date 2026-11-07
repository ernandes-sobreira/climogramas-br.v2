/* Official public ANA historical service. Availability is checked per request. */
(() => {
 'use strict';
 const BASE='https://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroSerieHistorica';
 const TYPES={chuva:{id:'2',prefix:'Chuva'},cotas:{id:'1',prefix:'Cota'},vazao:{id:'3',prefix:'Vazao'}};
 const STATE_NAMES={AC:'ACRE',AL:'ALAGOAS',AP:'AMAPÁ',AM:'AMAZONAS',BA:'BAHIA',CE:'CEARÁ',DF:'DISTRITO FEDERAL',ES:'ESPÍRITO SANTO',GO:'GOIÁS',MA:'MARANHÃO',MT:'MATO GROSSO',MS:'MATO GROSSO DO SUL',MG:'MINAS GERAIS',PA:'PARÁ',PB:'PARAÍBA',PR:'PARANÁ',PE:'PERNAMBUCO',PI:'PIAUÍ',RJ:'RIO DE JANEIRO',RN:'RIO GRANDE DO NORTE',RS:'RIO GRANDE DO SUL',RO:'RONDÔNIA',RR:'RORAIMA',SC:'SANTA CATARINA',SP:'SÃO PAULO',SE:'SERGIPE',TO:'TOCANTINS'};
 const parseISO=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))throw Error('Data inválida.');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw Error('Data inválida.');return d;};
 const number=s=>{if(s===null||s===undefined||!String(s).trim())return null;const n=Number(String(s).trim().replace(',','.'));return Number.isFinite(n)&&![-999,-999.1,-999.2,-9999,-99999].includes(n)?n:null;};
 const child=(row,name)=>Array.from(row.children).find(x=>x.localName===name)?.textContent?.trim()??null;
 function parseXml(xml,{type,station,start,end,consistency}){
  const spec=TYPES[type];if(!spec)throw Error('Variável inválida.');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('A ANA retornou XML inválido.');
  const rows=Array.from(doc.getElementsByTagName('*')).filter(x=>x.localName==='SerieHistorica');
  const byDay=new Map();let matchingRows=0;const quality={excludedStatus:0,missing:0,conflicts:0};
  for(const row of rows){
   if(child(row,'EstacaoCodigo')!==String(station)||child(row,'NivelConsistencia')!==String(consistency))continue;
   const month=child(row,'DataHora');const match=month?.match(/^(\d{4})-(\d{2})-/);if(!match)continue;
   matchingRows++;
   const year=+match[1],mo=+match[2];
   for(let day=1;day<=31;day++){
    const d=new Date(Date.UTC(year,mo-1,day));if(d.getUTCMonth()!==mo-1)continue;
    const date=d.toISOString().slice(0,10);if(date<start||date>end)continue;
    const dd=String(day).padStart(2,'0'),value=number(child(row,spec.prefix+dd));
    if(value===null||(type==='chuva'&&value<0)){quality.missing++;continue;}
    const status=child(row,spec.prefix+dd+'Status');
    if(status!=='1'){quality.excludedStatus++;continue;}
    const point={Data:date,[spec.prefix]:value,NivelConsistencia:String(consistency),Status:child(row,spec.prefix+dd+'Status'),source:'ANA/HidroSerieHistorica'};
    if(!byDay.has(date))byDay.set(date,point);
    else if(byDay.get(date)?.[spec.prefix]!==value){byDay.set(date,null);quality.conflicts++;} // conflict is not an observation
   }
  }
  return {items:[...byDay.values()].filter(Boolean).sort((a,b)=>a.Data.localeCompare(b.Data)),matchingRows,quality};
 }
 const inventoryCache=new Map();
 class AnaPublicApi {
  async inventory(uf,type='chuva'){
   if(!Object.hasOwn(STATE_NAMES,uf)||!Object.hasOwn(TYPES,type))throw Error('UF ou variável inválida.');
   const cacheKey=uf+':'+type;const hit=inventoryCache.get(cacheKey);if(hit&&Date.now()-hit.at<30*60*1000)return hit.rows;
   const q=new URLSearchParams({codEstDE:'',codEstATE:'',tpEst:type==='chuva'?'2':'1',nmEst:'',nmRio:'',codSubBacia:'',codBacia:'',nmMunicipio:'',nmEstado:STATE_NAMES[uf],sgResp:'',sgOper:'',telemetrica:''});
   const r=await fetch('https://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroInventario?'+q,{signal:AbortSignal.timeout(90000),redirect:'error'});
   if(!r.ok)throw Error('Inventário ANA indisponível (HTTP '+r.status+').');
   const text=await r.text();if(text.length>30_000_000)throw Error('Inventário muito grande. Consulte por código enquanto ajustamos o carregamento.');
   const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
   const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Inventário ANA em formato inválido.');
   const rows=Array.from(doc.getElementsByTagName('*')).filter(x=>x.localName==='Table'&&norm(child(x,'nmEstado'))===norm(STATE_NAMES[uf])).filter(x=>child(x,'TipoEstacao')===(type==='chuva'?'2':'1')).map(x=>({codigoestacao:child(x,'Codigo'),Estacao_Nome:child(x,'Nome'),UF_Estacao:uf,Municipio_Nome:child(x,'nmMunicipio'),Rio_Nome:child(x,'RioNome'),Bacia_Nome:child(x,'BaciaCodigo'),Tipo_Estacao:child(x,'TipoEstacao'),Latitude:child(x,'Latitude'),Longitude:child(x,'Longitude'),Operando:child(x,'Operando'),Inicio:child(x,type==='chuva'?'PeriodoPluviometroInicio':type==='cotas'?'PeriodoEscalaInicio':'PeriodoDescLiquidaInicio'),Fim:child(x,type==='chuva'?'PeriodoPluviometroFim':type==='cotas'?'PeriodoEscalaFim':'PeriodoDescLiquidaFim')})).filter(x=>x.codigoestacao);
   inventoryCache.set(cacheKey,{at:Date.now(),rows});return rows;
  }
  async series({type,station,start,end,consistency='2'}){
   if(!Object.hasOwn(TYPES,type)||!/^\d{5,8}$/.test(station||'')||!['1','2'].includes(String(consistency)))throw Error('Estação, variável ou consistência inválida.');
   let cursor=parseISO(start);const final=parseISO(end);
   if(cursor>final||final-cursor>60*366*86400000)throw Error('Período inválido ou superior a 60 anos.');
   const result=[];result.quality={excludedStatus:0,missing:0,conflicts:0};
   const br=d=>d.toISOString().slice(0,10).split('-').reverse().join('/');
   // Whole calendar-year chunks; monthly responses are clipped and de-duplicated below.
   while(cursor<=final){
    const last=new Date(Math.min(Date.UTC(cursor.getUTCFullYear(),11,31),+final));
    const qs=new URLSearchParams({codEstacao:station,dataInicio:br(cursor),dataFim:br(last),tipoDados:TYPES[type].id,nivelConsistencia:String(consistency)});
    const r=await fetch(BASE+'?'+qs,{signal:AbortSignal.timeout(90000),redirect:'error'});
    if(!r.ok)throw Error('ANA indisponível (HTTP '+r.status+'). Os dados anteriores foram preservados.');
    const xml=await r.text();if(xml.length>8_000_000)throw Error('Resposta ANA muito grande. Reduza o período.');
    const parsed=parseXml(xml,{type,station,start:cursor.toISOString().slice(0,10),end:last.toISOString().slice(0,10),consistency});
    result.push(...parsed.items);for(const k of Object.keys(result.quality))result.quality[k]+=parsed.quality[k];
    cursor=new Date(+last+86400000);
   }
   return result;
  }
 }
 window.AnaPublicApi=AnaPublicApi;window.AnaPublicParser={parseXml,number};
})();
