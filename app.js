/* Transforma-Ação Climática — Climogramas do Brasil (INMET)
   Leaflet + MarkerCluster + Chart.js (zoom) — versão coerente (HTML/CSS/JS alinhados)
*/

const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

let stations = [];
let yearsAll = [];
let selectedStation = null;
let stationYears = [];
let selectedYear = null;

let map, cluster;
let markersById = new Map();

// charts
let chartTemp = null;
let chartRain = null;

function setStatus(text, ok=true){
  const pill = $("statusPill");
  if(!pill) return;
  pill.textContent = text;
  pill.style.background = ok ? "rgba(255,255,255,.12)" : "rgba(220,38,38,.20)";
  pill.style.borderColor = ok ? "rgba(255,255,255,.22)" : "rgba(220,38,38,.25)";
  pill.style.color = "#fff";
}

function norm(s){
  return (s ?? "")
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().trim();
}

function fmt(n, digits=1){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

async function fetchJson(path){
  const r = await fetch(path, {cache:"no-store"});
  if(!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
  return await r.json();
}

/* ---------------- STATIONS ---------------- */
function stationLabel(s){
  const id = s.id ?? s.ID ?? s.codigo ?? s.codigo_wmo ?? s.wmo ?? s.station_id;
  const name = s.name ?? s.NOME ?? s.estacao ?? s.station ?? "";
  const uf = s.uf ?? s.UF ?? "";
  return { id: String(id), name, uf };
}

function stationLatLng(s){
  const lat = Number(s.lat ?? s.latitude ?? s.LATITUDE);
  const lon = Number(s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE);
  return [lat, lon];
}

function renderList(arr){
  const box = $("stationList");
  if(!box) return;
  box.innerHTML = "";

  arr.forEach(s=>{
    const {id,name,uf} = stationLabel(s);
    const [lat, lon] = stationLatLng(s);

    const div = document.createElement("div");
    div.className = "item";
    div.dataset.id = id;

    div.innerHTML = `
      <div class="name">${(name||"(sem nome)")}${uf?` <span style="opacity:.85">(${uf})</span>`:""}</div>
      <div class="meta">
        <span>ID ${id}</span>
        <span>${Number.isFinite(lat)&&Number.isFinite(lon) ? `${lat.toFixed(1)}, ${lon.toFixed(1)}` : ""}</span>
      </div>
    `;

    div.addEventListener("click", ()=> selectStationById(id, true));
    box.appendChild(div);
  });
}

function setActiveListItem(id){
  document.querySelectorAll(".item").forEach(el=>{
    el.classList.toggle("active", el.dataset.id === String(id));
  });
}

/* ---------------- MAP ---------------- */
function initMap(){
  map = L.map("map", {zoomControl:true}).setView([-14.2, -52.6], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  cluster = L.markerClusterGroup({
    showCoverageOnHover:false,
    chunkedLoading:true,
    chunkInterval: 40
  });

  stations.forEach(s=>{
    const {id,name,uf} = stationLabel(s);
    const [lat, lon] = stationLatLng(s);
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const m = L.marker([lat, lon], {title:`${name} (${uf})`});
    m.on("click", ()=> selectStationById(id, false));
    m.bindPopup(`<b>${name}</b>${uf?` (${uf})`:""}<br/>ID ${id}`);

    markersById.set(String(id), m);
    cluster.addLayer(m);
  });

  map.addLayer(cluster);
}

function zoomToStation(id, zoom=9){
  const m = markersById.get(String(id));
  if(!m || !map) return;
  const ll = m.getLatLng();
  map.setView(ll, zoom, {animate:true});
  m.openPopup();
}

/* ---------------- YEARS ---------------- */
function fillYearSelect(yrs){
  const sel = $("yearSelect");
  if(!sel) return;
  sel.innerHTML = "";
  yrs.forEach(y=>{
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  });
  if(yrs.length){
    sel.value = String(yrs[yrs.length-1]);
    selectedYear = Number(sel.value);
  }
}

async function probeYearsForStation(id, years){
  // 25 anos (2000–2024). Dá para testar com fetch em paralelo, limitado.
  const urlFor = (y) => `assets/data/${id}/${y}.json`;

  const concurrency = 6;
  const found = [];
  let idx = 0;

  async function worker(){
    while(idx < years.length){
      const y = years[idx++];
      try{
        const r = await fetch(urlFor(y), {method:"HEAD", cache:"no-store"});
        if(r.ok) found.push(y);
      }catch{ /* ignore */ }
    }
  }

  const workers = Array.from({length: concurrency}, worker);
  await Promise.all(workers);

  found.sort((a,b)=>a-b);
  return found;
}

/* ---------------- CHARTS ---------------- */
function ensureCharts(){
  // só cria 1x
  if(chartTemp && chartRain) return;

  // Chart.js + plugin zoom
  if(window.Chart && window.ChartZoom){
    Chart.register(window.ChartZoom);
  } else if (window.Chart && window["chartjs-plugin-zoom"]) {
    Chart.register(window["chartjs-plugin-zoom"]);
  }

  const common = {
    responsive:true,
    maintainAspectRatio:false,
    interaction:{ mode:"index", intersect:false },
    plugins:{
      legend:{ position:"top" },
      zoom:{
        zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:"x" },
        pan:{ enabled:true, mode:"x" }
      }
    },
    scales:{
      x:{ grid:{ color:"rgba(11,34,48,.06)" } }
    }
  };

  // Temperatura (linhas)
  chartTemp = new Chart($("chartTemp"), {
    type:"line",
    data:{ labels: MONTHS, datasets:[] },
    options:{
      ...common,
      scales:{
        ...common.scales,
        y:{ title:{display:true, text:"Temperatura (°C)"} , grid:{ color:"rgba(11,34,48,.08)"} },
        y2:{ position:"right", display:false, grid:{ drawOnChartArea:false }, title:{display:false, text:""} }
      }
    }
  });

  // Precipitação (barras + linha média)
  chartRain = new Chart($("chartRain"), {
    type:"bar",
    data:{ labels: MONTHS, datasets:[] },
    options:{
      ...common,
      scales:{
        ...common.scales,
        y:{ beginAtZero:true, title:{display:true, text:"Precipitação (mm)"}, grid:{ color:"rgba(11,34,48,.08)"} }
      }
    }
  });

  // duplo clique reseta
  $("chartTemp").addEventListener("dblclick", ()=> chartTemp?.resetZoom?.());
  $("chartRain").addEventListener("dblclick", ()=> chartRain?.resetZoom?.());
}

function stats(arr){
  const v = arr.filter(x => x!=null && Number.isFinite(Number(x))).map(Number);
  if(!v.length) return null;
  const mean = v.reduce((a,b)=>a+b,0)/v.length;
  return { mean, min: Math.min(...v), max: Math.max(...v) };
}

function setChartsFromData(d){
  ensureCharts();

  const months = d.months || [];

  const tmean = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmean_c ?? null);
  const tmin  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmin_c  ?? null);
  const tmax  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmax_c  ?? null);
  const prec  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.prec_mm  ?? null);

  // extra var
  const extraKey = $("extraVar")?.value || "";
  let extraArr = null;
  let extraLabel = "";
  if(extraKey && d.vars?.[extraKey]?.months && d.vars[extraKey].months.length === 12){
    extraArr = d.vars[extraKey].months.map(v => (v==null ? null : Number(v)));
    extraLabel = $("extraVar").selectedOptions[0]?.textContent || extraKey;
  }

  // ---- Temperatura datasets
  const dsT = [];

  if(tmean.some(v=>v!=null)){
    dsT.push({ label:"Temp. média (°C)", data:tmean, tension:.25, pointRadius:2 });
    const st = stats(tmean);
    if(st){
      dsT.push({
        label:"Média anual (T)",
        data: Array(12).fill(st.mean),
        pointRadius:0,
        borderDash:[6,6],
        tension:0
      });
    }
  }
  if(tmax.some(v=>v!=null)) dsT.push({ label:"T máx (°C)", data:tmax, tension:.2, pointRadius:0, borderDash:[4,4] });
  if(tmin.some(v=>v!=null)) dsT.push({ label:"T mín (°C)", data:tmin, tension:.2, pointRadius:0, borderDash:[4,4] });

  // extra variable on y2
  chartTemp.options.scales.y2.display = !!extraArr;
  chartTemp.options.scales.y2.title.display = !!extraArr;
  chartTemp.options.scales.y2.title.text = extraLabel || "";
  if(extraArr){
    dsT.push({
      label: extraLabel,
      data: extraArr,
      yAxisID:"y2",
      tension:.2,
      pointRadius:1
    });
  }

  chartTemp.data.labels = MONTHS;
  chartTemp.data.datasets = dsT;
  chartTemp.update();

  // ---- Precipitação datasets
  const dsR = [];
  if(prec.some(v=>v!=null)){
    dsR.push({ type:"bar", label:"Precipitação (mm)", data:prec });
    const stp = stats(prec);
    if(stp){
      dsR.push({
        type:"line",
        label:"Média mensal (chuva)",
        data: Array(12).fill(stp.mean),
        pointRadius:0,
        borderDash:[6,6],
        tension:.2
      });
    }
  } else {
    // sem chuva no JSON => gráfico limpo
    dsR.push({ type:"bar", label:"Precipitação (mm)", data: Array(12).fill(null) });
  }

  chartRain.data.labels = MONTHS;
  chartRain.data.datasets = dsR;
  chartRain.update();
}

/* ---------------- RIGHT PANEL ---------------- */
function clearRightPanel(msg){
  $("kTmin").textContent = "—";
  $("kTmean").textContent = "—";
  $("kTmax").textContent = "—";
  $("kPtotal").textContent = "—";
  $("kPmean").textContent = "—";
  $("kPmax").textContent = "—";
  $("kPmin").textContent = "—";
  $("kYears").textContent = stationYears.length ? `${stationYears[0]}–${stationYears[stationYears.length-1]} (${stationYears.length})` : "—";
  $("summary").textContent = msg;
  if(chartTemp) { chartTemp.data.datasets=[]; chartTemp.update(); }
  if(chartRain) { chartRain.data.datasets=[]; chartRain.update(); }
}

function pickExtreme(months, key, mode){
  const vals = months
    .map(m => ({m:m.m, v:m[key]}))
    .filter(x => x.v!=null && Number.isFinite(Number(x.v)))
    .map(x => ({m:x.m, v:Number(x.v)}));
  if(!vals.length) return null;
  vals.sort((a,b)=> mode==="max" ? (b.v-a.v) : (a.v-b.v));
  return vals[0];
}

function renderRightPanel(d){
  const annual = d.annual || {};
  const months = d.months || [];

  // temp KPIs
  $("kTmin").textContent  = (annual.tmin_c!=null) ? `${fmt(annual.tmin_c,1)} °C` : "—";
  $("kTmean").textContent = (annual.tmean_c!=null) ? `${fmt(annual.tmean_c,1)} °C` : "—";
  $("kTmax").textContent  = (annual.tmax_c!=null) ? `${fmt(annual.tmax_c,1)} °C` : "—";

  // precip KPIs
  const pVals = months.map(m => m.prec_mm ?? null).filter(v => v!=null && Number.isFinite(Number(v))).map(Number);
  const pTotal = (annual.prec_total_mm!=null) ? Number(annual.prec_total_mm) : (pVals.length ? pVals.reduce((a,b)=>a+b,0) : null);
  $("kPtotal").textContent = (pTotal!=null) ? `${fmt(pTotal,1)} mm` : "—";

  const pMean = pVals.length ? (pVals.reduce((a,b)=>a+b,0)/pVals.length) : null;
  const pMax = pVals.length ? Math.max(...pVals) : null;
  const pMin = pVals.length ? Math.min(...pVals) : null;

  $("kPmean").textContent = (pMean!=null) ? `${fmt(pMean,1)} mm` : "—";
  $("kPmax").textContent  = (pMax!=null) ? `${fmt(pMax,1)} mm` : "—";
  $("kPmin").textContent  = (pMin!=null) ? `${fmt(pMin,1)} mm` : "—";

  // summary
  const hottest = pickExtreme(months, "tmean_c", "max");
  const coldest = pickExtreme(months, "tmean_c", "min");
  const wettest = pickExtreme(months, "prec_mm", "max");
  const driest  = pickExtreme(months, "prec_mm", "min");

  const y = d.year ?? selectedYear;
  const id = d?.meta?.id ?? d?.id ?? (selectedStation ? stationLabel(selectedStation).id : "—");

  $("summary").innerHTML = `
    <div><b>🧭 ${id} • ${y}</b></div>
    <div>🌧️ Mês mais chuvoso: ${wettest ? `<b>${MONTHS[wettest.m-1]}</b> (${fmt(wettest.v,1)} mm)` : "—"}</div>
    <div>🏜️ Mês mais seco: ${driest ? `<b>${MONTHS[driest.m-1]}</b> (${fmt(driest.v,1)} mm)` : "—"}</div>
    <div>🔥 Mês mais quente: ${hottest ? `<b>${MONTHS[hottest.m-1]}</b> (${fmt(hottest.v,1)} °C)` : "—"}</div>
    <div>❄️ Mês mais fresco: ${coldest ? `<b>${MONTHS[coldest.m-1]}</b> (${fmt(coldest.v,1)} °C)` : "—"}</div>
    <div class="small">
      Dado mensal: chuva = soma do mês; T = média do mês; Tmin/Tmax = extremos do mês (hora a hora).
    </div>
  `;

  setChartsFromData(d);
}

/* ---------------- LOAD YEAR (station) ---------------- */
async function loadStationYear(id, year){
  selectedYear = year;
  const path = `assets/data/${id}/${year}.json`;
  try{
    const d = await fetchJson(path);
    setStatus("Pronto ✅", true);
    renderRightPanel(d);
  }catch(err){
    setStatus("Ano sem arquivo", false);
    clearRightPanel(`Não encontrei ${id}/${year}.json em assets/data/${id}/`);
    console.error(err);
  }
}

/* ---------------- SELECT STATION ---------------- */
async function selectStationById(id, fromList){
  const s = stations.find(x => String(stationLabel(x).id) === String(id));
  if(!s) return;

  selectedStation = s;
  setActiveListItem(id);

  // zoom sempre
  zoomToStation(id, 9);

  // scroll item se veio da lista/busca
  if(fromList){
    const el = document.querySelector(`.item[data-id="${CSS.escape(String(id))}"]`);
    el?.scrollIntoView({block:"center", behavior:"smooth"});
  }

  // header right
  const {name, uf} = stationLabel(selectedStation);
  const [lat, lon] = stationLatLng(selectedStation);
  $("stationTitle").textContent = `${name || "(sem nome)"}${uf?` (${uf})`:""}`;
  $("stationMeta").textContent = `ID ${id} • ${Number.isFinite(lat)&&Number.isFinite(lon) ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : ""}`;

  // years for station
  setStatus("Detectando anos…", true);

  stationYears = await probeYearsForStation(id, yearsAll);

  if(!stationYears.length){
    $("kYears").textContent = "0";
    setStatus("Sem dados nessa estação", false);
    clearRightPanel("Sem dados disponíveis para essa estação.");
    return;
  }

  $("kYears").textContent = `${stationYears[0]}–${stationYears[stationYears.length-1]} (${stationYears.length})`;

  // update year select to station years (default last available)
  fillYearSelect(stationYears);
  selectedYear = Number($("yearSelect").value);

  // populate extra variables from any available year file (pega do ano atual)
  try{
    const peek = await fetchJson(`assets/data/${id}/${selectedYear}.json`);
    populateExtraVars(peek);
  }catch{ populateExtraVars(null); }

  // load
  await loadStationYear(id, selectedYear);
}

function populateExtraVars(d){
  const sel = $("extraVar");
  if(!sel) return;
  const keep = sel.value || "";
  sel.innerHTML = `<option value="">(sem variável extra)</option>`;

  const keys = d?.vars ? Object.keys(d.vars) : [];
  // exemplos comuns: rh, rad, press, wind etc.
  keys.sort().forEach(k=>{
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = (d.vars[k]?.label) ? d.vars[k].label : k;
    sel.appendChild(opt);
  });

  // tenta manter seleção anterior
  sel.value = keep;
}

/* ---------------- INIT ---------------- */
async function loadBase(){
  setStatus("Carregando estações…", true);

  // atenção: no seu repo está em assets/stations.json (raiz/assets)
  const st = await fetchJson("assets/stations.json");
  stations = Array.isArray(st) ? st : (st.stations || []);
  if(!stations.length) throw new Error("stations.json vazio/inválido.");

  setStatus("Carregando anos…", true);
  const ys = await fetchJson("assets/years.json");
  yearsAll = Array.isArray(ys) ? ys : (ys.years || []);
  yearsAll = yearsAll.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!yearsAll.length) throw new Error("years.json vazio/inválido.");

  $("stationCount").textContent = stations.length;
  fillYearSelect(yearsAll);
  renderList(stations);
  initMap();

  setStatus("Pronto ✅", true);
}

function wireUI(){
  // abas
  $("tabTemp")?.addEventListener("click", ()=>{
    $("tabTemp").classList.add("active");
    $("tabRain").classList.remove("active");
    $("paneTemp").classList.add("active");
    $("paneRain").classList.remove("active");
    chartTemp?.resize();
  });

  $("tabRain")?.addEventListener("click", ()=>{
    $("tabRain").classList.add("active");
    $("tabTemp").classList.remove("active");
    $("paneRain").classList.add("active");
    $("paneTemp").classList.remove("active");
    chartRain?.resize();
  });

  // ano
  $("yearSelect")?.addEventListener("change", async ()=>{
    if(!selectedStation) return;
    const {id} = stationLabel(selectedStation);
    await loadStationYear(id, Number($("yearSelect").value));
  });

  // variável extra
  $("extraVar")?.addEventListener("change", async ()=>{
    if(!selectedStation) return;
    const {id} = stationLabel(selectedStation);
    await loadStationYear(id, selectedYear);
  });

  // reset zoom geral
  $("btnResetAll")?.addEventListener("click", ()=>{
    chartTemp?.resetZoom?.();
    chartRain?.resetZoom?.();
    if(map) map.setView([-14.2, -52.6], 4, {animate:true});
    if(selectedStation){
      const {id} = stationLabel(selectedStation);
      zoomToStation(id, 9);
    }
  });

  // focar
  $("btnFocus")?.addEventListener("click", ()=>{
    if(!selectedStation) return;
    const {id} = stationLabel(selectedStation);
    zoomToStation(id, 10);
  });

  // mostrar todas
  $("btnAll")?.addEventListener("click", ()=>{
    if(!map) return;
    map.setView([-14.2, -52.6], 4, {animate:true});
  });

  // busca
  $("q")?.addEventListener("input", ()=>{
    const q = norm($("q").value);
    if(!q){ renderList(stations); return; }
    const filtered = stations.filter(s=>{
      const {id,name,uf} = stationLabel(s);
      return norm(`${id} ${name} ${uf}`).includes(q);
    });
    renderList(filtered);
  });

  $("clearSearch")?.addEventListener("click", ()=>{
    $("q").value = "";
    renderList(stations);
  });

  // toggle mobile
  $("toggleStations")?.addEventListener("click", ()=>{
    const panel = $("leftPanel");
    panel.classList.toggle("open");
    $("toggleStations").textContent = panel.classList.contains("open") ? "Fechar" : "Abrir";
  });

  // export PNG (da aba atual)
  $("btnPng")?.addEventListener("click", ()=>{
    const activeTemp = $("paneTemp")?.classList.contains("active");
    const c = activeTemp ? chartTemp : chartRain;
    if(!c) return;

    const a = document.createElement("a");
    a.href = c.toBase64Image("image/png", 1);
    const st = selectedStation ? stationLabel(selectedStation) : {id:"station"};
    a.download = `climograma_${st.id}_${selectedYear}_${activeTemp ? "temp" : "prec"}.png`;
    a.click();
  });

  // export CSV (mensal do ano)
  $("btnCsv")?.addEventListener("click", async ()=>{
    if(!selectedStation) return;
    const {id} = stationLabel(selectedStation);
    try{
      const d = await fetchJson(`assets/data/${id}/${selectedYear}.json`);
      const rows = (d.months||[]).map(m=>({
        ano: d.year,
        mes: m.m,
        mes_nome: MONTHS[m.m-1],
        prec_mm: m.prec_mm ?? "",
        tmean_c: m.tmean_c ?? "",
        tmin_c: m.tmin_c ?? "",
        tmax_c: m.tmax_c ?? ""
      }));

      // adiciona vars extras se existirem
      if(d.vars){
        for(const k of Object.keys(d.vars)){
          const arr = d.vars[k]?.months;
          if(Array.isArray(arr) && arr.length===12){
            rows.forEach((r, i)=> r[k] = arr[i] ?? "");
          }
        }
      }

      const header = Object.keys(rows[0]||{});
      const csv = [
        header.join(";"),
        ...rows.map(r => header.map(k => String(r[k] ?? "").replaceAll(";", ",")).join(";"))
      ].join("\n");

      const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clima_${id}_${selectedYear}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }catch(e){
      alert("Não consegui exportar CSV desse ano/estação.");
      console.error(e);
    }
  });
}

// boot
window.addEventListener("load", async ()=>{
  try{
    wireUI();
    await loadBase();
  }catch(err){
    console.error(err);
    setStatus("Erro ao iniciar", false);
    alert("Erro ao iniciar o app. Abra o Console (F12) para ver detalhes.");
  }
});
