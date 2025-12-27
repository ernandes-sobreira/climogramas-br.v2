/* Climogramas BR v2 — app estático (GitHub Pages)
   Estrutura esperada:
   - assets/stations.json
   - assets/years.json
   - assets/data/<ID>/<YEAR>.json  (ex: assets/data/A001/2024.json)
*/

const $ = (sel) => document.querySelector(sel);

const state = {
  stations: [],
  years: [],
  filtered: [],
  selectedStationId: null,
  selectedYear: null,
  map: null,
  markersLayer: null,
  chart: null,
  cacheYearData: new Map(), // key: `${id}-${year}` -> parsed
};

// Detecta base para GitHub Pages (repo project)
function computeBase() {
  // Ex: /climogramas-br.v2/ -> BASE = /climogramas-br.v2/
  const p = window.location.pathname;
  if (p.endsWith("/")) return p;
  return p.substring(0, p.lastIndexOf("/") + 1);
}
const BASE = computeBase();

function setStatus(msg) {
  $("#status").textContent = msg;
}

function fmt1(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return (Math.round(x * 10) / 10).toFixed(1);
}
function fmt0(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return String(Math.round(x));
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function normalizeStation(s) {
  // tenta cobrir variações de nomes
  const id = (s.id || s.ID || s.codigo || s.station_id || s.wmo || s.WMO || "").toString().trim();
  const name = (s.nome || s.name || s.estacao || s.ESTACAO || s.station || "").toString().trim();
  const uf = (s.uf || s.UF || s.estado || s.state || "").toString().trim();
  const region = (s.regiao || s.REGIAO || s.region || "").toString().trim();

  // lat/lon podem vir como string com vírgula
  const latRaw = (s.lat ?? s.latitude ?? s.LATITUDE ?? s.Latitude ?? s.y);
  const lonRaw = (s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE ?? s.Longitude ?? s.x);

  const lat = parseFloat(String(latRaw).replace(",", "."));
  const lon = parseFloat(String(lonRaw).replace(",", "."));

  return {
    ...s,
    id,
    name,
    uf,
    region,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

function parseStations(stRaw) {
  // aceita: array, {stations:[...]}, {data:[...]}, ou objeto { "A001": {...}, ... }
  let arr = [];
  if (Array.isArray(stRaw)) arr = stRaw;
  else if (stRaw && Array.isArray(stRaw.stations)) arr = stRaw.stations;
  else if (stRaw && Array.isArray(stRaw.data)) arr = stRaw.data;
  else if (stRaw && typeof stRaw === "object") {
    arr = Object.entries(stRaw).map(([id, obj]) => ({ id, ...(obj || {}) }));
  }
  const norm = arr.map(normalizeStation).filter(s => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  // ordena por UF e nome
  norm.sort((a,b) => (a.uf+a.name).localeCompare(b.uf+b.name, "pt-BR"));
  return norm;
}

function parseYears(yrRaw) {
  // aceita: array [2000,2001], {years:[...]}, {data:[...]}, ou objeto {"2000":true,...}
  let arr = [];
  if (Array.isArray(yrRaw)) arr = yrRaw;
  else if (yrRaw && Array.isArray(yrRaw.years)) arr = yrRaw.years;
  else if (yrRaw && Array.isArray(yrRaw.data)) arr = yrRaw.data;
  else if (yrRaw && typeof yrRaw === "object") arr = Object.keys(yrRaw).map(Number);
  arr = arr.map(Number).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
  return arr;
}

// Carrega JSON com tratamento de erro bom
async function loadJSON(path) {
  const url = BASE + path.replace(/^\.\//, "");
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    const text = await res.text().catch(()=> "");
    throw new Error(`HTTP ${res.status} ao carregar ${url}\n${text.slice(0,200)}`);
  }
  return await res.json();
}

function buildYearOptions() {
  const sel = $("#yearSel");
  sel.innerHTML = "";
  // default: último ano
  const years = state.years;
  const last = years[years.length - 1] ?? new Date().getFullYear();

  years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  });

  state.selectedYear = last;
  sel.value = String(last);
}

function renderCount() {
  $("#countInfo").textContent = `${state.filtered.length} estações`;
}

function stationCardHTML(s, active=false) {
  const title = `${s.name || "SEM NOME"} (${s.uf || "—"})`;
  const metaLeft = `ID ${s.id}`;
  const metaRight = `${fmt1(s.lat)}, ${fmt1(s.lon)}`;
  return `
    <div class="station ${active ? "active":""}" data-id="${s.id}">
      <div class="stationName">${escapeHTML(title)}</div>
      <div class="stationMeta">
        <span>${escapeHTML(metaLeft)}</span>
        <span>${escapeHTML(metaRight)}</span>
      </div>
    </div>
  `;
}

function escapeHTML(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderList() {
  const list = $("#list");
  list.innerHTML = state.filtered.map(s => stationCardHTML(s, s.id === state.selectedStationId)).join("");
}

function filterStations(q) {
  const t = (q || "").trim().toLowerCase();
  if (!t) return [...state.stations];

  return state.stations.filter(s => {
    const blob = `${s.id} ${s.name} ${s.uf} ${s.region}`.toLowerCase();
    return blob.includes(t);
  });
}

function ensureMap() {
  if (state.map) return;

  state.map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([-14.5, -53.0], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap',
  }).addTo(state.map);

  state.markersLayer = L.layerGroup().addTo(state.map);
}

function markerStyle() {
  // simples e leve
  return {
    radius: 5,
    fillColor: "#2d7df6",
    color: "#2d7df6",
    weight: 1,
    opacity: 0.8,
    fillOpacity: 0.7
  };
}

function renderMarkers() {
  ensureMap();
  state.markersLayer.clearLayers();

  state.filtered.forEach(s => {
    const m = L.circleMarker([s.lat, s.lon], markerStyle());
    m.on("click", () => selectStation(s.id, true));
    m.bindTooltip(`${s.name} (${s.uf})<br><b>${s.id}</b>`, { sticky: true });
    m.addTo(state.markersLayer);
  });

  // se tiver seleção, destaca aproximando
  if (state.selectedStationId) {
    const s = state.stations.find(x => x.id === state.selectedStationId);
    if (s) state.map.panTo([s.lat, s.lon], { animate: true });
  }
}

function focusToFiltered() {
  ensureMap();
  const pts = state.filtered
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map(s => [s.lat, s.lon]);

  if (!pts.length) return;
  const b = L.latLngBounds(pts);
  state.map.fitBounds(b.pad(0.12));
}

function setStationHeader(s) {
  $("#stationTitle").textContent = `${s.name} (${s.uf})`;
  $("#stationMeta").textContent = `ID ${s.id} • ${fmt1(s.lat)}, ${fmt1(s.lon)}`;
}

function clearRightPanel() {
  $("#stationTitle").textContent = "Selecione uma estação";
  $("#stationMeta").textContent = "—";
  $("#kTmin").textContent = "—";
  $("#kTmean").textContent = "—";
  $("#kTmax").textContent = "—";
  $("#kRain").textContent = "—";
  $("#summary").innerHTML = `<div class="muted">—</div>`;
  if (state.chart) {
    state.chart.data.labels = [];
    state.chart.data.datasets.forEach(d => d.data = []);
    state.chart.update();
  }
}

function monthLabels() {
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
}

// ====== DATA READER (flexível) ======
// Aceita variações do JSON anual, tenta extrair 12 valores para:
// - precipitação (mm)
// - temperatura média (°C)
// também calcula tmin/tmax anual, chuva total, etc.
function coerceNumber(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function extractMonthly(dataYear) {
  // Tentativas:
  // 1) dataYear.monthly: [{month:1,rain:..,tmean:..},...]
  // 2) dataYear.months: array 12
  // 3) dataYear.precip / dataYear.rain: array 12 + dataYear.tmean: array 12
  // 4) dataYear.series: { rain:[12], tmean:[12] }
  // 5) dataYear é array 12 direto

  let rain = null;
  let tmean = null;

  if (dataYear && Array.isArray(dataYear.monthly)) {
    const m = dataYear.monthly;
    const r = new Array(12).fill(null);
    const t = new Array(12).fill(null);
    m.forEach(row => {
      const mi = (row.month ?? row.mes ?? row.MES ?? row.idx ?? row.i);
      const k = clamp((Number(mi) || 0) - 1, 0, 11);
      r[k] = coerceNumber(row.rain ?? row.precip ?? row.p ?? row.chuva);
      t[k] = coerceNumber(row.tmean ?? row.temp ?? row.t ?? row.temperatura);
    });
    rain = r; tmean = t;
  } else if (dataYear && Array.isArray(dataYear.months)) {
    // months pode ser array de objetos ou números
    const m = dataYear.months;
    if (typeof m[0] === "object") {
      rain = m.map(x => coerceNumber(x.rain ?? x.precip ?? x.chuva));
      tmean = m.map(x => coerceNumber(x.tmean ?? x.temp ?? x.temperatura));
    } else {
      // se for array simples, não dá pra saber se é rain ou temp, então ignora
    }
  } else if (dataYear && Array.isArray(dataYear.rain) && Array.isArray(dataYear.tmean)) {
    rain = dataYear.rain.map(coerceNumber);
    tmean = dataYear.tmean.map(coerceNumber);
  } else if (dataYear && Array.isArray(dataYear.precip) && Array.isArray(dataYear.tmean)) {
    rain = dataYear.precip.map(coerceNumber);
    tmean = dataYear.tmean.map(coerceNumber);
  } else if (dataYear && dataYear.series && Array.isArray(dataYear.series.rain) && Array.isArray(dataYear.series.tmean)) {
    rain = dataYear.series.rain.map(coerceNumber);
    tmean = dataYear.series.tmean.map(coerceNumber);
  } else if (Array.isArray(dataYear) && dataYear.length === 12 && typeof dataYear[0] === "object") {
    // array 12 de objetos
    rain = dataYear.map(x => coerceNumber(x.rain ?? x.precip ?? x.chuva));
    tmean = dataYear.map(x => coerceNumber(x.tmean ?? x.temp ?? x.temperatura));
  }

  // garante tamanho 12
  if (!rain || rain.length !== 12) rain = new Array(12).fill(null);
  if (!tmean || tmean.length !== 12) tmean = new Array(12).fill(null);

  return { rain, tmean };
}

function summarizeYear({ rain, tmean }) {
  const validRain = rain.map((v,i)=>({v,i})).filter(x=>x.v!=null);
  const validT = tmean.map((v,i)=>({v,i})).filter(x=>x.v!=null);

  const rainTotal = validRain.reduce((a,x)=>a+x.v,0);
  const tMeanYear = validT.length ? (validT.reduce((a,x)=>a+x.v,0) / validT.length) : null;
  const tMinYear = validT.length ? Math.min(...validT.map(x=>x.v)) : null;
  const tMaxYear = validT.length ? Math.max(...validT.map(x=>x.v)) : null;

  const wet = validRain.length ? validRain.reduce((best,x)=> x.v>best.v?x:best, validRain[0]) : null;
  const dry = validRain.length ? validRain.reduce((best,x)=> x.v<best.v?x:best, validRain[0]) : null;

  const hot = validT.length ? validT.reduce((best,x)=> x.v>best.v?x:best, validT[0]) : null;
  const cool = validT.length ? validT.reduce((best,x)=> x.v<best.v?x:best, validT[0]) : null;

  return {
    rainTotal,
    tMeanYear,
    tMinYear,
    tMaxYear,
    wetMonth: wet ? wet.i : null,
    wetVal: wet ? wet.v : null,
    dryMonth: dry ? dry.i : null,
    dryVal: dry ? dry.v : null,
    hotMonth: hot ? hot.i : null,
    hotVal: hot ? hot.v : null,
    coolMonth: cool ? cool.i : null,
    coolVal: cool ? cool.v : null
  };
}

async function loadStationYear(id, year) {
  const key = `${id}-${year}`;
  if (state.cacheYearData.has(key)) return state.cacheYearData.get(key);

  const path = `assets/data/${id}/${year}.json`;
  const raw = await loadJSON(path);

  const { rain, tmean } = extractMonthly(raw);
  const summary = summarizeYear({ rain, tmean });

  const payload = { raw, rain, tmean, summary };
  state.cacheYearData.set(key, payload);
  return payload;
}

// ====== CHART ======
function ensureChart() {
  if (state.chart) return;

  const ctx = $("#chart").getContext("2d");
  const labels = monthLabels();

  state.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Precipitação (mm)",
          data: new Array(12).fill(null),
          yAxisID: "yRain",
          borderWidth: 0,
          barPercentage: 0.75,
          categoryPercentage: 0.75,
        },
        {
          type: "line",
          label: "Temp. média (°C)",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          tension: 0.25,
          pointRadius: 2.5,
          pointHoverRadius: 5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { boxWidth: 12 } },
        tooltip: { enabled: true },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "xy",
          },
          pan: { enabled: true, mode: "xy" }
        }
      },
      scales: {
        yRain: {
          position: "left",
          title: { display: true, text: "Precipitação (mm)" },
          grid: { color: "rgba(15,23,42,.08)" }
        },
        yTemp: {
          position: "right",
          title: { display: true, text: "Temperatura (°C)" },
          grid: { drawOnChartArea: false }
        },
        x: { grid: { display: false } }
      }
    }
  });

  // duplo-clique no canvas reseta zoom
  $("#chart").addEventListener("dblclick", () => {
    if (state.chart?.resetZoom) state.chart.resetZoom();
  });
}

function applyYearToUI(id, year, payload) {
  const s = state.stations.find(x => x.id === id);
  if (!s) return;

  setStationHeader(s);

  const sum = payload.summary;
  $("#kTmin").textContent = sum.tMinYear == null ? "—" : `${fmt1(sum.tMinYear)} °C`;
  $("#kTmean").textContent = sum.tMeanYear == null ? "—" : `${fmt1(sum.tMeanYear)} °C`;
  $("#kTmax").textContent = sum.tMaxYear == null ? "—" : `${fmt1(sum.tMaxYear)} °C`;
  $("#kRain").textContent = sum.rainTotal == null ? "—" : `${fmt1(sum.rainTotal)} mm`;

  const m = monthLabels();
  const html = `
    <div class="item"><span class="badge">📌</span><div><b>${escapeHTML(id)}</b> • <b>${escapeHTML(String(year))}</b></div></div>
    <div class="item"><span class="badge">🌧️</span><div><b>Mês mais chuvoso:</b> ${sum.wetMonth==null? "—" : `${m[sum.wetMonth]} (${fmt1(sum.wetVal)} mm)`}</div></div>
    <div class="item"><span class="badge">🏜️</span><div><b>Mês mais seco:</b> ${sum.dryMonth==null? "—" : `${m[sum.dryMonth]} (${fmt1(sum.dryVal)} mm)`}</div></div>
    <div class="item"><span class="badge">🔥</span><div><b>Mês mais quente:</b> ${sum.hotMonth==null? "—" : `${m[sum.hotMonth]} (${fmt1(sum.hotVal)} °C)`}</div></div>
    <div class="item"><span class="badge">❄️</span><div><b>Mês mais fresco:</b> ${sum.coolMonth==null? "—" : `${m[sum.coolMonth]} (${fmt1(sum.coolVal)} °C)`}</div></div>
  `;
  $("#summary").innerHTML = html;

  ensureChart();
  state.chart.data.datasets[0].data = payload.rain.map(v => v == null ? null : Number(v));
  state.chart.data.datasets[1].data = payload.tmean.map(v => v == null ? null : Number(v));
  state.chart.update();
}

async function selectStation(id, fromMap=false) {
  state.selectedStationId = id;

  // marca ativo na lista
  renderList();

  // pan no mapa
  const s = state.stations.find(x => x.id === id);
  if (s && state.map) {
    state.map.panTo([s.lat, s.lon], { animate: true });
    if (fromMap) state.map.setZoom(Math.max(state.map.getZoom(), 7));
  }

  // carrega ano
  const year = state.selectedYear;
  if (!year) return;

  try {
    setStatus(`Carregando ${id}/${year}…`);
    const payload = await loadStationYear(id, year);
    applyYearToUI(id, year, payload);
    setStatus("Pronto ✅");
  } catch (e) {
    console.error(e);
    setStatus("Erro ao carregar dados");
    $("#summary").innerHTML = `<div class="muted">Não encontrei <b>${escapeHTML(id)}/${escapeHTML(String(year))}</b> em <code>assets/data/${escapeHTML(id)}/${escapeHTML(String(year))}.json</code>.</div>`;
  }
}

function setupEvents() {
  $("#q").addEventListener("input", () => {
    state.filtered = filterStations($("#q").value);
    renderCount();
    renderList();
    renderMarkers();
  });

  $("#clearQ").addEventListener("click", () => {
    $("#q").value = "";
    state.filtered = filterStations("");
    renderCount();
    renderList();
    renderMarkers();
  });

  $("#yearSel").addEventListener("change", async () => {
    state.selectedYear = Number($("#yearSel").value);
    if (state.selectedStationId) {
      await selectStation(state.selectedStationId);
    }
  });

  $("#btnAll").addEventListener("click", () => {
    $("#q").value = "";
    state.filtered = [...state.stations];
    renderCount();
    renderList();
    renderMarkers();
    focusToFiltered();
  });

  $("#btnFocus").addEventListener("click", () => {
    focusToFiltered();
  });

  // clique na lista
  $("#list").addEventListener("click", (ev) => {
    const card = ev.target.closest(".station");
    if (!card) return;
    const id = card.getAttribute("data-id");
    if (id) selectStation(id, false);
  });

  $("#btnResetZoom").addEventListener("click", () => {
    if (state.chart?.resetZoom) state.chart.resetZoom();
  });

  $("#btnPNG").addEventListener("click", () => {
    if (!state.chart) return;
    const a = document.createElement("a");
    const id = state.selectedStationId || "station";
    const year = state.selectedYear || "year";
    a.download = `climograma_${id}_${year}.png`;
    a.href = state.chart.toBase64Image("image/png", 1);
    a.click();
  });

  $("#btnCSV").addEventListener("click", async () => {
    const id = state.selectedStationId;
    const year = state.selectedYear;
    if (!id || !year) return;

    try {
      const payload = await loadStationYear(id, year);
      const labels = monthLabels();

      // CSV mensal
      const rows = [["station_id","year","month","precip_mm","tmean_c"]];
      for (let i=0;i<12;i++){
        rows.push([
          id,
          String(year),
          labels[i],
          payload.rain[i] == null ? "" : String(payload.rain[i]),
          payload.tmean[i] == null ? "" : String(payload.tmean[i]),
        ]);
      }
      const csv = rows.map(r => r.map(cell => {
        const v = String(cell ?? "");
        // escape simples
        if (v.includes(",") || v.includes('"') || v.includes("\n")) {
          return `"${v.replaceAll('"','""')}"`;
        }
        return v;
      }).join(",")).join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `climograma_${id}_${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Não consegui gerar CSV (dados do ano não encontrados).");
    }
  });
}

// ====== INIT ======
async function main() {
  try {
    setStatus("Carregando estações…");

    const stRaw = await loadJSON("assets/stations.json");
    const yrRaw = await loadJSON("assets/years.json");

    state.stations = parseStations(stRaw);
    state.years = parseYears(yrRaw);

    if (!state.stations.length) {
      throw new Error("stations.json carregou, mas não encontrei estações válidas (id/lat/lon).");
    }
    if (!state.years.length) {
      // fallback: tenta inferir por pasta? (não dá em pages). então usa um range mínimo:
      state.years = [2023, 2024];
    }

    buildYearOptions();

    state.filtered = [...state.stations];
    renderCount();
    renderList();

    ensureMap();
    renderMarkers();
    focusToFiltered();

    ensureChart();
    clearRightPanel();

    setStatus("Pronto ✅");

  } catch (e) {
    console.error(e);
    setStatus("Erro");
    $("#summary").innerHTML = `
      <div class="muted">
        Erro ao iniciar.<br><br>
        <b>Checagens rápidas:</b><br>
        1) <code>${escapeHTML(BASE)}assets/stations.json</code><br>
        2) <code>${escapeHTML(BASE)}assets/years.json</code><br><br>
        <b>Detalhe:</b> ${escapeHTML(e.message)}
      </div>
    `;
  }
}

setupEvents();
main();
