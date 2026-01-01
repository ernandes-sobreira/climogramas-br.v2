(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const BASE = new URL(".", location.href).toString();
  const ASSETS = new URL("assets/", BASE).toString();

  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const monthName = (m) => monthNames[(m-1)] || String(m);

  const fmt = (v, d=2) => Number.isFinite(v) ? v.toFixed(d) : "—";

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

  const safeNum = (v) => (v===null || v===undefined) ? NaN : (typeof v==="number" ? v : Number(v));
  const isObj = (x) => x && typeof x === "object";

  function setMsg(text, kind="ok"){
    const box = $("msgBox");
    box.textContent = text;
    box.style.borderColor = (kind==="err") ? "rgba(251,113,133,.35)" : "rgba(255,255,255,.08)";
    box.style.background = (kind==="err") ? "rgba(251,113,133,.10)" : "rgba(7,11,22,.35)";
    box.style.color = (kind==="err") ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.70)";
  }

  function downloadBlob(filename, blob){
    // tenta o mais compatível
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
    downloadBlob(filename, blob);
  }

  function downloadPngFromChart(chart, filename){
    // robusto: pega do canvas (não do helper do Chart)
    const canvas = chart?.canvas;
    if (!canvas) throw new Error("Canvas do gráfico não encontrado.");
    // força update sem animação antes de capturar
    chart.update("none");
    canvas.toBlob((blob)=>{
      if (!blob) throw new Error("Falha ao gerar PNG (toBlob retornou null).");
      downloadBlob(filename, blob);
    }, "image/png");
  }

  // ---------- UI refs ----------
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

  const btnClim = $("btnClim");
  const btnAnnual = $("btnAnnual");
  const btnHeatmap = $("btnHeatmap");
  const btnRel = $("btnRel");

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

  // ---------- state ----------
  let stations = [];
  let filteredStations = [];
  let selectedStation = null;

  let mode = "clim";
  let chart = null;
  let lastRows = [];
  let lastCsvName = "tabela.csv";
  let lastPngName = "grafico.png";

  const packCache = new Map();
  const existsCache = new Map();

  let map = null;
  let markersLayer = null;

  // ---------- variable labels ----------
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

  // ---------- UI helpers ----------
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

    heatLegend.style.display = (mode === "heatmap") ? "block" : "none";
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

  function setTable(rows){
    lastRows = rows || [];
    tblHead.innerHTML = "";
    tblBody.innerHTML = "";

    if (!rows || !rows.length){
      tableMeta.textContent = "Sem linhas para exibir.";
      return;
    }

    const cols = Object.keys(rows[0]);
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
        td.textContent = (typeof v==="number" && Number.isFinite(v)) ? v : (v ?? "");
        tr.appendChild(td);
      }
      tblBody.appendChild(tr);
    }
  }

  function rowsToCsv(rows){
    if (!rows || !rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (s) => {
      const t = String(s ?? "");
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

  function updatePills(info){
    pillStation.textContent = `Estação: ${info.station ?? "—"}`;
    pillYears.textContent = `Anos: ${info.years ?? "—"}`;
    pillData.textContent = `Dados: ${info.data ?? "—"}`;
  }

  function stationLabel(s){
    if (!s) return "—";
    return `${s.code} · ${s.name} (${s.uf})`;
  }

  // ---------- data loading ----------
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
    if (!Array.isArray(obj.months)) obj.months = [];
    obj.year = year;
    obj.station = obj.station || code;
    packCache.set(key, obj);
    return obj;
  }

  async function loadPacksForRange(code, y0, y1){
    const packs = [];
    for (let y=y0; y<=y1; y++){
      try{
        const ok = await yearExists(code, y);
        if (!ok) continue;
        packs.push(await loadPack(code, y));
      }catch(e){
        // ignora
      }
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

  // ---------- chart ----------
  function destroyChart(){
    if (chart){ chart.destroy(); chart = null; }
  }
  function ensureChart(){
    const canvas = $("mainChart");
    if (!canvas) throw new Error("Canvas mainChart não encontrado.");
    return canvas.getContext("2d");
  }
  function renderChart(config){
    destroyChart();
    const ctx = ensureChart();
    chart = new Chart(ctx, config);
  }

  // ---------- MAP ----------
  function initMap(){
    map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([-14.2, -55.0], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function renderMarkers(){
    if (!map || !markersLayer) return;
    markersLayer.clearLayers();
    for (const s of filteredStations){
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const mk = L.circleMarker([s.lat, s.lon], { radius: 5, weight: 1, opacity: .9, fillOpacity: .65 });
      mk.bindTooltip(`${s.code} · ${s.name} (${s.uf})`, {sticky:true});
      mk.on("click", ()=>{
        stationSelect.value = s.code;
        selectStation(s.code, true);
        setMsg(`Selecionado: ${s.code}`, "ok");
      });
      mk.addTo(markersLayer);
    }
  }

  function selectStation(code, zoomMap=true){
    selectedStation = stations.find(s=>s.code===code) || null;
    stationMeta.textContent = selectedStation
      ? `${selectedStation.city || selectedStation.name} · ${selectedStation.uf} · lat ${selectedStation.lat} lon ${selectedStation.lon}`
      : "—";
    updatePills({station: selectedStation ? selectedStation.code : "—", years:"—", data:"—"});

    const years = [];
    for (let y=2000; y<=2024; y++) years.push(String(y));
    fillSelect(yearStart, years, y=>y, y=>y, true);
    fillSelect(yearEnd, years, y=>y, y=>y, true);

    if (zoomMap && selectedStation && map && Number.isFinite(selectedStation.lat) && Number.isFinite(selectedStation.lon)){
      map.setView([selectedStation.lat, selectedStation.lon], 7, {animate:true});
    }
  }

  function applyFilters(zoomIfSingle=false){
    const uf = ufSelect.value;
    const q = (searchStation.value || "").trim().toLowerCase();

    filteredStations = stations.filter(s=>{
      const okUf = (uf==="Todas") || (s.uf===uf);
      const hay = `${s.code} ${s.name} ${s.city||""}`.toLowerCase();
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
      stationMeta.textContent = "—";
      updatePills({station:"—", years:"—", data:"—"});
      return;
    }

    // se sobrou 1, seleciona + zoom automaticamente (quando pedido)
    if (zoomIfSingle && filteredStations.length === 1){
      const code = filteredStations[0].code;
      stationSelect.value = code;
      selectStation(code, true);
      return;
    }

    const code = stationSelect.value || filteredStations[0].code;
    stationSelect.value = code;
    selectStation(code, false);
  }

  // ---------- Trend models ----------
  function linReg(xs, ys){
    const n = xs.length;
    const xbar = xs.reduce((a,b)=>a+b,0)/n;
    const ybar = ys.reduce((a,b)=>a+b,0)/n;
    let ssxx=0, ssxy=0, ssyy=0;
    for (let i=0;i<n;i++){
      const dx = xs[i]-xbar;
      const dy = ys[i]-ybar;
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
      let p = 1;
      for (let k=0;k<=2*deg;k++){
        S[k] += p;
        p *= xs[i];
      }
    }

    const A = Array.from({length:m}, ()=>Array(m).fill(0));
    const B = Array(m).fill(0);

    for (let r=0;r<m;r++){
      for (let c=0;c<m;c++){
        A[r][c] = S[r+c];
      }
    }
    for (let r=0;r<m;r++){
      let sum = 0;
      for (let i=0;i<n;i++){
        sum += ys[i] * (xs[i]**r);
      }
      B[r] = sum;
    }

    const M = A.map((row,i)=>row.concat([B[i]]));

    for (let i=0;i<m;i++){
      let piv = i;
      for (let r=i+1;r<m;r++){
        if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      }
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      [M[i], M[piv]] = [M[piv], M[i]];

      const div = M[i][i];
      for (let c=i;c<=m;c++) M[i][c] /= div;

      for (let r=0;r<m;r++){
        if (r===i) continue;
        const f = M[r][i];
        for (let c=i;c<=m;c++) M[r][c] -= f*M[i][c];
      }
    }

    const coef = M.map(row=>row[m]);
    const predict = (x)=>{
      let y = 0, p=1;
      for (let k=0;k<coef.length;k++){
        y += coef[k]*p;
        p *= x;
      }
      return y;
    };

    const ybar = ys.reduce((a,b)=>a+b,0)/n;
    let ssyy=0, ssres=0;
    for (let i=0;i<n;i++){
      const yhat = predict(xs[i]);
      ssyy += (ys[i]-ybar)**2;
      ssres += (ys[i]-yhat)**2;
    }
    const r2 = 1 - (ssres/ssyy);

    return {r2, predict};
  }

  function trendFit(xs, ys, model){
    if (model === "linear"){
      return linReg(xs, ys);
    }
    if (model === "log"){
      // y = a + b ln(x) (x>0)
      const X=[], Y=[];
      for (let i=0;i<xs.length;i++){
        if (xs[i] > 0 && Number.isFinite(xs[i]) && Number.isFinite(ys[i])){
          X.push(Math.log(xs[i]));
          Y.push(ys[i]);
        }
      }
      if (X.length < 8) return null;
      const reg = linReg(X, Y);
      return { r2: reg.r2, predict: (x)=> x>0 ? reg.predict(Math.log(x)) : NaN };
    }
    if (model === "exp"){
      // y = a * exp(bx)  => ln(y)=ln(a)+b x  (y>0)
      const X=[], Ylog=[];
      for (let i=0;i<xs.length;i++){
        if (ys[i] > 0 && Number.isFinite(xs[i]) && Number.isFinite(ys[i])){
          X.push(xs[i]);
          Ylog.push(Math.log(ys[i]));
        }
      }
      if (X.length < 8) return null;
      const reg = linReg(X, Ylog);
      const a = Math.exp(Math.log(1) + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0); // só pra evitar linter chato
      // ^ ignora, vamos usar a forma certa abaixo:
      const reg2 = linReg(X, Ylog);
      const A = Math.exp((() => {
        // reg2.predict(0) = ln(a)
        // mas a forma exata é usar intercepto interno da regressão
        // então recomputa intercepto via predict(0) pois reg2 é a+b*x com x=0.
        // (predict(0) já é o intercepto)
        return reg2.predict(0);
      })());
      const B = (()=>{
        // slope estimado: delta predict
        // mas como linReg não expõe b, extraímos por duas predições:
        const p0 = reg2.predict(0);
        const p1 = reg2.predict(1);
        return p1 - p0;
      })();

      const predict = (x)=>A * Math.exp(B*x);

      // R² no espaço original
      const n = ys.length;
      const ybar = ys.reduce((aa,bb)=>aa+bb,0)/n;
      let ssyy=0, ssres=0;
      for (let i=0;i<ys.length;i++){
        const yhat = predict(xs[i]);
        ssyy += (ys[i]-ybar)**2;
        ssres += (ys[i]-yhat)**2;
      }
      const r2 = 1 - (ssres/ssyy);

      return { r2, predict };
    }
    if (model === "poly2"){
      return polyFit(xs, ys, 2);
    }
    if (model === "poly3"){
      return polyFit(xs, ys, 3);
    }
    return null;
  }

  // ---------- Heatmap color ----------
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
    let a = stops[0], b = stops[stops.length-1];
    for (let i=0;i<stops.length-1;i++){
      if (t>=stops[i][0] && t<=stops[i+1][0]){ a=stops[i]; b=stops[i+1]; break; }
    }
    const tt = (t - a[0]) / (b[0]-a[0] || 1);
    const c = [
      Math.round(a[1][0] + (b[1][0]-a[1][0])*tt),
      Math.round(a[1][1] + (b[1][1]-a[1][1])*tt),
      Math.round(a[1][2] + (b[1][2]-a[1][2])*tt),
    ];
    return `rgba(${c[0]},${c[1]},${c[2]},0.95)`;
  }

  // ---------- run ----------
  async function run(){
    try{
      if (!selectedStation){
        setMsg("Selecione uma estação.", "err");
        return;
      }

      const code = selectedStation.code;
      let y0 = Number(yearStart.value);
      let y1 = Number(yearEnd.value);
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) { y0=2000; y1=2024; }
      if (y0>y1) [y0,y1] = [y1,y0];

      setMsg("Carregando dados...", "ok");

      const packs = await loadPacksForRange(code, y0, y1);
      if (!packs.length){
        setTable([]);
        destroyChart();
        setKpis([]);
        updatePills({station: code, years:`${y0}–${y1}`, data:`0 ano(s)`});
        setMsg("Sem dados no intervalo selecionado (anos ausentes ou JSON vazio).", "err");
        return;
      }

      const yearsOk = packs.map(p=>p.year).sort((a,b)=>a-b);
      updatePills({
        station: code,
        years: `${yearsOk[0]}–${yearsOk[yearsOk.length-1]}`,
        data: `${yearsOk.length} ano(s)`
      });

      // não mexe no trendModel nem nos checks
      const vars = collectVarsFromPacks(packs);
      if (!vars.length){
        setMsg("Dados sem variáveis reconhecíveis.", "err");
        return;
      }
      fillSelect(var1, vars, k=>labelOfVar(k), k=>k, true);
      fillSelect(var2, vars, k=>labelOfVar(k), k=>k, true);

      if (!var1.value) var1.value = vars.includes("tmean") ? "tmean" : vars[0];
      if (!var2.value) var2.value = vars.includes("p") ? "p" : vars[0];

      const V1 = var1.value;
      const V2 = var2.value;

      // detect precip key once
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

      // temp min/max keys if exist
      const hasTmin = vars.includes("tmin");
      const hasTmax = vars.includes("tmax");
      const TMIN = hasTmin ? "tmin" : null;
      const TMAX = hasTmax ? "tmax" : null;

      // ---------- MODO clim ----------
      if (mode === "clim"){
        heatLegend.style.display = "none";

        const perMonth = Array.from({length:12}, (_,i)=>({m:i+1, vals:[], pvals:[]}));
        for (const p of packs){
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;
            const v = safeNum(r[V1]);
            if (Number.isFinite(v)) perMonth[m-1].vals.push(v);

            if (PKEY){
              const pv = safeNum(r[PKEY]);
              if (Number.isFinite(pv)) perMonth[m-1].pvals.push(pv);
            }
          }
        }

        const rows = perMonth.map(o=>{
          const mean = meanFinite(o.vals);
          const mn = minFinite(o.vals);
          const mx = maxFinite(o.vals);
          return { mes: o.m, mean, min: mn, max: mx, n: o.vals.filter(Number.isFinite).length };
        });
        setTable(rows);

        const labels = perMonth.map(o=>monthName(o.m));
        const ds = [];

        const showBars = !!(optPrecBars.checked && PKEY);
        if (showBars){
          const pmean = perMonth.map(o=>meanFinite(o.pvals));
          ds.push({
            type:"bar",
            label: "Precipitação média (mm)",
            data: pmean.map(v=>Number.isFinite(v)?v:null),
            yAxisID:"yP",
            order: 3
          });
        }

        if (optMinMax.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • mín`, data: rows.map(r=>Number.isFinite(r.min)?r.min:null), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
          ds.push({ type:"line", label:`${labelOfVar(V1)} • máx`, data: rows.map(r=>Number.isFinite(r.max)?r.max:null), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
        }
        if (optMean.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • média`, data: rows.map(r=>Number.isFinite(r.mean)?r.mean:null), yAxisID:"y", borderWidth:3, pointRadius:3, tension:.25 });
        }

        renderChart({
          data:{ labels, datasets: ds },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            interaction:{mode:"index", intersect:false},
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ grid:{color:"rgba(255,255,255,.06)"} },
              y:{ position:"left", title:{display:true, text: labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
              yP:{ position:"right", display:showBars, title:{display:showBars, text:"Precipitação (mm)"}, grid:{drawOnChartArea:false} }
            }
          }
        });

        chartTitle.textContent = `Climograma (média mensal) — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length-1]} (ignorando meses nulos).`;

        setKpis([
          {k:"Anos úteis", v:String(yearsOk.length)},
          {k:"Média (12 meses)", v:fmt(meanFinite(rows.map(r=>r.mean)),2)},
          {k:"Min (mês)", v:fmt(minFinite(rows.map(r=>r.min)),2)},
          {k:"Max (mês)", v:fmt(maxFinite(rows.map(r=>r.max)),2)},
        ]);

        lastCsvName = `climograma_${code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.csv`;
        lastPngName = `climograma_${code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // ---------- MODO annual ----------
      if (mode === "annual"){
        heatLegend.style.display = "none";

        const rows = [];
        for (const p of packs){
          const vals = (p.months||[]).map(r=>safeNum(r[V1])).filter(Number.isFinite);
          if (!vals.length) continue;
          rows.push({ ano: p.year, mean: meanFinite(vals), min: minFinite(vals), max: maxFinite(vals), n: vals.length });
        }

        if (!rows.length){
          setTable([]);
          destroyChart();
          setKpis([]);
          setMsg("Sem dados suficientes para série anual (variável ausente).", "err");
          return;
        }

        setTable(rows);

        let annualPrec = null;
        if (PKEY){
          annualPrec = rows.map(r=>{
            const pack = packs.find(pp=>pp.year===r.ano);
            if (!pack) return null;
            const pv = (pack.months||[]).map(mm=>safeNum(mm[PKEY])).filter(Number.isFinite);
            return pv.length ? sumFinite(pv) : null;
          });
        }

        const labels = rows.map(r=>r.ano);
        const ds = [];

        if (optMinMax.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • mín (ano)`, data: rows.map(r=>r.min), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
          ds.push({ type:"line", label:`${labelOfVar(V1)} • máx (ano)`, data: rows.map(r=>r.max), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
        }
        if (optMean.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • média (ano)`, data: rows.map(r=>r.mean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:.25 });
        }

        const showBars = !!(optPrecBars.checked && annualPrec && annualPrec.some(Number.isFinite));
        if (showBars){
          ds.push({ type:"bar", label:"Precipitação anual (mm)", data: annualPrec, yAxisID:"yP", order:3 });
        }

        renderChart({
          data:{ labels, datasets: ds },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            interaction:{mode:"index", intersect:false},
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:true, text:"Ano"}, grid:{color:"rgba(255,255,255,.06)"} },
              y:{ position:"left", title:{display:true, text:labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
              yP:{ position:"right", display:showBars, title:{display:showBars, text:"Precipitação (mm)"}, grid:{drawOnChartArea:false} },
            }
          }
        });

        chartTitle.textContent = `Série anual — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Anos usados: ${labels[0]}–${labels[labels.length-1]} (por months).`;

        setKpis([
          {k:"Anos úteis", v:String(rows.length)},
          {k:"Média (anos)", v:fmt(meanFinite(rows.map(r=>r.mean)),2)},
          {k:"Min (ano)", v:fmt(minFinite(rows.map(r=>r.min)),2)},
          {k:"Max (ano)", v:fmt(maxFinite(rows.map(r=>r.max)),2)},
        ]);

        lastCsvName = `serie_anual_${code}_${V1}_${labels[0]}_${labels[labels.length-1]}.csv`;
        lastPngName = `serie_anual_${code}_${V1}_${labels[0]}_${labels[labels.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // ---------- MODO heatmap ----------
      if (mode === "heatmap"){
        heatLegend.style.display = "block";

        const yearsAxis = yearsOk.slice().sort((a,b)=>a-b);

        const points = [];
        let vmin = Infinity, vmax = -Infinity;

        for (const p of packs){
          const y = p.year;
          const byM = new Map();
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;
            const v = safeNum(r[V1]);
            byM.set(m, Number.isFinite(v)?v:null);
          }
          for (let m=1;m<=12;m++){
            const v = byM.has(m) ? byM.get(m) : null;
            if (Number.isFinite(v)){
              vmin = Math.min(vmin, v);
              vmax = Math.max(vmax, v);
            }
            points.push({x:y, y:m, v});
          }
        }

        if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin===vmax){
          vmin = 0; vmax = 1;
        }

        const vmid = (vmin+vmax)/2;
        heatMinEl.textContent = `${labelOfVar(V1)} min: ${fmt(vmin,2)}`;
        heatMidEl.textContent = `médio: ${fmt(vmid,2)}`;
        heatMaxEl.textContent = `max: ${fmt(vmax,2)}`;

        const rows = yearsAxis.map(y=>{
          const vs = points.filter(p=>p.x===y).map(p=>p.v).filter(Number.isFinite);
          return { ano:y, mean: meanFinite(vs), min: minFinite(vs), max: maxFinite(vs), n: vs.length };
        }).filter(r=>r.n>0);

        setTable(rows);

        renderChart({
          type:"scatter",
          data:{
            datasets:[{
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
              borderColor: "rgba(255,255,255,.08)",
              borderWidth: 1
            }]
          },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            plugins:{
              tooltip:{
                callbacks:{
                  label: (ctx)=>{
                    const r = ctx.raw;
                    const v = r.v;
                    return `${r.x} • ${monthName(r.y)}: ${Number.isFinite(v) ? fmt(v,2) : "sem dado"}`;
                  }
                }
              },
              legend:{ position:"top" }
            },
            scales:{
              x:{
                title:{ display:true, text:"Ano" },
                ticks:{ autoSkip:true, maxRotation:0 },
                grid:{ color:"rgba(255,255,255,.06)" }
              },
              y:{
                title:{ display:true, text:"Mês" },
                min:1, max:12,
                ticks:{ callback:(v)=>monthName(v), stepSize:1 },
                grid:{ color:"rgba(255,255,255,.06)" }
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

      // ---------- MODO relação ----------
      if (mode === "rel"){
        heatLegend.style.display = "none";

        const pts = [];
        const xs = [];
        const ys = [];

        // tabela rica: ano/mes, V1,V2, tmin/tmax, precip
        for (const p of packs){
          for (const r of (p.months||[])){
            const mes = Number(r.m);
            if (!(mes>=1 && mes<=12)) continue;

            const x = safeNum(r[V1]);
            const y = safeNum(r[V2]);

            // só entra ponto se x e y existem
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

            const tmin = TMIN ? safeNum(r[TMIN]) : NaN;
            const tmax = TMAX ? safeNum(r[TMAX]) : NaN;
            const prec = PKEY ? safeNum(r[PKEY]) : NaN;

            pts.push({
              ano: p.year,
              mes,
              x,
              y,
              ...(TMIN ? { tmin } : {}),
              ...(TMAX ? { tmax } : {}),
              ...(PKEY ? { precip: prec } : {}),
            });

            xs.push(x);
            ys.push(y);
          }
        }

        if (pts.length < 10){
          setTable([]);
          destroyChart();
          setKpis([]);
          setMsg("Poucos pontos para relação (variável ausente ou dados insuficientes).", "err");
          return;
        }

        // scatter base
        const ds = [{
          type:"scatter",
          label: `${labelOfVar(V1)} × ${labelOfVar(V2)}`,
          data: pts.map(p=>({x:p.x, y:p.y})),
          pointRadius: 3,
          pointHoverRadius: 5
        }];

        // tendência
        let r2 = NaN;
        const model = trendModel.value;

        if (showTrend.checked){
          const fit = trendFit(xs, ys, model);

          if (fit){
            r2 = fit.r2;

            const xmin = Math.min(...xs), xmax = Math.max(...xs);
            const line = [];
            const steps = 80;
            for (let i=0;i<=steps;i++){
              const x = xmin + (xmax-xmin)*(i/steps);
              const y = fit.predict(x);
              if (Number.isFinite(y)) line.push({x, y});
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

          } else {
            setMsg("Modelo escolhido não pôde ser ajustado (log: x>0 / exp: y>0 / ou poucos dados).", "err");
          }
        }

        // tabela (até 500 linhas)
        setTable(pts.slice(0, 500));

        renderChart({
          data:{ datasets: ds },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:true, text: labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
              y:{ title:{display:true, text: labelOfVar(V2)}, grid:{color:"rgba(255,255,255,.06)"} },
            }
          }
        });

        chartTitle.textContent = `Relação entre variáveis — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Pontos: ${pts.length} (meses válidos no intervalo).`;

        setKpis([
          {k:"Pontos", v:String(pts.length)},
          {k:"X min", v:fmt(minFinite(xs),2)},
          {k:"X max", v:fmt(maxFinite(xs),2)},
          {k:"R²", v: (showR2.checked && Number.isFinite(r2)) ? fmt(r2,3) : "—"},
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

  // ---------- init ----------
  async function init(){
    try{
      setMsg("Iniciando...", "ok");

      const stUrl = new URL("stations.json", ASSETS).toString();
      const st = await fetchJson(stUrl);

      stations = Array.isArray(st) ? st : (st.stations || []);
      stations = stations.map(s=>({
        code: s.code || s.id || s.estacao || s.station || s.codigo,
        name: s.name || s.nome || s.station_name || s.estacao_nome || s.city || s.municipio || "—",
        uf: (s.uf || s.UF || s.estado || "—").toUpperCase(),
        city: s.city || s.municipio || "",
        lat: Number(s.lat ?? s.latitude),
        lon: Number(s.lon ?? s.lng ?? s.longitude),
      })).filter(s=>!!s.code);

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

      ufSelect.addEventListener("change", ()=>{
        applyFilters(false);
        renderMarkers();
      });

      searchStation.addEventListener("input", ()=>{
        // só filtra, sem zoom por enquanto
        applyFilters(false);
        renderMarkers();
      });

      // ENTER no campo: se tiver 1 match -> zoom
      searchStation.addEventListener("keydown", (ev)=>{
        if (ev.key === "Enter"){
          applyFilters(true);
          renderMarkers();
          ev.preventDefault();
        }
      });

      stationSelect.addEventListener("change", ()=>{
        selectStation(stationSelect.value, true);
      });

      btnClim.addEventListener("click", ()=>setMode("clim"));
      btnAnnual.addEventListener("click", ()=>setMode("annual"));
      btnHeatmap.addEventListener("click", ()=>setMode("heatmap"));
      btnRel.addEventListener("click", ()=>setMode("rel"));

      btnRun.addEventListener("click", run);

      btnPng.addEventListener("click", ()=>{
        try{
          if (!chart){ setMsg("Nenhum gráfico para baixar.", "err"); return; }
          downloadPngFromChart(chart, lastPngName);
          setMsg("Download PNG iniciado.", "ok");
        }catch(e){
          console.error(e);
          setMsg(`Falha ao baixar PNG: ${e.message || e}`, "err");
        }
      });

      btnCsv.addEventListener("click", ()=>{
        try{
          if (!lastRows || !lastRows.length){ setMsg("Nenhuma tabela para baixar.", "err"); return; }
          downloadText(lastCsvName, rowsToCsv(lastRows));
          setMsg("Download CSV iniciado.", "ok");
        }catch(e){
          console.error(e);
          setMsg(`Falha ao baixar CSV: ${e.message || e}`, "err");
        }
      });

      btnReset.addEventListener("click", ()=>{
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

  init();
})();
