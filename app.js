(() => {
  "use strict";

  // ---------- helpers ----------
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
    box.style.borderColor = (kind==="err") ? "rgba(251,113,133,.35)" : "rgba(255,255,255,.08)";
    box.style.background = (kind==="err") ? "rgba(251,113,133,.10)" : "rgba(7,11,22,.35)";
    box.style.color = (kind==="err") ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.70)";
  }

  // ---------- Downloads (ROBUSTO) ----------
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
    // tenta Blob primeiro
    try{
      const blob = new Blob([csvText], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      clickDownload(url, filename);
      setTimeout(()=>URL.revokeObjectURL(url), 1500);
      return true;
    } catch(e){
      // fallback data URL
      const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csvText);
      clickDownload(url, filename);
      return true;
    }
  }

  function downloadPngSync(chart, filename){
    // IMPORTANTÍSSIMO: síncrono (não perde user gesture)
    const url = chart?.toBase64Image?.("image/png", 1);
    if (!url || typeof url !== "string") throw new Error("Falha ao gerar PNG (toBase64Image).");
    clickDownload(url, filename);
    return true;
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

  // ---------- var labels ----------
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

  // ---------- Table (DECENTE) ----------
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

  // ---------- data ----------
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
      try{
        packs.push(await loadPack(code, y));
      }catch(_){}
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
  function renderChart(config){
    destroyChart();
    const ctx = $("mainChart").getContext("2d");
    chart = new Chart(ctx, config);
  }

  // ---------- map ----------
  function initMap(){
    map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([-14.2, -55.0], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function renderMarkers(){
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

  function selectStation(code, zoom=true){
    selectedStation = stations.find(s=>s.code===code) || null;

    stationMeta.textContent = selectedStation
      ? `${selectedStation.name} · ${selectedStation.uf} · lat ${selectedStation.lat} lon ${selectedStation.lon}`
      : "—";

    updatePills({station: selectedStation ? selectedStation.code : "—", years:"—", data:"—"});

    const years = [];
    for (let y=2000; y<=2024; y++) years.push(String(y));
    fillSelect(yearStart, years, y=>y, y=>y, true);
    fillSelect(yearEnd, years, y=>y, y=>y, true);

    if (zoom && selectedStation && map){
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

  // ---------- trend models ----------
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
      // y = a*exp(bx) (y>0)
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

  // ---------- heatmap colors ----------
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

  // ---------- run ----------
  async function run(){
    try{
      if (!selectedStation){ setMsg("Selecione uma estação.", "err"); return; }

      let y0 = Number(yearStart.value);
      let y1 = Number(yearEnd.value);
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) { y0=2000; y1=2024; }
      if (y0>y1) [y0,y1]=[y1,y0];

      setMsg("Carregando dados...", "ok");

      const code = selectedStation.code;
      const packs = await loadPacksForRange(code, y0, y1);

      if (!packs.length){
        destroyChart();
        setKpis([]);
        tableSet([]);
        updatePills({station: code, years:`${y0}–${y1}`, data:"0 ano(s)"});
        setMsg("Sem dados no intervalo selecionado (anos ausentes ou JSON vazio).", "err");
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

      // detect precip key
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

      // -------- CLIM --------
      if (mode==="clim"){
        heatLegend.style.display="none";

        const perMonth = Array.from({length:12}, (_,i)=>({
          m:i+1, v:[], tmin:[], tmax:[], p:[]
        }));

        for (const p of packs){
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;

            const v = safeNum(r[V1]);
            if (Number.isFinite(v)) perMonth[m-1].v.push(v);

            if (hasTmin){
              const vmin = safeNum(r.tmin);
              if (Number.isFinite(vmin)) perMonth[m-1].tmin.push(vmin);
            }
            if (hasTmax){
              const vmax = safeNum(r.tmax);
              if (Number.isFinite(vmax)) perMonth[m-1].tmax.push(vmax);
            }
            if (PKEY){
              const pv = safeNum(r[PKEY]);
              if (Number.isFinite(pv)) perMonth[m-1].p.push(pv);
            }
          }
        }

        const rows = perMonth.map(o=>{
          const row = {
            mes: o.m,
            V1_mean: meanFinite(o.v),
            V1_min: minFinite(o.v),
            V1_max: maxFinite(o.v),
            n: o.v.filter(Number.isFinite).length
          };
          if (PKEY) row.P_mean = meanFinite(o.p);
          return row;
        });

        const cols = ["mes","V1_mean","V1_min","V1_max","n"].concat(PKEY?["P_mean"]:[]);
        tableSet(rows, cols, 2);

        const labels = perMonth.map(o=>monthName(o.m));
        const ds = [];

        const showBars = !!(optPrecBars.checked && PKEY);
        if (showBars){
          ds.push({
            type:"bar",
            label:"Precipitação média (mm)",
            data: rows.map(r=>Number.isFinite(r.P_mean)?r.P_mean:null),
            yAxisID:"yP",
            order: 3
          });
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
              x:{ grid:{color:"rgba(255,255,255,.06)"} },
              y:{ position:"left", title:{display:true, text:labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
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

      // -------- ANNUAL --------
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
            row.P_sum = pv.length ? sumFinite(pv) : NaN; // precip anual (soma)
          }
          rows.push(row);
        }

        if (!rows.length){
          destroyChart(); setKpis([]); tableSet([]);
          setMsg("Sem dados suficientes para série anual (variável ausente).", "err");
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
              x:{title:{display:true,text:"Ano"}, grid:{color:"rgba(255,255,255,.06)"}},
              y:{position:"left", title:{display:true, text:labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"}},
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

      // -------- HEATMAP --------
      if (mode==="heatmap"){
        heatLegend.style.display="block";
        setHeatLegendGradient();

        const yearsAxis = yearsOk.slice().sort((a,b)=>a-b);

        // monta matriz ano x mês com valor
        const byYear = new Map();
        for (const y of yearsAxis){
          byYear.set(y, Array(12).fill(null));
        }

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

        // tabela decente: ano + m01..m12 + mean/min/max
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

        // pontos do heatmap
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
            responsive:true, maintainAspectRatio:false,
            plugins:{
              tooltip:{
                callbacks:{
                  label: (ctx)=>{
                    const r=ctx.raw;
                    return `${r.x} • ${monthName(r.y)}: ${Number.isFinite(r.v)?fmt(r.v,2):"sem dado"}`;
                  }
                }
              },
              legend:{position:"top"}
            },
            scales:{
              x:{title:{display:true,text:"Ano"}, grid:{color:"rgba(255,255,255,.06)"}},
              y:{
                title:{display:true,text:"Mês"},
                min:1,max:12,
                ticks:{callback:(v)=>monthName(v), stepSize:1},
                grid:{color:"rgba(255,255,255,.06)"}
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

      // -------- RELAÇÃO --------
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

            if (hasTmin){
              const tmin = safeNum(r.tmin);
              if (Number.isFinite(tmin)) row["Tmin (°C)"] = tmin;
            }
            if (hasTmax){
              const tmax = safeNum(r.tmax);
              if (Number.isFinite(tmax)) row["Tmax (°C)"] = tmax;
            }
            if (PKEY){
              const prec = safeNum(r[PKEY]);
              if (Number.isFinite(prec)) row["Precip (mm)"] = prec;
            }

            pts.push(row);
            xs.push(x); ys.push(y);
          }
        }

        if (pts.length < 10){
          destroyChart(); setKpis([]); tableSet([]);
          setMsg("Poucos pontos para relação (dados insuficientes).", "err");
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
          } else {
            setMsg("Modelo não pôde ser ajustado (log exige x>0; exp exige y>0; ou poucos dados).", "err");
          }
        }

        // tabela decente: mostra até 700 linhas
        const cols = ["ano","mes", colX, colY].concat(hasTmin?["Tmin (°C)"]:[]).concat(hasTmax?["Tmax (°C)"]:[]).concat(PKEY?["Precip (mm)"]:[]);
        tableSet(pts.slice(0,700), cols, 3);

        renderChart({
          data:{ datasets: ds },
          options:{
            responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:true, text:colX}, grid:{color:"rgba(255,255,255,.06)"} },
              y:{ title:{display:true, text:colY}, grid:{color:"rgba(255,255,255,.06)"} },
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

  // ---------- init ----------
  async function init(){
    try{
      setMsg("Iniciando...", "ok");
      setHeatLegendGradient();

      const stUrl = new URL("stations.json", ASSETS).toString();
      const st = await fetchJson(stUrl);

      stations = Array.isArray(st) ? st : (st.stations || []);
      stations = stations.map(s=>({
        code: s.code || s.id || s.estacao || s.station || s.codigo,
        name: s.name || s.nome || s.station_name || s.estacao_nome || s.city || s.municipio || "—",
        uf: (s.uf || s.UF || s.estado || "—").toUpperCase(),
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

      // modes
      for (const btn of document.querySelectorAll(".modeBtn")){
        btn.addEventListener("click", ()=>{
          setMode(btn.getAttribute("data-mode"));
        });
      }

      ufSelect.addEventListener("change", ()=>{
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
          // SINCRONO: resolve o “verdinho e não baixa”
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
          // usa as colunas atuais do cabeçalho
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
