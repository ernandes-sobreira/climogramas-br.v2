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
  dateStart.value="1970-01-01";
  proxyUrl.value=localStorage.getItem("anaProxyUrl")||"";

  function setMsg(t,err=false){ msgBox.textContent=t; msgBox.style.borderColor=err?"rgba(251,113,133,.45)":""; }
  const num=v=>{ const n=Number(String(v??"").replace(",", ".")); return Number.isFinite(n)?n:NaN; };
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
    showStationMeta();
  }

  function showStationMeta(){
    const s=stations.find(x=>x.code===stationSelect.value);
    stationMeta.textContent=s ? [s.name,s.city,s.uf,s.river,s.type].filter(Boolean).join(" · ") : "—";
  }

  function parseDate(v){
    if(!v) return null;
    const s=String(v).trim();
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3]));
    const br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(br) return new Date(Number(br[3]),Number(br[2])-1,Number(br[1]));
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
    const seen=new Set();
    return out.filter(r=>{ const k=r.date.toISOString().slice(0,10)+"|"+r.value; if(seen.has(k))return false; seen.add(k); return true; });
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
      rows.push({ano:year,valor:type==="chuva"?vals.reduce((a,b)=>a+b,0):s.mean,min:s.min,max:s.max,n:vals.length});
    }
    return rows;
  }

  function setKpis(rows,type){
    kpis.innerHTML="";
    const vals=rows.map(r=>r.valor), s=ANAStats.summarize(vals);
    const minRow=rows.reduce((a,b)=>!a||b.valor<a.valor?b:a,null);
    const maxRow=rows.reduce((a,b)=>!a||b.valor>a.valor?b:a,null);
    const unit=type==="chuva"?"mm":type==="cotas"?"cm":"m³/s";
    const cards=[
      ["Anos úteis",String(rows.length)],
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
    const xs=rows.map(r=>r.ano), ys=rows.map(r=>r.valor);
    const mk=ANAStats.mannKendall(ys), sen=ANAStats.senSlope(xs,ys), lr=ANAStats.linear(xs,ys);
    const unit=type==="chuva"?"mm":type==="cotas"?"cm":"m³/s";
    if(!mk || !lr){ trendSummary.textContent="Série insuficiente para análise de tendência."; return null; }
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
    const datasets=[{type:type==="chuva"?"bar":"line",label:`Valor anual (${unit})`,data:rows.map(r=>r.valor),borderWidth:2,pointRadius:type==="chuva"?0:2,tension:.2}];
    if(trend?.lr) datasets.push({type:"line",label:"Tendência linear",data:rows.map(r=>trend.lr.predict(r.ano)),borderDash:[7,5],pointRadius:0,borderWidth:2});
    chart=new Chart(ctx,{data:{labels:rows.map(r=>r.ano),datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},scales:{y:{title:{display:true,text:unit}}}}});
  }

  function renderTable(rows){
    lastRows=rows; tblHead.innerHTML="<tr><th>Ano</th><th>Valor anual</th><th>Mín.</th><th>Máx.</th><th>N</th></tr>"; tblBody.innerHTML="";
    for(const r of rows){ const tr=document.createElement("tr"); tr.innerHTML=`<td>${r.ano}</td><td>${fmt(r.valor)}</td><td>${fmt(r.min)}</td><td>${fmt(r.max)}</td><td>${r.n}</td>`; tblBody.appendChild(tr); }
    tableMeta.textContent=`${rows.length} anos processados.`;
  }

  btnStations.addEventListener("click",async()=>{
    try{
      const base=proxyUrl.value.trim(); localStorage.setItem("anaProxyUrl",base);
      if(!ufSelect.value) throw new Error("Selecione uma UF.");
      setMsg("Carregando inventário ANA...");
      const api=new AnaApi(base); const raw=await api.inventory(ufSelect.value);
      stations=raw.map(normalizeStation).filter(s=>s.code);
      renderStations();
      setMsg(`${stations.length.toLocaleString("pt-BR")} estações carregadas para ${ufSelect.value}.`);
    }catch(e){ setMsg(e.message||String(e),true); }
  });

  stationSearch.addEventListener("input",renderStations);
  stationSelect.addEventListener("change",showStationMeta);

  btnRun.addEventListener("click",async()=>{
    try{
      const station=stationSelect.value; if(!station) throw new Error("Selecione uma estação.");
      if(!dateStart.value||!dateEnd.value) throw new Error("Informe o período.");
      setMsg("Buscando e processando a série ANA...");
      const api=new AnaApi(proxyUrl.value.trim());
      const raw=await api.series({type:seriesType.value,station,start:dateStart.value,end:dateEnd.value,consistency:consistency.value});
      const pts=flattenSeries(raw,seriesType.value);
      if(!pts.length) throw new Error("A consulta respondeu, mas nenhum valor numérico foi reconhecido. Verifique série, período e proxy.");
      const rows=annualize(pts,seriesType.value);
      if(!rows.length) throw new Error("Não foi possível agregar a série por ano.");
      setKpis(rows,seriesType.value);
      const trend=renderTrend(rows,seriesType.value);
      renderChart(rows,seriesType.value,trend);
      renderTable(rows);
      const s=stations.find(x=>x.code===station);
      chartTitle.textContent=`${seriesType.options[seriesType.selectedIndex].text} — ${s?.name||station}`;
      chartMeta.textContent=`${station} · ${dateStart.value} a ${dateEnd.value} · ANA/HidroWeb`;
      setMsg(`Pronto: ${pts.length.toLocaleString("pt-BR")} observações processadas em ${rows.length} anos.`);
    }catch(e){ setMsg(e.message||String(e),true); }
  });

  btnCsv.addEventListener("click",()=>{
    if(!lastRows.length){ setMsg("Gere uma análise primeiro.",true); return; }
    const lines=["ano;valor_anual;min;max;n",...lastRows.map(r=>[r.ano,r.valor,r.min,r.max,r.n].join(";"))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ana_hidroweb_serie_anual.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
})();