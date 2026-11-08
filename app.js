(() => {
  "use strict";
  // Paleta legível na nova interface clara; mantém cálculos e dados originais.
  if (typeof Chart !== "undefined") {
    Chart.defaults.color = "#456578";
    Chart.defaults.borderColor = "rgba(49,100,120,.12)";
    Chart.defaults.font.family = "DM Sans, Arial, sans-serif";
  }

  const $ = (id) => document.getElementById(id);
  const BASE = new URL(".", location.href).toString();
  const ASSETS = new URL("assets/", BASE).toString();

  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const monthName = (m) => monthNames[(m-1)] || String(m);

  const safeNum = (v) => (v===null || v===undefined) ? NaN : (typeof v==="number" ? v : Number(v));
  const isObj = (x) => x && typeof x === "object";

  const meanFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((a,b)=>a+b,0)/xs.length;
  };
  const sumFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((a,b)=>a+b,0);
  };
  const minFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return Math.min(...xs);
  };
  const maxFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return Math.max(...xs);
  };

  const fmt = (v, d=2) => Number.isFinite(v) ? v.toFixed(d) : "—";

  function setMsg(text, kind="ok"){
    const box = $("msgBox");
    box.textContent = text;
    if (chartLoading && kind === "err") loadingError = text;
    box.style.borderColor = (kind==="err") ? "rgba(251,113,133,.35)" : "rgba(36,91,114,.15)";
    box.style.background = (kind==="err") ? "rgba(251,113,133,.10)" : "#f4fafb";
    box.style.color = (kind==="err") ? "#a12e35" : "#567484";
  }

  // Downloads robustos
  function clickDownload(href, filename){
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function downloadTextCSV(filename, csvText){
    try{
      const blob = new Blob([csvText], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      clickDownload(url, filename);
      setTimeout(()=>URL.revokeObjectURL(url), 1500);
      return true;
    } catch(e){
      const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csvText);
      clickDownload(url, filename);
      return true;
    }
  }
  function downloadPngSync(chart, filename){
    const url = chart?.toBase64Image?.("image/png", 1);
    if (!url || typeof url !== "string") throw new Error("Falha ao gerar PNG (toBase64Image).");
    const comma=url.indexOf(',');
    if(!url.startsWith('data:image/png;base64,')||comma<0)throw Error('Imagem PNG inválida.');
    const raw=atob(url.slice(comma+1)),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    const objectUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    clickDownload(objectUrl,filename);
    setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
    return true;
  }

  // UI
  const ufSelect = $("ufSelect");
  const searchStation = $("searchStation");
  const stationSelect = $("stationSelect");
  const stationMeta = $("stationMeta");
  const yearStart = $("yearStart");
  const yearEnd = $("yearEnd");

  const btnRun = $("btnRun");
  const btnPng = $("btnPng");
  const btnCsv = $("btnCsv");
  const btnReset = $("btnReset");

  const var1 = $("var1");
  const var2 = $("var2");

  const trendModel = $("trendModel");
  const showTrend = $("showTrend");
  const showR2 = $("showR2");
  const optMinMax = $("optMinMax");
  const optMean = $("optMean");
  const optPrecBars = $("optPrecBars");

  const chartTitle = $("chartTitle");
  const chartMeta = $("chartMeta");
  const kpisBox = $("kpis");

  const tblHead = $("tblHead");
  const tblBody = $("tblBody");
  const tableMeta = $("tableMeta");

  const pillStation = $("pillStation");
  const pillYears = $("pillYears");
  const pillData = $("pillData");

  const heatLegend = $("heatLegend");
  const heatMinEl = $("heatMin");
  const heatMidEl = $("heatMid");
  const heatMaxEl = $("heatMax");
  const heatLegendBar = $("heatLegendBar");

  // Help modal
  const btnHelp = $("btnHelp");
  const helpOverlay = $("helpOverlay");
  const btnHelpClose = $("btnHelpClose");

  // state
  let stations = [];
  let filteredStations = [];
  let selectedStation = null;
  let stationSelectionVersion = 0;

  let mode = "clim";
  let chart = null;

  let lastRows = [];
  let lastCsvName = "tabela.csv";
  let lastPngName = "grafico.png";

  const packCache = new Map();
  const existsCache = new Map();

  let map = null;
  let markersLayer = null;

  const VAR_LABELS = {
    tmean: "Temperatura média (°C)",
    tmin: "Temperatura mínima (°C)",
    tmax: "Temperatura máxima (°C)",
    p: "Precipitação (mm)",
    prec: "Precipitação (mm)",
    prcp: "Precipitação (mm)",
    ppt: "Precipitação (mm)",
    press: "Pressão (hPa)",
    rad: "Radiação",
    rh: "Umidade relativa (%)",
    wind: "Vento",
  };
  function labelOfVar(k){ return VAR_LABELS[k] || k; }

  function stationLabel(s){
    if (!s) return "—";
    return `${s.code} · ${s.name} (${s.uf})`;
  }

  function updatePills(info){
    pillStation.textContent = `Estação: ${info.station ?? "—"}`;
    pillYears.textContent = `Anos: ${info.years ?? "—"}`;
    pillData.textContent = `Dados: ${info.data ?? "—"}`;
  }

  function setMode(newMode){
    mode = newMode;
    for (const b of document.querySelectorAll(".modeBtn")) b.classList.remove("active");
    const btn = document.querySelector(`.modeBtn[data-mode="${newMode}"]`);
    if (btn) btn.classList.add("active");

    const relOn = (mode === "rel");
    var2.disabled = !relOn;
    trendModel.disabled = !relOn;
    showTrend.disabled = !relOn;
    showR2.disabled = !relOn;

    heatLegend.style.display = (mode==="heatmap") ? "block" : "none";
  }

  function setKpis(items){
    kpisBox.innerHTML = "";
    for (const it of items){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="k">${it.k}</div><div class="v">${it.v}</div>`;
      kpisBox.appendChild(div);
    }
  }

  function tableSet(rows, columns, decimals=2){
    lastRows = rows || [];
    tblHead.innerHTML = "";
    tblBody.innerHTML = "";

    if (!rows || !rows.length){
      tableMeta.textContent = "Sem linhas para exibir.";
      return;
    }

    const cols = columns?.length ? columns : Object.keys(rows[0]);
    tableMeta.textContent = `Mostrando ${rows.length} de ${rows.length} linhas.`;

    const trh = document.createElement("tr");
    for (const c of cols){
      const th = document.createElement("th");
      th.textContent = c;
      trh.appendChild(th);
    }
    tblHead.appendChild(trh);

    for (const r of rows){
      const tr = document.createElement("tr");
      for (const c of cols){
        const td = document.createElement("td");
        const v = r[c];
        if (typeof v === "number" && Number.isFinite(v)){
          td.textContent = v.toFixed(decimals);
        } else {
          td.textContent = (v ?? "");
        }
        tr.appendChild(td);
      }
      tblBody.appendChild(tr);
    }
  }

  function rowsToCsv(rows, columns){
    if (!rows || !rows.length) return "";
    const cols = columns?.length ? columns : Object.keys(rows[0]);
    const esc = (s) => {
      const t = typeof s === "number" && Number.isFinite(s) ? String(Number(s.toPrecision(15))) : String(s ?? "");
      if (/[",\n;]/.test(t)) return `"${t.replaceAll('"','""')}"`;
      return t;
    };
    const lines = [];
    lines.push(cols.join(";"));
    for (const r of rows){
      lines.push(cols.map(c=>esc(r[c])).join(";"));
    }
    return lines.join("\n");
  }

  function fillSelect(sel, items, getLabel=(x)=>x, getValue=(x)=>x, keepValue=true){
    const old = sel.value;
    sel.innerHTML = "";
    for (const it of items){
      const opt = document.createElement("option");
      opt.value = getValue(it);
      opt.textContent = getLabel(it);
      sel.appendChild(opt);
    }
    if (keepValue && old && [...sel.options].some(o=>o.value===old)) sel.value = old;
  }

  async function fetchJson(url){
    const res = await fetch(url, {cache:"no-store"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function dataUrl(code, year){
    return new URL(`data/${code}/${year}.json`, ASSETS).toString();
  }

  async function yearExists(code, year){
    const key = `${code}_${year}`;
    if (existsCache.has(key)) return existsCache.get(key);
    try{
      const res = await fetch(dataUrl(code, year), {method:"HEAD", cache:"no-store"});
      const ok = res.ok;
      existsCache.set(key, ok);
      return ok;
    }catch(e){
      existsCache.set(key, false);
      return false;
    }
  }

  async function loadPack(code, year){
    const key = `${code}_${year}`;
    if (packCache.has(key)) return packCache.get(key);
    const obj = await fetchJson(dataUrl(code, year));
    obj.year = year;
    if (!Array.isArray(obj.months)) obj.months = [];
    packCache.set(key, obj);
    return obj;
  }

  async function loadPacksForRange(code, y0, y1){
    const packs = [];
    for (let y=y0; y<=y1; y++){
      const ok = await yearExists(code, y);
      if (!ok) continue;
      try{ packs.push(await loadPack(code, y)); } catch(_){}
    }
    return packs;
  }

  function collectVarsFromPacks(packs){
    const keys = new Set();
    for (const p of packs){
      for (const m of (p.months||[])){
        if (!isObj(m)) continue;
        for (const k of Object.keys(m)){
          if (k === "m") continue;
          keys.add(k);
        }
      }
    }
    const arr = Array.from(keys);
    arr.sort((a,b)=>{
      const pr = (x) => (x==="tmean"?0:(x==="p"?1:10));
      const d = pr(a)-pr(b);
      if (d!==0) return d;
      return a.localeCompare(b);
    });
    return arr;
  }

  function destroyChart(){
    if (chart){ chart.destroy(); chart = null; }
  }
  function renderChart(config){
    destroyChart();
    const ctx = $("mainChart").getContext("2d");
    chart = new Chart(ctx, config);
  }

  // map
  function initMap(){
    map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([-14.2, -55.0], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }
  function renderMarkers(){
    if(!markersLayer)return;
    markersLayer.clearLayers();
    for (const s of filteredStations){
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const mk = L.circleMarker([s.lat, s.lon], { radius: 5, weight: 1, opacity: .9, fillOpacity: .65 });
      mk.bindTooltip(`${s.code} · ${s.name} (${s.uf})`, {sticky:true});
      mk.on("click", ()=>{
        stationSelect.value = s.code;
        selectStation(s.code, true);
      });
      mk.addTo(markersLayer);
    }
  }
  async function loadStationVariables(station, version){
    const years=station?.years || [];
    fillSelect(var1, [], x=>x, x=>x, false);
    fillSelect(var2, [], x=>x, x=>x, false);
    // Fetch just the newest available pack to populate choices; run() still
    // discovers all variables in the chosen range before doing calculations.
    for(const year of years.slice().sort((a,b)=>b-a)){
      try{
        const pack=await loadPack(station.code,year);
        if(version!==stationSelectionVersion)return;
        const vars=collectVarsFromPacks([pack]);
        if(!vars.length)continue;
        fillSelect(var1,vars,k=>labelOfVar(k),k=>k,false);
        fillSelect(var2,vars,k=>labelOfVar(k),k=>k,false);
        var1.value=vars.includes("tmean")?"tmean":vars[0];
        var2.value=vars.includes("p")?"p":vars[0];
        return;
      }catch(_){if(version!==stationSelectionVersion)return;}
    }
    if(version===stationSelectionVersion)setMsg("Não foi possível carregar as variáveis desta estação. Tente Gerar ou selecione outra estação.","err");
  }
  function selectStation(code, zoom=true){
    if(anaBusy||chartLoading)return;
    if(isAna()){stationSelectionVersion++;return selectAnaStation(code,zoom);}
    selectedStation = stations.find(s=>s.code===code) || null;
    const selectionVersion=++stationSelectionVersion;

    stationMeta.textContent = selectedStation
      ? `${selectedStation.name} · ${selectedStation.uf} · lat ${selectedStation.lat} lon ${selectedStation.lon}`
      : "—";

    updatePills({station: selectedStation ? selectedStation.code : "—", years:"—", data:"—"});

    // Usar anos realmente publicados por estação, sem teto fixo em 2024.
    const years = [...new Set((selectedStation?.years || []).map(Number).filter(Number.isInteger))]
      .sort((a,b)=>a-b).map(String);
    const previousStart=yearStart.value,previousEnd=yearEnd.value;
    fillSelect(yearStart, years, y=>y, y=>y, false);
    fillSelect(yearEnd, years, y=>y, y=>y, false);
    if (years.length) {
      yearStart.value=years.includes(previousStart)?previousStart:years[0];
      yearEnd.value=years.includes(previousEnd)?previousEnd:years[years.length-1];
    }

    if(selectedStation && years.length)void loadStationVariables(selectedStation,selectionVersion);
    else{fillSelect(var1,[],x=>x,x=>x,false);fillSelect(var2,[],x=>x,x=>x,false);}

    if (zoom && selectedStation && map && Number.isFinite(selectedStation.lat) && Number.isFinite(selectedStation.lon)){
      map.setView([selectedStation.lat, selectedStation.lon], 7, {animate:true});
    }
  }
  function applyFilters(zoomIfSingle=false){
    const uf = ufSelect.value;
    const q = (searchStation.value || "").trim().toLowerCase();

    filteredStations = stations.filter(s=>{
      const okUf = (uf==="Todas") || (s.uf===uf);
      const hay = `${s.code} ${s.name}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      return okUf && okQ;
    });

    fillSelect(
      stationSelect,
      filteredStations,
      s => `${s.code} · ${s.name} (${s.uf})`,
      s => s.code,
      false
    );

    if (!filteredStations.length){
      selectedStation = null;
      stationSelectionVersion++;
      for(const select of [yearStart,yearEnd,var1,var2])fillSelect(select,[],x=>x,x=>x,false);
      stationMeta.textContent = "—";
      updatePills({station:"—", years:"—", data:"—"});
      return;
    }

    if (zoomIfSingle && filteredStations.length===1){
      stationSelect.value = filteredStations[0].code;
      selectStation(filteredStations[0].code, true);
      return;
    }

    const code = stationSelect.value || filteredStations[0].code;
    stationSelect.value = code;
    selectStation(code, false);
  }

  // trend models (mantidos)
  function linReg(xs, ys){
    const n = xs.length;
    const xbar = xs.reduce((a,b)=>a+b,0)/n;
    const ybar = ys.reduce((a,b)=>a+b,0)/n;
    let ssxx=0, ssxy=0, ssyy=0;
    for (let i=0;i<n;i++){
      const dx = xs[i]-xbar, dy = ys[i]-ybar;
      ssxx += dx*dx;
      ssxy += dx*dy;
      ssyy += dy*dy;
    }
    const b = ssxy/ssxx;
    const a = ybar - b*xbar;

    let ssres=0;
    for (let i=0;i<n;i++){
      const yhat = a + b*xs[i];
      ssres += (ys[i]-yhat)**2;
    }
    const r2 = 1 - (ssres/ssyy);
    return {r2, predict:(x)=>a+b*x};
  }
  function polyFit(xs, ys, deg){
    const n = xs.length;
    const m = deg + 1;

    const S = Array(2*deg+1).fill(0);
    for (let i=0;i<n;i++){
      let p=1;
      for (let k=0;k<=2*deg;k++){
        S[k] += p;
        p *= xs[i];
      }
    }

    const A = Array.from({length:m}, ()=>Array(m).fill(0));
    const B = Array(m).fill(0);

    for (let r=0;r<m;r++){
      for (let c=0;c<m;c++) A[r][c] = S[r+c];
      let sum=0;
      for (let i=0;i<n;i++) sum += ys[i] * (xs[i]**r);
      B[r]=sum;
    }

    const M = A.map((row,i)=>row.concat([B[i]]));

    for (let i=0;i<m;i++){
      let piv=i;
      for (let r=i+1;r<m;r++) if (Math.abs(M[r][i])>Math.abs(M[piv][i])) piv=r;
      if (Math.abs(M[piv][i])<1e-12) return null;
      [M[i],M[piv]]=[M[piv],M[i]];

      const div=M[i][i];
      for (let c=i;c<=m;c++) M[i][c]/=div;

      for (let r=0;r<m;r++){
        if (r===i) continue;
        const f=M[r][i];
        for (let c=i;c<=m;c++) M[r][c]-=f*M[i][c];
      }
    }

    const coef=M.map(row=>row[m]);
    const predict=(x)=>{
      let y=0,p=1;
      for (let k=0;k<coef.length;k++){ y += coef[k]*p; p*=x; }
      return y;
    };

    const ybar = ys.reduce((a,b)=>a+b,0)/n;
    let ssyy=0, ssres=0;
    for (let i=0;i<n;i++){
      const yhat=predict(xs[i]);
      ssyy += (ys[i]-ybar)**2;
      ssres += (ys[i]-yhat)**2;
    }
    const r2=1-(ssres/ssyy);
    return {r2,predict};
  }
  function trendFit(xs, ys, model){
    if (model==="linear") return linReg(xs, ys);

    if (model==="log"){
      const X=[], Y=[];
      for (let i=0;i<xs.length;i++){
        if (xs[i]>0 && Number.isFinite(xs[i]) && Number.isFinite(ys[i])){
          X.push(Math.log(xs[i])); Y.push(ys[i]);
        }
      }
      if (X.length<8) return null;
      const reg = linReg(X, Y);
      return {r2: reg.r2, predict:(x)=> x>0 ? reg.predict(Math.log(x)) : NaN};
    }

    if (model==="exp"){
      const X=[], Ylog=[];
      for (let i=0;i<xs.length;i++){
        if (ys[i]>0 && Number.isFinite(xs[i]) && Number.isFinite(ys[i])){
          X.push(xs[i]); Ylog.push(Math.log(ys[i]));
        }
      }
      if (X.length<8) return null;
      const reg = linReg(X, Ylog);
      const A = Math.exp(reg.predict(0));
      const B = reg.predict(1) - reg.predict(0);
      const predict = (x)=>A*Math.exp(B*x);

      const ybar = ys.reduce((a,b)=>a+b,0)/ys.length;
      let ssyy=0, ssres=0;
      for (let i=0;i<ys.length;i++){
        const yhat=predict(xs[i]);
        ssyy += (ys[i]-ybar)**2;
        ssres += (ys[i]-yhat)**2;
      }
      const r2=1-(ssres/ssyy);
      return {r2,predict};
    }

    if (model==="poly2") return polyFit(xs, ys, 2);
    if (model==="poly3") return polyFit(xs, ys, 3);
    return null;
  }

  // heatmap colors
  function clamp01(t){ return Math.max(0, Math.min(1, t)); }
  function heatColor(t){
    t = clamp01(t);
    const stops = [
      [0.00, [35, 23, 140]],
      [0.20, [0, 140, 255]],
      [0.40, [0, 220, 190]],
      [0.60, [255, 230, 80]],
      [0.80, [255, 120, 40]],
      [1.00, [255, 50, 90]],
    ];
    let a=stops[0], b=stops[stops.length-1];
    for (let i=0;i<stops.length-1;i++){
      if (t>=stops[i][0] && t<=stops[i+1][0]){ a=stops[i]; b=stops[i+1]; break; }
    }
    const tt=(t-a[0])/(b[0]-a[0]||1);
    const c=[
      Math.round(a[1][0]+(b[1][0]-a[1][0])*tt),
      Math.round(a[1][1]+(b[1][1]-a[1][1])*tt),
      Math.round(a[1][2]+(b[1][2]-a[1][2])*tt),
    ];
    return `rgba(${c[0]},${c[1]},${c[2]},0.95)`;
  }
  function setHeatLegendGradient(){
    if (!heatLegendBar) return;
    heatLegendBar.style.background = "linear-gradient(90deg, rgba(35,23,140,.95), rgba(0,140,255,.95), rgba(0,220,190,.95), rgba(255,230,80,.95), rgba(255,120,40,.95), rgba(255,50,90,.95))";
  }

  // Keep feedback inside the chart AND in the mobile viewport, not only above the fold.
  let chartLoading = false, loadingError = '', loadingTimer = null;
  function loadingUi(){
    if($('chartLoading'))return;
    const style=document.createElement('style');
    style.textContent=`#chartLoading[hidden],#loadingToast[hidden]{display:none!important}
      #chartLoading{position:absolute;inset:12px;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(244,250,251,.96);border:1px solid #b7d5df;border-radius:14px;color:#163f52;padding:20px;text-align:center}
      #chartLoading strong{display:block;font-size:19px;margin-bottom:10px}#chartLoading p{max-width:440px;margin:8px auto;line-height:1.5}
      #loadingToast{position:fixed;bottom:calc(14px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:1200;width:min(520px,calc(100% - 28px));box-sizing:border-box;background:#123f50;color:#fff;padding:13px 18px;border-radius:12px;box-shadow:0 4px 18px #0003;font:600 14px/1.45 Arial,sans-serif;pointer-events:none}
      .loadingDot{display:inline-block;width:22px;height:22px;border:3px solid #b7d5df;border-top-color:#087f8c;border-radius:50%;animation:climSpin 1s linear infinite;margin-bottom:8px}@keyframes climSpin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.loadingDot{animation:none}}`;
    document.head.appendChild(style);
    const panel=document.createElement('div');panel.id='chartLoading';panel.hidden=true;panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
    panel.innerHTML='<div><span class="loadingDot" aria-hidden="true"></span><strong id="loadingTitle">Carregando dados…</strong><p id="loadingDetail"></p><p id="loadingElapsed"></p></div>';
    document.querySelector('.chartWrap').appendChild(panel);
    const toast=document.createElement('div');toast.id='loadingToast';toast.hidden=true;toast.setAttribute('aria-hidden','true');document.body.appendChild(toast);
  }
  async function run(){
    if(chartLoading||anaBusy)return;
    loadingUi();chartLoading=true;loadingError='';
    const label={clim:'gráfico mensal',annual:'gráfico anual',heatmap:'mapa de calor',rel:'correlação entre variáveis'}[mode]||'gráfico';
    const title=isRecent()?'Carregando leituras recentes…':`Preparando ${label}…`;
    $('loadingTitle').textContent=title;
    $('loadingDetail').textContent='A consulta e o cálculo podem levar alguns segundos ou minutos, conforme o período e a resposta da fonte. Aguarde: o gráfico ainda está sendo preparado.';
    $('loadingElapsed').textContent='';$('chartLoading').hidden=false;$('loadingToast').hidden=false;
    $('loadingToast').textContent=title+' Aguarde; períodos longos podem levar alguns minutos.';
    $('mainChart').setAttribute('aria-busy','true');
    const started=Date.now();
    loadingTimer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);$('loadingElapsed').textContent=`Tempo decorrido: ${elapsed}s. ${elapsed>=15?'Ainda consultando ou processando os dados.':''}`;},1000);
    const controls=[btnRun,btnPng,btnCsv,sourceSelect,ufSelect,stationSelect,searchStation,yearStart,yearEnd,var1,var2,anaType,anaConsistency,btnReset,...document.querySelectorAll('.modeBtn')];
    const disabled=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);
    const runLabel=btnRun.textContent;btnRun.textContent='Carregando…';
    try{
      // Yield before any cached-data calculation, so the loading state gets painted.
      await new Promise(resolve=>setTimeout(resolve,40));
      await performRun();
    }catch(e){setMsg(`Falha ao preparar gráfico: ${e.message||e}`,'err');}
    finally{
      clearInterval(loadingTimer);loadingTimer=null;chartLoading=false;
      $('mainChart').setAttribute('aria-busy','false');$('chartLoading').hidden=true;$('loadingToast').hidden=true;
      controls.forEach((el,i)=>el.disabled=disabled[i]);btnRun.textContent=runLabel;
      if(loadingError){chartMeta.textContent=loadingError+' O resultado anterior, se houver, não foi atualizado.';}
    }
  }

  async function performRun(){
    if(isAna())return runAna();
    try{
      if (!selectedStation){ setMsg("Selecione uma estação.", "err"); return; }

      if(!yearStart.value || !yearEnd.value){setMsg("Selecione anos disponíveis para esta estação.","err");return;}
      let y0 = Number(yearStart.value);
      let y1 = Number(yearEnd.value);
      if (!Number.isInteger(y0) || !Number.isInteger(y1) || !selectedStation.years.includes(y0) || !selectedStation.years.includes(y1)) {setMsg("Período fora dos anos publicados para esta estação.","err");return;}
      if (y0>y1) [y0,y1]=[y1,y0];

      setMsg("Carregando dados...", "ok");

      const code = selectedStation.code;
      const queryEpoch=sourceEpoch,queryMode=mode;
      const packs = await loadPacksForRange(code, y0, y1);
      if(isAna()||sourceEpoch!==queryEpoch||selectedStation?.code!==code||mode!==queryMode)return;

      if (!packs.length){
        destroyChart();
        setKpis([]);
        tableSet([]);
        updatePills({station: code, years:`${y0}–${y1}`, data:"0 ano(s)"});
        setMsg("Sem dados no intervalo selecionado.", "err");
        return;
      }

      const yearsOk = packs.map(p=>p.year).sort((a,b)=>a-b);
      updatePills({station: code, years:`${yearsOk[0]}–${yearsOk[yearsOk.length-1]}`, data:`${yearsOk.length} ano(s)`});

      const vars = collectVarsFromPacks(packs);
      fillSelect(var1, vars, k=>labelOfVar(k), k=>k, true);
      fillSelect(var2, vars, k=>labelOfVar(k), k=>k, true);

      if (!var1.value) var1.value = vars.includes("tmean") ? "tmean" : vars[0];
      if (!var2.value) var2.value = vars.includes("p") ? "p" : vars[0];

      const V1 = var1.value;
      const V2 = var2.value;

      const PREC_KEYS = ["p","prec","prcp","ppt","precip","precipitacao"];
      let PKEY = null;
      outer:
      for (const p of packs){
        for (const r of (p.months||[])){
          for (const k of PREC_KEYS){
            if (k in r && Number.isFinite(safeNum(r[k]))) { PKEY=k; break outer; }
          }
        }
      }

      const hasTmin = vars.includes("tmin");
      const hasTmax = vars.includes("tmax");

      // CLIM
      if (mode==="clim"){
        heatLegend.style.display="none";

        const perMonth = Array.from({length:12}, (_,i)=>({ m:i+1, v:[], p:[] }));
        for (const p of packs){
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;

            const v = safeNum(r[V1]);
            if (Number.isFinite(v)) perMonth[m-1].v.push(v);

            if (PKEY){
              const pv = safeNum(r[PKEY]);
              if (Number.isFinite(pv)) perMonth[m-1].p.push(pv);
            }
          }
        }

        const rows = perMonth.map(o=>({
          mes: o.m,
          V1_mean: meanFinite(o.v),
          V1_min: minFinite(o.v),
          V1_max: maxFinite(o.v),
          n: o.v.filter(Number.isFinite).length,
          ...(PKEY ? { P_mean: meanFinite(o.p) } : {})
        }));

        const cols = ["mes","V1_mean","V1_min","V1_max","n"].concat(PKEY?["P_mean"]:[]);
        tableSet(rows, cols, 2);

        const labels = perMonth.map(o=>monthName(o.m));
        const ds = [];

        const showBars = !!(optPrecBars.checked && PKEY);
        if (showBars){
          ds.push({ type:"bar", label:"Precipitação média (mm)", data: rows.map(r=>Number.isFinite(r.P_mean)?r.P_mean:null), yAxisID:"yP", order:3 });
        }

        if (optMinMax.checked){
          ds.push({type:"line", label:`${labelOfVar(V1)} • mín`, data: rows.map(r=>r.V1_min), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25});
          ds.push({type:"line", label:`${labelOfVar(V1)} • máx`, data: rows.map(r=>r.V1_max), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25});
        }
        if (optMean.checked){
          ds.push({type:"line", label:`${labelOfVar(V1)} • média`, data: rows.map(r=>r.V1_mean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:.25});
        }

        renderChart({
          data:{ labels, datasets: ds },
          options:{
            responsive:true, maintainAspectRatio:false,
            interaction:{mode:"index", intersect:false},
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ grid:{color:"rgba(36,91,114,.10)"} },
              y:{ position:"left", title:{display:true, text:labelOfVar(V1)}, grid:{color:"rgba(36,91,114,.10)"} },
              yP:{ position:"right", display:showBars, title:{display:showBars, text:"Precipitação (mm)"}, grid:{drawOnChartArea:false} }
            }
          }
        });

        chartTitle.textContent = `Climograma (média mensal) — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length-1]} (ignorando meses nulos).`;

        setKpis([
          {k:"Anos úteis", v:String(yearsOk.length)},
          {k:"Média (12 meses)", v:fmt(meanFinite(rows.map(r=>r.V1_mean)),2)},
          {k:"Min (mês)", v:fmt(minFinite(rows.map(r=>r.V1_min)),2)},
          {k:"Max (mês)", v:fmt(maxFinite(rows.map(r=>r.V1_max)),2)},
        ]);

        lastCsvName = `climograma_${code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.csv`;
        lastPngName = `climograma_${code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // ANNUAL (igual ao seu, mantido)
      if (mode==="annual"){
        heatLegend.style.display="none";

        const rows = [];
        for (const p of packs){
          const vals = (p.months||[]).map(r=>safeNum(r[V1])).filter(Number.isFinite);
          if (!vals.length) continue;

          const row = {
            ano: p.year,
            V1_mean: meanFinite(vals),
            V1_min: minFinite(vals),
            V1_max: maxFinite(vals),
            n: vals.length
          };

          if (PKEY){
            const pv = (p.months||[]).map(r=>safeNum(r[PKEY])).filter(Number.isFinite);
            row.P_sum = pv.length ? sumFinite(pv) : NaN;
          }
          rows.push(row);
        }

        if (!rows.length){
          destroyChart(); setKpis([]); tableSet([]);
          setMsg("Sem dados suficientes para série anual.", "err");
          return;
        }

        const cols = ["ano","V1_mean","V1_min","V1_max","n"].concat(PKEY?["P_sum"]:[]);
        tableSet(rows, cols, 2);

        const labels = rows.map(r=>r.ano);
        const ds = [];

        if (optMinMax.checked){
          ds.push({type:"line", label:`${labelOfVar(V1)} • mín (ano)`, data: rows.map(r=>r.V1_min), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25});
          ds.push({type:"line", label:`${labelOfVar(V1)} • máx (ano)`, data: rows.map(r=>r.V1_max), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25});
        }
        if (optMean.checked){
          ds.push({type:"line", label:`${labelOfVar(V1)} • média (ano)`, data: rows.map(r=>r.V1_mean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:.25});
        }

        const showBars = !!(optPrecBars.checked && PKEY && rows.some(r=>Number.isFinite(r.P_sum)));
        if (showBars){
          ds.push({type:"bar", label:"Precipitação anual (mm)", data: rows.map(r=>Number.isFinite(r.P_sum)?r.P_sum:null), yAxisID:"yP", order:3});
        }

        renderChart({
          data:{labels, datasets:ds},
          options:{
            responsive:true, maintainAspectRatio:false,
            interaction:{mode:"index", intersect:false},
            plugins:{legend:{position:"top"}},
            scales:{
              x:{title:{display:true,text:"Ano"}, grid:{color:"rgba(36,91,114,.10)"}},
              y:{position:"left", title:{display:true, text:labelOfVar(V1)}, grid:{color:"rgba(36,91,114,.10)"}},
              yP:{position:"right", display:showBars, title:{display:showBars,text:"Precipitação (mm)"}, grid:{drawOnChartArea:false}},
            }
          }
        });

        chartTitle.textContent = `Série anual — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Anos usados: ${labels[0]}–${labels[labels.length-1]} (por months).`;

        setKpis([
          {k:"Anos úteis", v:String(rows.length)},
          {k:"Média (anos)", v:fmt(meanFinite(rows.map(r=>r.V1_mean)),2)},
          {k:"Min (ano)", v:fmt(minFinite(rows.map(r=>r.V1_min)),2)},
          {k:"Max (ano)", v:fmt(maxFinite(rows.map(r=>r.V1_max)),2)},
        ]);

        lastCsvName = `serie_anual_${code}_${V1}_${labels[0]}_${labels[labels.length-1]}.csv`;
        lastPngName = `serie_anual_${code}_${V1}_${labels[0]}_${labels[labels.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // HEATMAP ✅ agora SEM a legenda do chart por cima
      if (mode==="heatmap"){
        heatLegend.style.display="block";
        setHeatLegendGradient();

        const yearsAxis = yearsOk.slice().sort((a,b)=>a-b);

        const byYear = new Map();
        for (const y of yearsAxis) byYear.set(y, Array(12).fill(null));

        let vmin = Infinity, vmax = -Infinity;

        for (const p of packs){
          const arr = byYear.get(p.year);
          if (!arr) continue;
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;
            const v = safeNum(r[V1]);
            arr[m-1] = Number.isFinite(v) ? v : null;
            if (Number.isFinite(v)){
              vmin = Math.min(vmin, v);
              vmax = Math.max(vmax, v);
            }
          }
        }

        if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin===vmax){
          vmin = 0; vmax = 1;
        }
        const vmid = (vmin+vmax)/2;

        heatMinEl.textContent = `${labelOfVar(V1)} min: ${fmt(vmin,2)}`;
        heatMidEl.textContent = `médio: ${fmt(vmid,2)}`;
        heatMaxEl.textContent = `max: ${fmt(vmax,2)}`;

        const rows = [];
        for (const y of yearsAxis){
          const arr = byYear.get(y) || Array(12).fill(null);
          const vs = arr.filter(Number.isFinite);
          if (!vs.length) continue;

          const row = { ano: y };
          for (let i=0;i<12;i++){
            row[`m${String(i+1).padStart(2,"0")}`] = Number.isFinite(arr[i]) ? arr[i] : "";
          }
          row.mean = meanFinite(vs);
          row.min = minFinite(vs);
          row.max = maxFinite(vs);
          rows.push(row);
        }

        const cols = ["ano", ...Array.from({length:12},(_,i)=>`m${String(i+1).padStart(2,"0")}`), "mean","min","max"];
        tableSet(rows, cols, 2);

        const points = [];
        for (const y of yearsAxis){
          const arr = byYear.get(y) || Array(12).fill(null);
          for (let m=1;m<=12;m++){
            points.push({x:y, y:m, v: Number.isFinite(arr[m-1]) ? arr[m-1] : null});
          }
        }

        renderChart({
          type:"scatter",
          data:{
            datasets:[{
              // label não importa pq vamos esconder legend
              label: `Heatmap ${labelOfVar(V1)}`,
              data: points.map(p=>({x:p.x, y:p.y, v:p.v})),
              pointRadius: 12,
              pointHoverRadius: 14,
              pointStyle: "rectRounded",
              backgroundColor: (c)=>{
                const v = c.raw?.v;
                if (!Number.isFinite(v)) return "rgba(255,255,255,.12)";
                const t = (v - vmin) / (vmax - vmin);
                return heatColor(t);
              },
              borderColor: "rgba(36,91,114,.15)",
              borderWidth: 1
            }]
          },
          options:{
            responsive:true, maintainAspectRatio:false,
            plugins:{
              legend:{ display:false },  // ✅ some a legenda que tava em cima do heatmap
              tooltip:{
                callbacks:{
                  label: (ctx)=>{
                    const r=ctx.raw;
                    return `${r.x} • ${monthName(r.y)}: ${Number.isFinite(r.v)?fmt(r.v,2):"sem dado"}`;
                  }
                }
              }
            },
            scales:{
              x:{title:{display:true,text:"Ano"}, grid:{color:"rgba(36,91,114,.10)"}},
              y:{
                title:{display:true,text:"Mês"},
                min:1,max:12,
                ticks:{callback:(v)=>monthName(v), stepSize:1},
                grid:{color:"rgba(36,91,114,.10)"}
              }
            }
          }
        });

        chartTitle.textContent = `Mensal por ano (heatmap) — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Var: ${labelOfVar(V1)} • anos úteis: ${yearsAxis[0]}–${yearsAxis[yearsAxis.length-1]}`;

        setKpis([
          {k:"Anos úteis", v:String(rows.length)},
          {k:"Min", v:fmt(vmin,2)},
          {k:"Max", v:fmt(vmax,2)},
          {k:"Média", v:fmt(meanFinite(points.map(p=>p.v)),2)},
        ]);

        lastCsvName = `heatmap_${code}_${V1}_${yearsAxis[0]}_${yearsAxis[yearsAxis.length-1]}.csv`;
        lastPngName = `heatmap_${code}_${V1}_${yearsAxis[0]}_${yearsAxis[yearsAxis.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // REL (mantido como estava na sua versão)
      if (mode==="rel"){
        heatLegend.style.display="none";

        const pts = [];
        const xs = [];
        const ys = [];

        const colX = labelOfVar(V1);
        const colY = labelOfVar(V2);

        for (const p of packs){
          for (const r of (p.months||[])){
            const mes = Number(r.m);
            if (!(mes>=1 && mes<=12)) continue;

            const x = safeNum(r[V1]);
            const y = safeNum(r[V2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

            const row = { ano:p.year, mes, [colX]: x, [colY]: y };
            pts.push(row);
            xs.push(x); ys.push(y);
          }
        }

        if (pts.length < 10){
          destroyChart(); setKpis([]); tableSet([]);
          setMsg("Poucos pontos para relação.", "err");
          return;
        }

        const ds = [{
          type:"scatter",
          label: `${colX} × ${colY}`,
          data: pts.map(p=>({x:p[colX], y:p[colY]})),
          pointRadius: 3,
          pointHoverRadius: 5
        }];

        let r2 = NaN;
        const model = trendModel.value;

        if (showTrend.checked){
          const fit = trendFit(xs, ys, model);
          if (fit){
            r2 = fit.r2;
            const xmin = Math.min(...xs), xmax = Math.max(...xs);
            const line = [];
            const steps = 90;
            for (let i=0;i<=steps;i++){
              const x = xmin + (xmax-xmin)*(i/steps);
              const y = fit.predict(x);
              if (Number.isFinite(y)) line.push({x,y});
            }

            const labelModel =
              model==="linear" ? "Tendência linear" :
              model==="log" ? "Tendência logarítmica" :
              model==="exp" ? "Tendência exponencial" :
              model==="poly2" ? "Tendência polinomial (g2)" :
              model==="poly3" ? "Tendência polinomial (g3)" : "Tendência";

            ds.push({
              type:"line",
              label: `${labelModel}${showR2.checked && Number.isFinite(r2) ? ` (R²=${fmt(r2,3)})` : ""}`,
              data: line,
              borderWidth: 2,
              pointRadius: 0,
              tension: 0
            });
          }
        }

        const cols = ["ano","mes", colX, colY];
        tableSet(pts.slice(0,700), cols, 3);

        renderChart({
          data:{ datasets: ds },
          options:{
            responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:true, text:colX}, grid:{color:"rgba(36,91,114,.10)"} },
              y:{ title:{display:true, text:colY}, grid:{color:"rgba(36,91,114,.10)"} },
            }
          }
        });

        chartTitle.textContent = `Relação entre variáveis — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Pontos: ${pts.length} (meses válidos no intervalo).`;

        setKpis([
          {k:"Pontos", v:String(pts.length)},
          {k:"X min", v:fmt(minFinite(xs),2)},
          {k:"X max", v:fmt(maxFinite(xs),2)},
          {k:"R²", v:(showR2.checked && Number.isFinite(r2)) ? fmt(r2,3) : "—"},
        ]);

        lastCsvName = `relacao_${code}_${V1}_x_${V2}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.csv`;
        lastPngName = `relacao_${code}_${V1}_x_${V2}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

    } catch(e){
      console.error(e);
      setMsg(`Erro: ${e.message || e}`, "err");
    }
  }

  async function init(){
    try{
      setMsg("Iniciando...", "ok");
      setHeatLegendGradient();

      // Help modal events
      const openHelp = () => {
        helpOverlay.classList.add("open");
        helpOverlay.setAttribute("aria-hidden","false");
      };
      const closeHelp = () => {
        helpOverlay.classList.remove("open");
        helpOverlay.setAttribute("aria-hidden","true");
      };
      btnHelp?.addEventListener("click", openHelp);
      btnHelpClose?.addEventListener("click", closeHelp);
      helpOverlay?.addEventListener("click", (e)=>{
        if (e.target === helpOverlay) closeHelp();
      });
      window.addEventListener("keydown", (e)=>{
        if (e.key === "Escape") closeHelp();
      });

      const stUrl = new URL("stations.json", ASSETS).toString();
      const st = await fetchJson(stUrl);

      stations = Array.isArray(st) ? st : (st.stations || []);
      stations = stations.map(s=>({
        code: s.code || s.id || s.estacao || s.station || s.codigo,
        name: String(s.name || s.nome || s.station_name || s.estacao_nome || s.city || s.municipio || "—").replace(/^;+/,"").trim(),
        uf: String(s.uf || s.UF || s.estado || "—").replace(/^;+/,"").trim().toUpperCase(),
        years: [...new Set((Array.isArray(s.years)?s.years:[]).map(Number).filter(y=>Number.isInteger(y)&&y>=1800&&y<=new Date().getFullYear()))].sort((a,b)=>a-b),
        lat: Number(s.lat ?? s.latitude),
        lon: Number(s.lon ?? s.lng ?? s.longitude),
      })).filter(s=>!!s.code);

      inmetStations=stations.slice();
      const ufs = Array.from(new Set(stations.map(s=>s.uf))).sort();
      fillSelect(ufSelect, ["Todas", ...ufs], x=>x, x=>x, false);

      filteredStations = stations.slice();
      fillSelect(stationSelect, filteredStations, s=>`${s.code} · ${s.name} (${s.uf})`, s=>s.code, false);

      initMap();
      renderMarkers();

      if (filteredStations.length){
        stationSelect.value = filteredStations[0].code;
        selectStation(filteredStations[0].code, true);
      }

      for (const btn of document.querySelectorAll(".modeBtn")){
        btn.addEventListener("click", ()=>{
          setMode(btn.getAttribute("data-mode"));
        });
      }

      ufSelect.addEventListener("change", ()=>{
        if(isAna()){searchStation.value="";loadAnaCatalog();return;}
        applyFilters(false);
        renderMarkers();
      });

      searchStation.addEventListener("input", ()=>{
        applyFilters(false);
        renderMarkers();
      });

      searchStation.addEventListener("keydown", (ev)=>{
        if (ev.key==="Enter"){
          applyFilters(true);
          renderMarkers();
          ev.preventDefault();
        }
      });

      stationSelect.addEventListener("change", ()=>{
        selectStation(stationSelect.value, true);
      });

      btnRun.addEventListener("click", run);

      btnPng.addEventListener("click", ()=>{
        try{
          if (!chart){ setMsg("Nenhum gráfico para baixar.", "err"); return; }
          downloadPngSync(chart, lastPngName);
          setMsg("Download PNG iniciado.", "ok");
        } catch(e){
          console.error(e);
          setMsg(`Falha ao baixar PNG: ${e.message || e}`, "err");
        }
      });

      btnCsv.addEventListener("click", ()=>{
        try{
          if (!lastRows || !lastRows.length){ setMsg("Nenhuma tabela para baixar.", "err"); return; }
          const cols = [...tblHead.querySelectorAll("th")].map(th=>th.textContent);
          const csv = rowsToCsv(lastRows, cols);
          downloadTextCSV(lastCsvName, csv);
          setMsg("Download CSV iniciado.", "ok");
        } catch(e){
          console.error(e);
          setMsg(`Falha ao baixar CSV: ${e.message || e}`, "err");
        }
      });

      btnReset.addEventListener("click", ()=>{
        if(isAna()){searchStation.value="";setMode("clim");applyFilters(false);renderMarkers();return;}
        searchStation.value = "";
        ufSelect.value = "Todas";
        applyFilters(false);
        renderMarkers();
        setMode("clim");
        setMsg("Reset OK.", "ok");
      });

      setMode("clim");
      setMsg("Pronto.", "ok");

    } catch(e){
      console.error(e);
      setMsg(`Erro ao iniciar: ${e.message || e}`, "err");
    }
  }

  // ANA and INMET use the SAME filters, map, chart and table, never mixed.
  const sourceSelect=$('sourceSelect'),anaType=$('anaType'),anaConsistency=$('anaConsistency');
  const isAna=()=>sourceSelect.value==='ana'||sourceSelect.value==='ana_recent';
  const BRAZIL_UFS='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  let inmetStations=[],sourceEpoch=0,anaBusy=false,anaCancelled=false;
  function anaNotice(message){setMsg(message,'err');if(!lastRows.length){chartTitle.textContent='Consulta ANA sem resultado';chartMeta.textContent=message;}else chartMeta.textContent+=' · '+message;}
  function clearSourceView(){destroyChart();setKpis([]);tableSet([]);selectedStation=null;stationMeta.textContent='—';chartTitle.textContent='Selecione uma estação';chartMeta.textContent='';updatePills({});}
  async function activateSource(){
    const epoch=++sourceEpoch;stationSelectionVersion++;yearStart.dataset.anaSet='';if(!map)initMap();clearSourceView();searchStation.value='';
    $('anaMainControls').hidden=!isAna();
    $('anaConsistencyField').hidden=isRecent();$('yearsControls').hidden=isRecent();
    yearStart.disabled=isRecent();yearEnd.disabled=isRecent();anaConsistency.disabled=isRecent();
    const rain=anaType.querySelector('option[value="chuva"]');rain.disabled=isRecent();
    if(isRecent()&&anaType.value==='chuva')anaType.value='cotas';
    [optMinMax,optMean,optPrecBars].forEach(x=>x.disabled=isAna());
    document.querySelector('.map-source-pill').textContent=isRecent()?'ANA · Telemetria Brasil':isAna()?'ANA · Histórico Brasil':'INMET · Brasil';
    document.querySelectorAll('.modeBtn').forEach(b=>{b.disabled=isRecent()||(isAna()&&b.dataset.mode==='rel');});
    if(isAna()){
      if(mode==='rel')setMode('clim');
      fillSelect(ufSelect,BRAZIL_UFS,x=>x,x=>x,false);ufSelect.value='MT';stations=[];filteredStations=[];
      await loadAnaCatalog(epoch);
    }else{var1.disabled=false;setMode(mode);stations=inmetStations.slice();const ufs=[...new Set(stations.map(x=>x.uf))].sort();fillSelect(ufSelect,['Todas',...ufs],x=>x,x=>x,false);applyFilters(false);renderMarkers();setMsg('INMET: dados publicados de cada estação.','ok');}
  }
  async function loadAnaCatalog(epoch=++sourceEpoch){
    if(!isAna())return;const uf=ufSelect.value,type=anaType.value,previousCode=selectedStation?.code;
    const controls=[sourceSelect,ufSelect,anaType,stationSelect,searchStation,btnRun];controls.forEach(x=>x.disabled=true);
    stations=[];filteredStations=[];selectedStation=null;fillSelect(stationSelect,[],x=>x,x=>x,false);renderMarkers();
    setMsg(`Carregando inventário ANA de ${uf}...`,'ok');
    try{
      const raw=isRecent()?await new AnaRecentApi().inventory(uf):await new AnaPersistentApi().inventory(uf,type);if(epoch!==sourceEpoch||!isAna())return;
      stations=isRecent()?raw.map(x=>({...x,source:'ANA telemetria'})):raw.map(s=>({code:s.codigoestacao,name:s.Estacao_Nome,uf:s.UF_Estacao,lat:s.Latitude===null||String(s.Latitude).trim()===''?NaN:Number(s.Latitude),lon:s.Longitude===null||String(s.Longitude).trim()===''?NaN:Number(s.Longitude),start:s.Inicio,end:s.Fim,city:s.Municipio_Nome,source:'ANA'}));
      applyFilters(false);if(previousCode&&stations.some(x=>x.code===previousCode)){stationSelect.value=previousCode;selectStation(previousCode,false);}renderMarkers();setMsg(`ANA: ${stations.length} estações em ${uf}. Cadastro não garante série completa; busque sua estação e clique Gerar.`,'ok');
    }catch(e){setMsg(`Catálogo ANA: ${e.message}. A fonte pode estar temporariamente indisponível.`,'err');}
    finally{controls.forEach(x=>x.disabled=false);}
  }
  function selectAnaStation(code,zoom){
    selectedStation=stations.find(s=>s.code===code)||null;
    stationMeta.textContent=selectedStation?`${selectedStation.code} · ${selectedStation.name} · ${selectedStation.uf} · cadastro desde ${selectedStation.start||'data não informada'} · lat ${selectedStation.lat}, lon ${selectedStation.lon}. Postos com nomes semelhantes são séries diferentes.`:'—';
    const first=Number(String(selectedStation?.start||'').match(/\d{4}/)?.[0]);const nowYear=new Date().getFullYear();
    // Keep the user's comparison interval when changing variable/station; catalog periods are not a guarantee.
    const start=1850;
    const ys=Array.from({length:nowYear-start+1},(_,i)=>String(start+i));
    fillSelect(yearStart,ys,x=>x,x=>x,true);fillSelect(yearEnd,ys,x=>x,x=>x,true);
    if(!yearStart.value||+yearStart.value<start)yearStart.value=String(nowYear-1);
    if(!yearEnd.value||+yearEnd.value<start)yearEnd.value=String(nowYear-1);
    // For a newly selected ANA station use the latest complete calendar year, visibly preliminary.
    if(!yearStart.dataset.anaSet){yearStart.value=String(nowYear-1);yearEnd.value=String(nowYear-1);yearStart.dataset.anaSet='yes';}
    fillSelect(var1,[anaType.value],()=>ANAMain.specs[anaType.value].label,x=>x,false);var1.disabled=true;var2.disabled=true;
    if(isRecent()){yearStart.disabled=true;yearEnd.disabled=true;}
    updatePills({station:code,years:`${yearStart.value}–${yearEnd.value}`,data:'ANA · consulta sob demanda'});
    if(selectedStation&&map&&Number.isFinite(selectedStation.lat)&&Number.isFinite(selectedStation.lon))map.setView([selectedStation.lat,selectedStation.lon],7);
  }
  async function runAna(){
    if(isRecent())return runRecent();
    if(anaBusy)return;if(!selectedStation)return setMsg('Selecione uma estação ANA.','err');
    const y0=Number(yearStart.value),y1=Number(yearEnd.value),type=anaType.value,level=anaConsistency.value,station={...selectedStation},selectedMode=mode;
    if(!yearStart.value||!yearEnd.value||y0>y1||y0<1850||y1>new Date().getFullYear())return anaNotice('Escolha um intervalo entre 1850 e o ano atual, com início anterior ao fim.');
    const previousTitle=chartTitle.textContent,previousMeta=chartMeta.textContent;let renderedNew=false;
    const controls=[sourceSelect,ufSelect,anaType,anaConsistency,stationSelect,searchStation,yearStart,yearEnd,btnRun,btnReset,...document.querySelectorAll('.modeBtn')];controls.forEach(x=>x.disabled=true);anaBusy=true;
    anaCancelled=false;$('cancelAna').disabled=false;$('cancelAna').hidden=false;chartTitle.textContent=`Consultando ANA · ${station.code} · ${station.name}`;chartMeta.textContent='Consulta oficial com limite de90segundos por requisição e8MB de resposta; você pode cancelar.';setMsg('Consultando série oficial ANA...','ok');
    try{
      const points=await new AnaPersistentApi().series({type,station:station.code,start:`${y0}-01-01`,end:`${y1}-12-31`,consistency:level,isCancelled:()=>anaCancelled,onProgress:({year,completed,total})=>{chartMeta.textContent=`API ANA: ${completed}/${total} etapas · período ${year}. Aguarde a resposta oficial.`;}});
      if(!points.length){anaNotice(`ANA: nenhuma observação real para ${y0}–${y1} no nível ${level}. ${level==='2'?'Pode haver dados brutos: selecione nível 1 explicitamente.':'Este posto não retornou dados neste recorte. Postos homônimos têm códigos e séries próprios; selecione outra estação ou período.'}`);return;}
      const a=ANAMain.aggregate(points,type,y0,y1),unit=a.spec.unit;const observed=a.years.filter(x=>x.dias),last=observed.at(-1);
      setKpis([{k:`${last.ano} · ${type==='chuva'?'total observado':'média observada'}`,v:`${fmt(last.valor)} ${unit}`},{k:`Cobertura ${last.ano}`,v:`${fmt(last.cobertura*100,1)}%`},{k:'Dias reais',v:String(points.length)},{k:'Última medição',v:a.lastDate}]);
      heatLegend.style.display='none';let rows,labels,datasets,options={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{title:{display:true,text:unit}}}};
      if(selectedMode==='clim'){
        rows=a.months.filter(x=>x.dias).map(x=>({ano:x.ano,mes:x.mes,observado:x.observado,dias:x.dias,cobertura_pct:x.cobertura*100,situacao:x.completo?'completo':'parcial: excluído da média mensal'}));
        labels=a.climatology.map(x=>monthName(x.mes));datasets=[{type:type==='chuva'?'bar':'line',label:`Média por mês (${unit}), somente meses completos`,data:a.climatology.map(x=>x.valor),borderWidth:2,pointRadius:3}];
      }else if(selectedMode==='annual'){
        rows=observed.map(x=>({ano:x.ano,valor_observado:x.valor,dias:x.dias,cobertura_pct:x.cobertura*100,situacao:x.completo?'completo':'parcial: não comparar como ano completo'}));
        labels=observed.map(x=>x.ano);datasets=[{type:type==='chuva'?'bar':'line',label:`${type==='chuva'?'Total':'Média'} observado (${unit}); ver cobertura`,data:observed.map(x=>x.valor),borderWidth:2,pointRadius:3,backgroundColor:observed.map(x=>x.completo?'#168b91':'#b9d6da')}];
      }else{
        rows=a.months.filter(x=>x.dias).map(x=>({ano:x.ano,mes:x.mes,observado:x.observado,dias:x.dias,cobertura_pct:x.cobertura*100,situacao:x.completo?'completo':'parcial: célula sem valor'}));
        const vals=a.months.map(x=>x.valor).filter(Number.isFinite),min=vals.length?Math.min(...vals):0,max=vals.length?Math.max(...vals):1;
        datasets=[{type:'scatter',label:`Mensal (${unit}), somente meses completos`,data:a.months.map(x=>({x:x.ano,y:x.mes,v:x.valor})),pointStyle:'rectRounded',pointRadius:10,backgroundColor:c=>Number.isFinite(c.raw?.v)?heatColor((c.raw.v-min)/(max-min||1)):'#ddd'}];
        options={...options,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.x} ${monthName(c.raw.y)}: ${Number.isFinite(c.raw.v)?fmt(c.raw.v)+' '+unit:'mês incompleto/sem dado'}`}}},scales:{x:{type:'linear',min:y0-.5,max:y1+.5,ticks:{stepSize:1,callback:v=>Number.isInteger(v)?String(v):''},title:{display:true,text:'Ano'}},y:{min:1,max:12,ticks:{stepSize:1,callback:monthName}}}};
      }
      renderChart({data:{labels,datasets},options});tableSet(rows,null,2);renderedNew=true;
      chartTitle.textContent=`${selectedMode==='clim'?'Climograma mensal':selectedMode==='annual'?'Série anual':'Mapa mensal'} — ${a.spec.label} · ${stationLabel(station)}`;
      chartMeta.textContent=`ANA pública · ${level==='1'?'BRUTO/PRELIMINAR':'CONSISTIDO'} · ${y0}–${y1} · última observação ${a.lastDate} · ${points.persistence?.snapshots?"acervo automático: "+points.persistence.snapshots+" ano(s)":"consulta direta"}${points.persistence?.stale?' · CACHE PRESERVADO: última consulta falhou ou não confirmou dados; confira a data da medição':''}${points.failedYears?.length?' · FALHA DE CONSULTA nos anos '+points.failedYears.join(', ')+': resultado incompleto':''} · última coleta não equivale à última medição`;
      updatePills({station:station.code,years:`${y0}–${y1}`,data:`ANA · nível${level} · ${points.length} dias`});
      lastCsvName=`ANA_${type}_${station.code}_${y0}_${y1}_nivel${level}.csv`;lastPngName=lastCsvName.replace('.csv','.png');
      setMsg(`ANA: ${points.length} dias reais. Valores parciais identificados; meses incompletos não entram na média/heatmap. Sem mistura com INMET.`,'ok');
    }catch(e){anaNotice(`ANA: ${e.message}. Resultado anterior, se existente, preservado.`);}
    finally{if(!renderedNew&&lastRows.length){const notice=chartMeta.textContent;chartTitle.textContent=previousTitle;chartMeta.textContent=previousMeta+' · Resultado anterior preservado. '+notice;}$('cancelAna').hidden=true;anaBusy=false;controls.forEach(x=>x.disabled=false);document.querySelector('.modeBtn[data-mode="rel"]').disabled=true;var1.disabled=true;var2.disabled=true;}
  }

  const isRecent=()=>sourceSelect.value==='ana_recent';
  async function runRecent(){
    if(anaBusy||!selectedStation)return;
    const station={...selectedStation},type=anaType.value==='vazao'?'vazao':'cotas',field=type==='vazao'?'flow_m3_s':'level_cm',unit=type==='vazao'?'m³/s':'cm';
    const controls=[sourceSelect,ufSelect,anaType,anaConsistency,stationSelect,searchStation,yearStart,yearEnd,btnRun,btnReset,...document.querySelectorAll('.modeBtn')];controls.forEach(x=>x.disabled=true);anaBusy=true;
    setMsg('Consultando telemetria recente da ANA; sem misturar com a série histórica.','ok');
    try{
      const response=await new AnaRecentApi().series(station.code);const records=response.records||[];
      const valid=records.filter(x=>Number.isFinite(x[field]));
      if(!valid.length){setMsg(`Sem leitura recente de ${type==='vazao'?'vazão':'nível'} para esta estação no período consultado. Estação catalogada não garante leitura disponível.`,'err');return;}
      const last=valid.at(-1);heatLegend.style.display='none';
      renderChart({data:{labels:valid.map(x=>x.datetime_raw),datasets:[{type:'line',label:`${type==='vazao'?'Vazão':'Nível'} informado (${unit}) · telemetria preliminar`,data:valid.map(x=>x[field]),borderWidth:2,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{x:{ticks:{maxTicksLimit:6},title:{display:true,text:'Horário publicado pela fonte (fuso não declarado)'}},y:{title:{display:true,text:unit}}}}});
      tableSet(records.map(x=>({horario_publicado:x.datetime_raw,nivel_cm:x.level_cm,vazao_m3_s:x.flow_m3_s})),null,2);
      setKpis([{k:'Último valor informado',v:`${fmt(last[field])} ${unit}`},{k:'Horário da medição',v:last.datetime_raw},{k:'Leituras válidas',v:String(valid.length)},{k:'Origem',v:response.transport||'ANA pública'}]);
      chartTitle.textContent=`Telemetria recente — ${stationLabel(station)}`;
      chartMeta.textContent=`Fonte ANA telemétrica separada do histórico convencional · horário original, sem conversão de fuso · sem QC validado${response.stale?' · CACHE ANTIGO: fonte indisponível':''}`;
      updatePills({station:station.code,years:'Telemetria recente',data:`${valid.length} leituras · ${response.stale?'cache antigo':'verificado'}`});
      lastCsvName=`ANA_telemetria_${station.code}.csv`;lastPngName=lastCsvName.replace('.csv','.png');
      setMsg('Leituras recentes informadas pela ANA. Nível é cota na referência da estação, não profundidade. Chuva telemétrica não é somada nem inserida nos climogramas.','ok');
    }catch(e){setMsg(`Telemetria: ${e.message}. Gráfico anterior preservado.`,'err');}
    finally{anaBusy=false;controls.forEach(x=>x.disabled=false);document.querySelectorAll('.modeBtn').forEach(x=>x.disabled=true);yearStart.disabled=true;yearEnd.disabled=true;anaConsistency.disabled=true;var1.disabled=true;var2.disabled=true;}
  }

  window.addEventListener('climogramas-data-updated',async()=>{
    if(document.visibilityState!=='visible'||anaBusy||!selectedStation||!lastRows.length)return;
    if(chartLoading)return;
    if(isAna())run();else{
      const epoch=sourceEpoch,selectionVersion=stationSelectionVersion,code=selectedStation.code,uf=ufSelect.value;
      try{
        const raw=await fetchJson(new URL('stations.json',ASSETS).toString());
        if(epoch!==sourceEpoch||isAna()||selectionVersion!==stationSelectionVersion)return;
        const list=Array.isArray(raw)?raw:(raw.stations||[]);
        inmetStations=list.map(s=>({code:s.code||s.id,name:String(s.name||s.nome||'—').replace(/^;+/, '').trim(),uf:String(s.uf||s.UF||'—').trim().toUpperCase(),years:(s.years||[]).map(Number).filter(Number.isInteger).sort((a,b)=>a-b),lat:Number(s.lat??s.latitude),lon:Number(s.lon??s.longitude)})).filter(s=>s.code);
        stations=inmetStations.slice();fillSelect(ufSelect,['Todas',...[...new Set(stations.map(s=>s.uf))].sort()],x=>x,x=>x,false);ufSelect.value=uf;
        const q=searchStation.value.trim().toLowerCase();filteredStations=stations.filter(s=>(uf==='Todas'||s.uf===uf)&&(!q||`${s.code} ${s.name}`.toLowerCase().includes(q)));
        fillSelect(stationSelect,filteredStations,s=>`${s.code} · ${s.name} (${s.uf})`,s=>s.code,false);
        const refreshed=filteredStations.find(s=>s.code===code);if(!refreshed){setMsg('Catálogo atualizado; estação anterior não está nesta seleção. Escolha uma estação.','err');return;}
        stationSelect.value=code;selectedStation=refreshed;stationSelectionVersion++;
        const years=refreshed.years.map(String);fillSelect(yearStart,years,x=>x,x=>x,true);fillSelect(yearEnd,years,x=>x,x=>x,true);
        renderMarkers();packCache.clear();existsCache.clear();run();
      }catch{setMsg('Atualização do catálogo INMET indisponível; resultado anterior preservado.','err');}
    }
  });

  $('cancelAna').addEventListener('click',()=>{anaCancelled=true;$('cancelAna').disabled=true;chartMeta.textContent='Cancelando após a requisição atual; nenhuma nova consulta será iniciada.';});

  sourceSelect.addEventListener("change",activateSource);
  anaType.addEventListener("change",()=>{searchStation.value="";loadAnaCatalog();});
  sourceSelect.disabled=true;init().finally(()=>{sourceSelect.disabled=false;});
})();


