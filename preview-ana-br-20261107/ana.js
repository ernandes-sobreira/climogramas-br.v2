(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const proxyUrl=$("proxyUrl"), ufSelect=$("ufSelect"), stationSearch=$("stationSearch"),
    stationSelect=$("stationSelect"), stationMeta=$("stationMeta"), seriesType=$("seriesType"),
    consistency=$("consistency"), dateStart=$("dateStart"), dateEnd=$("dateEnd"),
    btnStations=$("btnStations"), btnRun=$("btnRun"), btnCsv=$("btnCsv"), msgBox=$("msgBox"),
    chartTitle=$("chartTitle"), chartMeta=$("chartMeta"), kpis=$("kpis"),
    trendSummary=$("trendSummary"), tblHead=$("tblHead"), tblBody=$("tblBody"), tableMeta=$("tableMeta");

  let stations=[], filtered=[], chart=null, lastRows=[];

  const today=new Date();
  dateEnd.value=today.toISOString().slice(0,10);
  dateStart.value=`${today.getFullYear()-1}-01-01`;
  dateEnd.value=`${today.getFullYear()-1}-12-31`;
  proxyUrl.value=localStorage.getItem("anaProxyUrl")||"";

  const dataSource=$("dataSource"), publicStation=$("publicStation");
  function updateSource(){
    const publicMode=dataSource.value==="public";
    $("proxySettings").hidden=publicMode;
    for(const el of [ufSelect,stationSearch,stationSelect,btnStations])el.disabled=false;
    publicStation.disabled=!publicMode;consistency.disabled=!publicMode;
    $("consistencyNote").textContent=publicMode?"Filtragem explícita do nível retornado; bruto e consistido não são misturados.":"Filtro de consistência não validado no proxy experimental.";
  }
  dataSource.addEventListener("change",updateSource);updateSource();

  function setMsg(t,err=false){ msgBox.textContent=t; msgBox.style.borderColor=err?"rgba(251,113,133,.45)":""; }
  const num=v=>{ if(v===null || v===undefined || typeof v==="boolean" || String(v).trim()==="") return NaN; const n=Number(String(v).trim().replace(",", ".")); return Number.isFinite(n) && n!==-9999 ? n:NaN; };
  const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString("pt-BR",{maximumFractionDigits:d,minimumFractionDigits:d}):"—";

  function normalizeStation(s){
    return {
      code:String(s.codigoestacao ?? s.CodigoEstacao ?? s.Codigo_Da_Estacao ?? s.code ?? ""),
      name:String(s.Estacao_Nome ?? s.Nome ?? s.name ?? "Sem nome"),
      uf:String(s.UF_Estacao ?? s.UF ?? s.uf ?? ""),
      city:String(s.Municipio_Nome ?? s.Municipio ?? s.city ?? ""),
      river:String(s.Rio_Nome ?? s.Rio ?? s.Curso_Dagua_Nome ?? ""),
      basin:String(s.Bacia_Nome ?? s.Bacia ?? ""),
      type:String(s.Tipo_Estacao ?? s.TipoEstacao ?? ""),
      lat:num(s.Latitude ?? s.lat),
      lon:num(s.Longitude ?? s.lon),
      start:s.Data_Periodo_Climatologica_Inicio ?? s.Data_Periodo_Cota_Inicio ?? s.Data_Periodo_Chuva_Inicio ?? s.Data_Periodo_Vazao_Inicio ?? "",
      raw:s
    };
  }

  function renderStations(){
    const q=(stationSearch.value||"").trim().toLowerCase();
    filtered=stations.filter(s=>!q||[s.code,s.name,s.city,s.river,s.basin].join(" ").toLowerCase().includes(q));
    stationSelect.innerHTML="";
    for(const s of filtered){
      const o=document.createElement("option"); o.value=s.code;
      o.textContent=`${s.code} · ${s.name}${s.city?" · "+s.city:""}`;
      stationSelect.appendChild(o);
    }
    if(!filtered.length) stationSelect.innerHTML='<option value="">Nenhuma estação</option>';
    if(dataSource.value==="public")publicStation.value=stationSelect.value;
    showStationMeta();
  }

  function showStationMeta(){
    const s=stations.find(x=>x.code===stationSelect.value);
    stationMeta.textContent=s ? [s.name,s.city,s.uf,s.river,s.type].filter(Boolean).join(" · ") : "—";
  }

  function validDate(y,m,day){
    const d=new Date(y,m-1,day);
    return d.getFullYear()===y && d.getMonth()===m-1 && d.getDate()===day ? d : null;
  }

  function parseDate(v){
    if(!v) return null;
    const s=String(v).trim();
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return validDate(Number(iso[1]),Number(iso[2]),Number(iso[3]));
    const br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(br) return validDate(Number(br[3]),Number(br[2]),Number(br[1]));
    const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
  }

  function genericValue(row,type){
    const candidates={
      chuva:["value","Valor","valor","Chuva","chuva","Chuva_Adotada","Precipitacao","Precipitação"],
      cotas:["value","Valor","valor","Cota","cota","Cota_Adotada","Nivel","Nível"],
      vazao:["value","Valor","valor","Vazao","vazao","Vazão","Vazao_Adotada"]
    }[type]||["value","Valor","valor"];
    for(const k of candidates){ const v=num(row[k]); if(Number.isFinite(v)) return v; }
    return NaN;
  }

  function flattenSeries(raw,type){
    const out=[];
    const prefix={chuva:"Chuva",cotas:"Cota",vazao:"Vazao"}[type];
    for(const row of raw){
      const directDate=parseDate(row.date ?? row.Data ?? row.Data_Hora_Medicao ?? row.DataLeitura ?? row.Data_Medicao);
      const directValue=genericValue(row,type);
      if(directDate && Number.isFinite(directValue)){
        out.push({date:directDate,value:directValue,raw:row}); continue;
      }
      const monthDate=parseDate(row.Data ?? row.data ?? row.DataHora);
      if(monthDate && prefix){
        let found=false;
        for(let day=1;day<=31;day++){
          const dd=String(day).padStart(2,"0");
          const keys=[prefix+dd,prefix+"_"+dd,prefix.toLowerCase()+dd];
          let v=NaN;
          for(const k of keys){ if(k in row){ v=num(row[k]); break; } }
          if(!Number.isFinite(v)) continue;
          const d=new Date(monthDate.getFullYear(),monthDate.getMonth(),day);
          if(d.getMonth()!==monthDate.getMonth()) continue;
          out.push({date:d,value:v,raw:row}); found=true;
        }
        if(found) continue;
      }
    }
    out.sort((a,b)=>a.date-b.date);
    // Repeated pages must not double-count a day. Conflicting daily values
    // remain missing until the source/consistency can resolve them.
    const byDate=new Map();
    for(const r of out){
      if(type==="chuva" && r.value<0) continue;
      const key=[r.date.getFullYear(),r.date.getMonth(),r.date.getDate()].join("-");
      if(!byDate.has(key)) byDate.set(key,r);
      else if(byDate.get(key)?.value!==r.value) byDate.set(key,null);
    }
    return [...byDate.values()].filter(Boolean);
  }

  function annualize(points,type){
    const map=new Map();
    for(const p of points){
      const y=p.date.getFullYear();
      if(!map.has(y)) map.set(y,[]);
      map.get(y).push(p.value);
    }
    const rows=[];
    for(const [year,vals] of [...map.entries()].sort((a,b)=>a[0]-b[0])){
      const s=ANAStats.summarize(vals);
      const expected=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
      const complete=vals.length===expected && year<new Date().getFullYear();
      rows.push({ano:year,valor:type==="chuva"?vals.reduce((a,b)=>a+b,0):s.mean,min:s.min,max:s.max,n:vals.length,expected,coverage:vals.length/expected,complete});
    }
    return rows;
  }

  function setKpis(rows,type){
    rows=rows.filter(r=>r.complete);
    kpis.innerHTML="";
    const vals=rows.map(r=>r.valor), s=ANAStats.summarize(vals);
    const minRow=rows.reduce((a,b)=>!a||b.valor<a.valor?b:a,null);
    const maxRow=rows.reduce((a,b)=>!a||b.valor>a.valor?b:a,null);
    const unit=type==="chuva"?"mm":type==="cotas"?"cm":"m³/s";
    const cards=[
      ["Anos completos",String(rows.length)],
      ["Média anual",`${fmt(s.mean)} ${unit}`],
      [type==="chuva"?"Ano mais seco":"Menor ano",minRow?`${minRow.ano} · ${fmt(minRow.valor)} ${unit}`:"—"],
      [type==="chuva"?"Ano mais chuvoso":"Maior ano",maxRow?`${maxRow.ano} · ${fmt(maxRow.valor)} ${unit}`:"—"],
      ["Desvio-padrão",`${fmt(s.sd)} ${unit}`],
      ["CV",`${fmt(s.cv,1)}%`]
    ];
    for(const [k,v] of cards){
      const d=document.createElement("div"); d.className="kpiCard";
      d.innerHTML=`<div class="k">${k}</div><div class="v">${v}</div>`; kpis.appendChild(d);
    }
  }

  function renderTrend(rows,type){
    rows=rows.filter(r=>r.complete);
    const xs=rows.map(r=>r.ano), ys=rows.map(r=>r.valor);
    const mk=ANAStats.mannKendall(ys), sen=ANAStats.senSlope(xs,ys), lr=ANAStats.linear(xs,ys);
    const unit=type==="chuva"?"mm":type==="cotas"?"cm":"m³/s";
    if(!mk || !lr){ trendSummary.textContent="Anos completos insuficientes para análise de tendência (mínimo de 8)."; return null; }
    const direction=sen>0?"aumento":sen<0?"redução":"estabilidade";
    const sig=mk.p<0.05?"há evidência de tendência monotônica (p < 0,05)":"não há evidência estatística de tendência monotônica a 5%";
    trendSummary.innerHTML=`<span class="trendGood">Mann-Kendall:</span> τ = ${fmt(mk.tau,3)}, p = ${fmt(mk.p,4)} — ${sig}. 
      <span class="trendGood">Sen:</span> ${fmt(sen)} ${unit}/ano (${direction}; ${fmt(sen*10)} ${unit}/década).
      <span class="trendMuted">Regressão linear descritiva: R² = ${fmt(lr.r2,3)}.</span>`;
    return {mk,sen,lr};
  }

  function renderChart(rows,type,trend){
    if(chart) chart.destroy();
    const ctx=$("mainChart").getContext("2d");
    const unit=type==="chuva"?"mm":type==="cotas"?"cm":"m³/s";
    const datasets=[{type:type==="chuva"?"bar":"line",label:`Valor observado no ano (${unit}; pode ser parcial)`,data:rows.map(r=>r.valor),borderWidth:2,pointRadius:type==="chuva"?0:2,tension:.2}];
    if(trend?.lr) datasets.push({type:"line",label:"Tendência linear",data:rows.map(r=>r.complete?trend.lr.predict(r.ano):null),borderDash:[7,5],pointRadius:0,borderWidth:2});
    chart=new Chart(ctx,{data:{labels:rows.map(r=>r.ano),datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},scales:{y:{title:{display:true,text:unit}}}}});
  }

  function renderTable(rows){
    lastRows=rows; tblHead.innerHTML="<tr><th>Ano</th><th>Valor anual</th><th>Mín.</th><th>Máx.</th><th>N</th><th>Cobertura do ano</th><th>Situação</th></tr>"; tblBody.innerHTML="";
    for(const r of rows){ const tr=document.createElement("tr"); tr.innerHTML=`<td>${r.ano}</td><td>${fmt(r.valor)}</td><td>${fmt(r.min)}</td><td>${fmt(r.max)}</td><td>${r.n}</td><td>${fmt(r.coverage*100,1)}%</td><td>${r.complete?"Completo":"Parcial: fora de rankings e tendências"}</td>`; tblBody.appendChild(tr); }
    tableMeta.textContent=`${rows.length} anos processados.`;
  }

  btnStations.addEventListener("click",async()=>{
    const requestedUF=ufSelect.value,requestedType=seriesType.value;
    const locked=[btnStations,btnRun,ufSelect,seriesType,stationSearch,stationSelect,publicStation,dataSource];locked.forEach(el=>el.disabled=true);
    try{
      const base=proxyUrl.value.trim(); localStorage.setItem("anaProxyUrl",base);
      if(!ufSelect.value) throw new Error("Selecione uma UF.");
      setMsg("Carregando inventário ANA...");
      const api=dataSource.value==="public"?new AnaPublicApi():new AnaApi(base); const raw=await api.inventory(requestedUF,requestedType);
      stations=raw.map(normalizeStation).filter(s=>s.code);
      renderStations();
      if(dataSource.value==="public")publicStation.value=stationSelect.value;
      setMsg(`${stations.length.toLocaleString("pt-BR")} estações carregadas para ${requestedUF}.`);
    }catch(e){ setMsg(e.message||String(e),true); }finally{locked.forEach(el=>el.disabled=false);updateSource();}
  });

  ufSelect.addEventListener("change",()=>{stations=[];filtered=[];renderStations();publicStation.value="";setMsg("UF alterada. Carregue o catálogo da nova UF.");});
  stationSearch.addEventListener("input",renderStations);
  stationSelect.addEventListener("change",()=>{showStationMeta();if(dataSource.value==="public")publicStation.value=stationSelect.value;});
  seriesType.addEventListener("change",()=>{stations=[];filtered=[];renderStations();publicStation.value="";setMsg("Variável alterada. Recarregue o catálogo da UF ou informe o código da estação.");});

  btnRun.addEventListener("click",async()=>{
    btnRun.disabled=true;
    const locked=[dataSource,publicStation,seriesType,consistency,dateStart,dateEnd,proxyUrl,ufSelect,stationSelect,stationSearch,btnStations];
    locked.forEach(el=>el.disabled=true);
    try{
      const publicMode=dataSource.value==="public";
      const station=publicMode?publicStation.value.trim():stationSelect.value; if(!station) throw new Error("Selecione uma estação.");
      if(!dateStart.value||!dateEnd.value) throw new Error("Informe o período.");
      setMsg("Buscando e processando a série ANA...");
      const api=publicMode?new AnaPublicApi():new AnaApi(proxyUrl.value.trim());
      const raw=await api.series({type:seriesType.value,station,start:dateStart.value,end:dateEnd.value,...(publicMode?{consistency:consistency.value}:{})});
      const start=parseDate(dateStart.value), end=parseDate(dateEnd.value);
      const pts=flattenSeries(raw,seriesType.value).filter(p=>p.date>=start && p.date<=end);
      if(!pts.length) throw new Error(publicMode?`Nenhuma observação diária real disponível para este período no nível ${consistency.value}. ${consistency.value==="2"?"Pode haver dados brutos (nível 1); selecione-os explicitamente para consultar.":"Não preenchemos ausências com zero."}`:"A consulta respondeu, mas nenhum valor numérico foi reconhecido. Verifique estação, variável, período e consistência.");
      const rows=annualize(pts,seriesType.value);
      if(!rows.length) throw new Error("Não foi possível agregar a série por ano.");
      setKpis(rows,seriesType.value);
      const trend=renderTrend(rows,seriesType.value);
      renderChart(rows,seriesType.value,trend);
      renderTable(rows);
      const s=stations.find(x=>x.code===station);
      chartTitle.textContent=`${seriesType.options[seriesType.selectedIndex].text} — ${s?.name||station}`;
      chartMeta.textContent=`${station} · ${dateStart.value} a ${dateEnd.value} · última observação: ${pts[pts.length-1].date.toLocaleDateString("pt-BR")} · ANA/HidroWeb · ${publicMode?"consulta pública, nível "+consistency.value:"proxy experimental"}`;
      setMsg(`Pronto: ${pts.length.toLocaleString("pt-BR")} observações processadas em ${rows.length} anos.${raw.quality?" Excluídos: "+raw.quality.excludedStatus+" valores com status diferente de real, "+raw.quality.missing+" ausentes/sentinelas e "+raw.quality.conflicts+" conflitos.":""}`);
    }catch(e){ setMsg(e.message||String(e),true); }finally{btnRun.disabled=false;locked.forEach(el=>el.disabled=false);updateSource();}
  });

  btnCsv.addEventListener("click",()=>{
    if(!lastRows.length){ setMsg("Gere uma análise primeiro.",true); return; }
    const lines=["ano;valor_observado;min;max;n;dias_esperados;cobertura;completo",...lastRows.map(r=>[r.ano,r.valor,r.min,r.max,r.n,r.expected,r.coverage,r.complete].join(";"))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ana_hidroweb_serie_anual.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
})();
