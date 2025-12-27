/* Climogramas BR v2 — app.js
   - Leaflet + MarkerCluster
   - Chart.js + Zoom
   - Busca/lista/ano
   - Export PNG/CSV
*/

const $ = (id) => document.getElementById(id);

// Base path seguro para GitHub Pages (repo dentro de subpasta)
function basePath() {
  // ex: /climogramas-br.v2/
  const p = window.location.pathname;
  if (p.endsWith("/")) return p;
  return p.substring(0, p.lastIndexOf("/") + 1);
}
const BASE = basePath();

const state = {
  stations: [],
  years: [],
  selectedStation: null,
  selectedYear: null,
  map: null,
  cluster: null,
  markersById: new Map(),
  chart: null,
  lastMonthly: null
};

// ---------- Helpers ----------
function fmt1(x){ return (x==null || Number.isNaN(x)) ? "—" : `${x.toFixed(1)}`; }
function fmtC(x){ return (x==null || Number.isNaN(x)) ? "—" : `${x.toFixed(1)} °C`; }
function fmtMM(x){ return (x==null || Number.isNaN(x)) ? "—" : `${x.toFixed(1)} mm`; }

function safeNum(v){
  if (v==null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // muitos INMET usam -9999 como missing
  if (n <= -999) return null;
  return n;
}

function stationLabel(s){
  // tenta ser compatível com diferentes chaves
  const id = s.id || s.codigo || s.wmo || s.ID || s.station_id;
  const name = s.name || s.nome || s.estacao || s.station || "SEM NOME";
  const uf = s.uf || s.UF || s.estado || "";
  return { id, name, uf };
}

function getLatLng(s){
  const lat = safeNum(s.lat ?? s.latitude ?? s.LATITUDE);
  const lon = safeNum(s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE);
  if (lat==null || lon==null) return null;
  return [lat, lon];
}

async function fetchJSON(path){
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
  return await r.json();
}

function monthNames(){
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
}

// ---------- UI render ----------
function renderYears(){
  const sel = $("yearSel");
  sel.innerHTML = "";
  for (const y of state.years) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }
  // default: último ano
  state.selectedYear = state.years[state.years.length - 1] ?? null;
  if (state.selectedYear) sel.value = String(state.selectedYear);
}

function renderStationList(list){
  const wrap = $("stationList");
  wrap.innerHTML = "";

  for (const s of list) {
    const {id, name, uf} = stationLabel(s);
    const div = document.createElement("div");
    div.className = "item" + (state.selectedStation && stationLabel(state.selectedStation).id === id ? " active" : "");
    div.innerHTML = `
      <strong>${name}${uf ? ` (${uf})` : ""}</strong>
      <div class="meta">ID ${id}</div>
    `;
    div.addEventListener("click", () => selectStationById(id, true));
    wrap.appendChild(div);
  }

  $("countLbl").textContent = `${list.length} estações`;
}

function filterStations(q){
  q = (q || "").trim().toLowerCase();
  if (!q) return state.stations;
  return state.stations.filter(s => {
    const {id, name, uf} = stationLabel(s);
    const hay = `${id} ${name} ${uf}`.toLowerCase();
    return hay.includes(q);
  });
}

function setRightEmpty(){
  $("selTitle").textContent = "Selecione uma estação";
  $("selMeta").textContent = "—";
  $("cTmin").textContent = "—";
  $("cTmean").textContent = "—";
  $("cTmax").textContent = "—";
  $("cRain").textContent = "—";
  $("sum1").textContent = "—";
  $("sum2").textContent = "—";
  $("sum3").textContent = "—";
}

// ---------- Map ----------
function initMap(){
  const map = L.map("map", { preferCanvas: true }).setView([-14.2, -51.9], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  const cluster = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 45
  });

  for (const s of state.stations) {
    const {id, name, uf} = stationLabel(s);
    const ll = getLatLng(s);
    if (!ll) continue;

    const m = L.marker(ll, { title: `${name} (${uf})` });
    m.bindPopup(`<b>${name}${uf ? ` (${uf})` : ""}</b><br/>ID ${id}`);
    m.on("click", () => selectStationById(id, false));
    cluster.addLayer(m);
    state.markersById.set(id, m);
  }

  map.addLayer(cluster);

  state.map = map;
  state.cluster = cluster;
}

function focusOnStation(st){
  const {id} = stationLabel(st);
  const m = state.markersById.get(id);
  if (!m) return;
  state.cluster.zoomToShowLayer(m, () => {
    state.map.setView(m.getLatLng(), 9, { animate: true });
    m.openPopup();
  });
}

function showAllStations(){
  if (!state.map) return;
  state.map.setView([-14.2, -51.9], 4, { animate: true });
}

// ---------- Data decoding ----------
function decodeMonthly(raw){
  // Suporta dois formatos:
  // A) { months: [{m:1, pr:..., tmean:..., tmin:..., tmax:...}, ...] }
  // B) { monthly: {...} } etc.
  // C) { m1:..., } (fallback)
  // Aqui fazemos heurística robusta.

  const out = {
    pr: new Array(12).fill(null),
    tmean: new Array(12).fill(null),
    tmin: new Array(12).fill(null),
    tmax: new Array(12).fill(null)
  };

  const months = raw.months || raw.monthly || raw.data || raw;
  if (Array.isArray(months)) {
    for (const row of months) {
      const m = Number(row.m ?? row.month ?? row.MES ?? row.mes);
      if (!m || m < 1 || m > 12) continue;
      out.pr[m-1] = safeNum(row.pr ?? row.prec ?? row.precip ?? row.precip_mm ?? row.chuva ?? row.precipitacao);
      out.tmean[m-1] = safeNum(row.tmean ?? row.temp_mean ?? row.t_med ?? row.tmed ?? row.tm ?? row.temperatura_media);
      out.tmin[m-1] = safeNum(row.tmin ?? row.temp_min ?? row.t_min ?? row.tmin_c ?? row.tn ?? row.temperatura_minima);
      out.tmax[m-1] = safeNum(row.tmax ?? row.temp_max ?? row.t_max ?? row.tmax_c ?? row.tx ?? row.temperatura_maxima);
    }
    return out;
  }

  // objeto: tenta achar chaves tipo pr_01 ... pr_12, tmean_01 ...
  const keys = Object.keys(months || {});
  const pick = (prefixes, i) => {
    const m2 = String(i+1).padStart(2,"0");
    const m1 = String(i+1);
    for (const p of prefixes) {
      const candidates = [
        `${p}${m2}`, `${p}${m1}`,
        `${p}_${m2}`, `${p}_${m1}`,
        `${p}-${m2}`, `${p}-${m1}`,
      ];
      for (const c of candidates) {
        if (c in months) return safeNum(months[c]);
      }
    }
    // procura por chave que contenha prefixo + mes
    for (const k of keys) {
      const kl = k.toLowerCase();
      if (prefixes.some(p => kl.startsWith(p.toLowerCase())) && (kl.endsWith(m2) || kl.endsWith(m1))) {
        return safeNum(months[k]);
      }
    }
    return null;
  };

  for (let i=0;i<12;i++){
    out.pr[i] = pick(["pr","prec","precip","chuva","ppt"], i);
    out.tmean[i] = pick(["tmean","tmed","tm","tempmean","temperatura_media","t_avg"], i);
    out.tmin[i] = pick(["tmin","tn","tempmin","temperatura_minima"], i);
    out.tmax[i] = pick(["tmax","tx","tempmax","temperatura_maxima"], i);
  }
  return out;
}

function annualStats(monthly){
  const allT = monthly.tmean.filter(v=>v!=null);
  const allMin = monthly.tmin.filter(v=>v!=null);
  const allMax = monthly.tmax.filter(v=>v!=null);
  const allPr = monthly.pr.filter(v=>v!=null);

  const tmean = allT.length ? allT.reduce((a,b)=>a+b,0)/allT.length : null;
  const tmin = allMin.length ? Math.min(...allMin) : null;
  const tmax = allMax.length ? Math.max(...allMax) : null;
  const prTot = allPr.length ? allPr.reduce((a,b)=>a+b,0) : null;

  // meses extremos chuva
  let wet = {idx:null, val:null};
  let dry = {idx:null, val:null};
  for (let i=0;i<12;i++){
    const v = monthly.pr[i];
    if (v==null) continue;
    if (wet.val==null || v > wet.val) wet = {idx:i, val:v};
    if (dry.val==null || v < dry.val) dry = {idx:i, val:v};
  }
  return { tmean, tmin, tmax, prTot, wet, dry };
}

// ---------- Chart ----------
function initChart(){
  const ctx = $("chart");
  Chart.register(window.ChartZoom);

  state.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: monthNames(),
      datasets: [
        {
          label: "Precipitação (mm)",
          data: new Array(12).fill(null),
          yAxisID: "yP",
          borderWidth: 0
        },
        {
          label: "Temp. média (°C)",
          data: new Array(12).fill(null),
          type: "line",
          yAxisID: "yT",
          pointRadius: 2,
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "right" },
        tooltip: { enabled: true },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x"
          },
          limits: { x: { min: 0, max: 11 } }
        }
      },
      scales: {
        yP: {
          position: "left",
          title: { display: true, text: "Precipitação (mm)" },
          beginAtZero: true
        },
        yT: {
          position: "right",
          title: { display: true, text: "Temperatura (°C)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  // reset zoom ao dar double click
  ctx.addEventListener("dblclick", () => state.chart.resetZoom());
}

function updateChart(monthly){
  state.chart.data.datasets[0].data = monthly.pr.map(v=>v==null ? null : Number(v));
  state.chart.data.datasets[1].data = monthly.tmean.map(v=>v==null ? null : Number(v));
  state.chart.update();
}

// ---------- Station selection ----------
async function loadStationYear(stationId, year){
  // assets/data/A001/2000.json
  const url = `${BASE}assets/data/${stationId}/${year}.json`;
  return await fetchJSON(url);
}

async function selectStationById(stationId, fromList){
  const st = state.stations.find(s => stationLabel(s).id === stationId);
  if (!st) return;

  state.selectedStation = st;

  // destaque na lista
  renderStationList(filterStations($("q").value));

  // título
  const {id, name, uf} = stationLabel(st);
  $("selTitle").textContent = `${name}${uf ? ` (${uf})` : ""}`;
  $("selMeta").textContent = `ID ${id} • ${fmt1(safeNum(st.lat ?? st.latitude))} , ${fmt1(safeNum(st.lon ?? st.lng ?? st.longitude))}`;

  if (fromList) focusOnStation(st);

  // carrega ano atual
  if (!state.selectedYear) return;

  try{
    const raw = await loadStationYear(id, state.selectedYear);
    const monthly = decodeMonthly(raw);
    state.lastMonthly = monthly;

    const stats = annualStats(monthly);
    $("cTmin").textContent = stats.tmin==null ? "—" : fmtC(stats.tmin);
    $("cTmean").textContent = stats.tmean==null ? "—" : fmtC(stats.tmean);
    $("cTmax").textContent = stats.tmax==null ? "—" : fmtC(stats.tmax);
    $("cRain").textContent = stats.prTot==null ? "—" : fmtMM(stats.prTot);

    const mn = monthNames();
    $("sum1").innerHTML = `📍 <b>${id}</b> • <b>${state.selectedYear}</b>`;
    $("sum2").innerHTML = (stats.wet.idx==null)
      ? `🌧️ Mês mais chuvoso: —`
      : `🌧️ Mês mais chuvoso: <b>${mn[stats.wet.idx]}</b> (${fmtMM(stats.wet.val)})`;
    $("sum3").innerHTML = (stats.dry.idx==null)
      ? `🌵 Mês mais seco: —`
      : `🌵 Mês mais seco: <b>${mn[stats.dry.idx]}</b> (${fmtMM(stats.dry.val)})`;

    updateChart(monthly);

  }catch(err){
    // se não existir arquivo daquele ano pra estação, não quebra o app
    $("cTmin").textContent = "—";
    $("cTmean").textContent = "—";
    $("cTmax").textContent = "—";
    $("cRain").textContent = "—";
    $("sum1").textContent = `Sem dados para ${id} em ${state.selectedYear}`;
    $("sum2").textContent = "—";
    $("sum3").textContent = "—";
    updateChart({pr:new Array(12).fill(null), tmean:new Array(12).fill(null), tmin:new Array(12).fill(null), tmax:new Array(12).fill(null)});
    console.warn(err);
  }
}

// ---------- Export ----------
function exportPNG(){
  if (!state.chart) return;
  const a = document.createElement("a");
  a.download = `climograma_${(state.selectedStation?stationLabel(state.selectedStation).id:"SEM_ESTACAO")}_${state.selectedYear||"ANO"}.png`;
  a.href = state.chart.toBase64Image("image/png", 1);
  a.click();
}

function exportCSV(){
  if (!state.selectedStation || !state.lastMonthly) return;

  const {id, name, uf} = stationLabel(state.selectedStation);
  const mn = monthNames();

  const rows = [];
  rows.push(["id","nome","uf","ano","mes","prec_mm","tmed_c","tmin_c","tmax_c"].join(","));

  for (let i=0;i<12;i++){
    const pr = state.lastMonthly.pr[i];
    const tm = state.lastMonthly.tmean[i];
    const tn = state.lastMonthly.tmin[i];
    const tx = state.lastMonthly.tmax[i];
    rows.push([
      id,
      `"${String(name).replaceAll('"','""')}"`,
      uf,
      state.selectedYear,
      mn[i],
      pr==null?"":pr,
      tm==null?"":tm,
      tn==null?"":tn,
      tx==null?"":tx
    ].join(","));
  }

  const blob = new Blob([rows.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `climograma_${id}_${state.selectedYear}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Init ----------
async function main(){
  setRightEmpty();

  // carrega índices
  // aceita tanto array quanto objeto
  const stRaw = await fetchJSON(`${BASE}assets/stations.json`);
  const yrRaw = await fetchJSON(`${BASE}assets/years.json`);

  state.stations = Array.isArray(stRaw) ? stRaw : (stRaw.stations || stRaw.data || []);
  state.years = Array.isArray(yrRaw) ? yrRaw : (yrRaw.years || yrRaw.data || []);

  // garante ordenação numérica
  state.years = state.years.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);

  renderYears();
  renderStationList(state.stations);

  initMap();
  initChart();

  // eventos
  $("q").addEventListener("input", () => {
    renderStationList(filterStations($("q").value));
  });

  $("yearSel").addEventListener("change", async (e) => {
    state.selectedYear = Number(e.target.value);
    if (state.selectedStation) {
      await selectStationById(stationLabel(state.selectedStation).id, false);
    }
  });

  $("btnPng").addEventListener("click", exportPNG);
  $("btnCsv").addEventListener("click", exportCSV);
  $("btnAll").addEventListener("click", showAllStations);
  $("btnFocus").addEventListener("click", () => { if (state.selectedStation) focusOnStation(state.selectedStation); });
  $("btnResetZoom").addEventListener("click", () => { if (state.chart) state.chart.resetZoom(); });

  // seleção inicial: nada (mais seguro)
}

main().catch(err => {
  console.error(err);
  alert("Erro ao iniciar o app. Abra o console (F12) e veja os detalhes.");
});
