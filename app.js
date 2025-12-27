/* Climogramas BR v2 — GitHub Pages
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
  cluster: null,
  chart: null,
  cacheYearData: new Map(), // key: `${id}-${year}` -> parsed
};

function computeBase() {
  const p = window.location.pathname;
  if (p.endsWith("/")) return p;
  return p.substring(0, p.lastIndexOf("/") + 1);
}
const BASE = computeBase();

function setStatus(msg) { $("#status").textContent = msg; }

function escapeHTML(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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

function coerceNumber(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function loadJSON(path) {
  const url = BASE + path.replace(/^\.\//, "");
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    const text = await res.text().catch(()=> "");
    throw new Error(`HTTP ${res.status} ao carregar ${url}\n${text.slice(0,200)}`);
  }
  return await res.json();
}

function normalizeStation(s) {
  const id = (s.id || s.ID || s.codigo || s.station_id || s.wmo || s.WMO || "").toString().trim();
  const name = (s.nome || s.name || s.estacao || s.ESTACAO || s.station || "").toString().trim();
  const uf = (s.uf || s.UF || s.estado || s.state || "").toString().trim();
  const region = (s.regiao || s.REGIAO || s.region || "").toString().trim();

  const latRaw = (s.lat ?? s.latitude ?? s.LATITUDE ?? s.Latitude ?? s.y);
  const lonRaw = (s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE ?? s.Longitude ?? s.x);

  const lat = parseFloat(String(latRaw).replace(",", "."));
  const lon = parseFloat(String(lonRaw).replace(",", "."));

  return { ...s, id, name, uf, region, lat: Number.isFinite(lat)?lat:null, lon: Number.isFinite(lon)?lon:null };
}

function parseStations(stRaw) {
  let arr = [];
  if (Array.isArray(stRaw)) arr = stRaw;
  else if (stRaw && Array.isArray(stRaw.stations)) arr = stRaw.stations;
  else if (stRaw && Array.isArray(stRaw.data)) arr = stRaw.data;
  else if (stRaw && typeof stRaw === "object") arr = Object.entries(stRaw).map(([id, obj]) => ({ id, ...(obj||{}) }));

  const norm = arr.map(normalizeStation).filter(s => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  norm.sort((a,b) => (a.uf+a.name).localeCompare(b.uf+b.name, "pt-BR"));
  return norm;
}

function parseYears(yrRaw) {
  let arr = [];
  if (Array.isArray(yrRaw)) arr = yrRaw;
  else if (yrRaw && Array.isArray(yrRaw.years)) arr = yrRaw.years;
  else if (yrRaw && Array.isArray(yrRaw.data)) arr = yrRaw.data;
  else if (yrRaw && typeof yrRaw === "object") arr = Object.keys(yrRaw).map(Number);
  arr = arr.map(Number).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
  return arr;
}

function buildYearOptions() {
  const sel = $("#yearSel");
  sel.innerHTML = "";
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

function renderCount() { $("#countInfo").textContent = `${state.filtered.length} estações`; }

function stationCardHTML(s, active=false) {
  const title = `${s.name || "SEM NOME"} (${s.uf || "—"})`;
  const metaLeft = `ID ${s.id}`;
  return `
    <div class="station ${active ? "active":""}" data-id="${s.id}">
      <div class="stationName">${escapeHTML(title)}</div>
      <div class="stationMeta">
        <span>${escapeHTML(metaLeft)}</span>
        <span>${escapeHTML(fmt1(s.lat))}, ${escapeHTML(fmt1(s.lon))}</span>
      </div>
    </div>
  `;
}

function renderList() {
  $("#list").innerHTML = state.filtered.map(s => stationCardHTML(s, s.id === state.selectedStationId)).join("");
}

function filterStations(q) {
  const t = (q || "").trim().toLowerCase();
  if (!t) return [...state.stations];
  return state.stations.filter(s => (`${s.id} ${s.name} ${s.uf} ${s.region}`).toLowerCase().includes(t));
}

function ensureMap() {
  if (state.map) return;

  state.map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([-14.5, -53.0], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap',
  }).addTo(state.map);

  state.cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 52,
    spiderfyOnMaxZoom: true,
  });

  state.map.addLayer(state.cluster);
}

function renderMarkers() {
  ensureMap();
  state.cluster.clearLayers();

  state.filtered.forEach(s => {
    const m = L.marker([s.lat, s.lon], { title: `${s.name} (${s.uf})` });
    m.on("click", () => selectStation(s.id, true));
    m.bindTooltip(`${escapeHTML(s.name)} (${escapeHTML(s.uf)})<br><b>${escapeHTML(s.id)}</b>`, { sticky: true });
    state.cluster.addLayer(m);
  });
}

function focusToFiltered() {
  ensureMap();
  const pts = state.filtered.map(s => [s.lat, s.lon]);
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
  ["kTmin","kTmean","kTmax","kRain","kRainMean","kRainMax","kRainMin","kQuality"].forEach(id => $(`#${id}`).textContent = "—");
  $("#summary").innerHTML = `<div class="muted">—</div>`;
  if (state.chart) {
    state.chart.data.labels = monthLabels();
    state.chart.data.datasets.forEach(d => d.data = new Array(12).fill(null));
    state.chart.update();
  }
}

function monthLabels() { return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]; }

function findAny(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

/* ========= PARSER ROBUSTO =========
   Retorna arrays 12:
   - rain (mm)
   - tmean (°C)
   - tmin (°C)
   - tmax (°C)

   Aceita formatos comuns:
   A) { monthly: [{month:1, chuva:..., tmin:..., tmed:..., tmax:...}, ...] }
   B) { months: [ {..}, ... ] }
   C) { "1":{...}, "2":{...}, ... } ou { "Jan":{...}, ... }
   D) { series: { rain:[12], tmean:[12], tmin:[12], tmax:[12] } }
*/
function extractMonthlyQuad(raw) {
  const labels = monthLabels();
  const out = {
    rain: new Array(12).fill(null),
    tmean: new Array(12).fill(null),
    tmin: new Array(12).fill(null),
    tmax: new Array(12).fill(null),
  };

  const pickRain = (o) => coerceNumber(findAny(o, ["rain","precip","prec","ppt","prcp","chuva","precip_mm","precip_total","rain_total","P","precipitacao","precipitacao_mm"]));
  const pickTmean = (o) => coerceNumber(findAny(o, ["tmean","tmed","t_med","temp_med","temp_media","temp","temperatura_media","temperature_mean","Tmed","TMEAN"]));
  const pickTmin = (o) => coerceNumber(findAny(o, ["tmin","temp_min","temp_minima","temperatura_minima","temperature_min","Tmin","TMIN"]));
  const pickTmax = (o) => coerceNumber(findAny(o, ["tmax","temp_max","temp_maxima","temperatura_maxima","temperature_max","Tmax","TMAX"]));

  const put = (i, o) => {
    if (i < 0 || i > 11 || !o) return;
    const r = pickRain(o);
    const tm = pickTmean(o);
    const tn = pickTmin(o);
    const tx = pickTmax(o);

    if (r != null) out.rain[i] = r;
    if (tm != null) out.tmean[i] = tm;
    if (tn != null) out.tmin[i] = tn;
    if (tx != null) out.tmax[i] = tx;
  };

  // 1) monthly array
  if (raw && Array.isArray(raw.monthly)) {
    raw.monthly.forEach(row => {
      const mi = findAny(row, ["month","mes","MES","m","i","idx"]);
      const i = clamp((Number(mi) || 0) - 1, 0, 11);
      put(i, row);
    });
    return out;
  }

  // 2) months array
  if (raw && Array.isArray(raw.months)) {
    raw.months.forEach((row, idx) => put(clamp(idx,0,11), row));
    return out;
  }

  // 3) series arrays
  if (raw && raw.series && typeof raw.series === "object") {
    const sr = raw.series;
    const rain = findAny(sr, ["rain","precip","chuva","prcp","ppt"]);
    const tmean = findAny(sr, ["tmean","tmed","temp_med","temp_media"]);
    const tmin = findAny(sr, ["tmin","temp_min","temp_minima"]);
    const tmax = findAny(sr, ["tmax","temp_max","temp_maxima"]);

    if (Array.isArray(rain)) out.rain = rain.slice(0,12).map(coerceNumber);
    if (Array.isArray(tmean)) out.tmean = tmean.slice(0,12).map(coerceNumber);
    if (Array.isArray(tmin)) out.tmin = tmin.slice(0,12).map(coerceNumber);
    if (Array.isArray(tmax)) out.tmax = tmax.slice(0,12).map(coerceNumber);
    return out;
  }

  // 4) objeto por mês: "1".."12"
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw);

    // tenta meses numéricos
    const numericKeys = keys.filter(k => /^\d{1,2}$/.test(k));
    if (numericKeys.length >= 10) {
      numericKeys.forEach(k => {
        const i = clamp(Number(k)-1, 0, 11);
        put(i, raw[k]);
      });
      return out;
    }

    // tenta meses "Jan..Dez" ou "Janeiro.."
    const mapNames = new Map();
    labels.forEach((m, i) => mapNames.set(m.toLowerCase(), i));
    ["janeiro","fevereiro","março","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"]
      .forEach((m, idx) => mapNames.set(m.toLowerCase(), idx));

    keys.forEach(k => {
      const kk = k.toLowerCase();
      if (mapNames.has(kk)) put(mapNames.get(kk), raw[k]);
    });

    return out;
  }

  return out;
}

function summarize({ rain, tmean, tmin, tmax }) {
  const m = monthLabels();

  const vr = rain.map((v,i)=>({v,i})).filter(x=>x.v!=null);
  const vtm = tmean.map((v,i)=>({v,i})).filter(x=>x.v!=null);
  const vtn = tmin.map((v,i)=>({v,i})).filter(x=>x.v!=null);
  const vtx = tmax.map((v,i)=>({v,i})).filter(x=>x.v!=null);

  const rainTotal = vr.length ? vr.reduce((a,x)=>a+x.v,0) : null;
  const rainMean = vr.length ? (rainTotal / vr.length) : null;
  const rainMax = vr.length ? vr.reduce((b,x)=>x.v>b.v?x:b, vr[0]) : null;
  const rainMin = vr.length ? vr.reduce((b,x)=>x.v<b.v?x:b, vr[0]) : null;

  const tMeanYear = vtm.length ? vtm.reduce((a,x)=>a+x.v,0)/vtm.length : null;
  const tMinYear = vtn.length ? Math.min(...vtn.map(x=>x.v)) : (vtm.length ? Math.min(...vtm.map(x=>x.v)) : null);
  const tMaxYear = vtx.length ? Math.max(...vtx.map(x=>x.v)) : (vtm.length ? Math.max(...vtm.map(x=>x.v)) : null);

  const hot = vtx.length ? vtx.reduce((b,x)=>x.v>b.v?x:b, vtx[0]) : (vtm.length ? vtm.reduce((b,x)=>x.v>b.v?x:b, vtm[0]) : null);
  const cool = vtn.length ? vtn.reduce((b,x)=>x.v<b.v?x:b, vtn[0]) : (vtm.length ? vtm.reduce((b,x)=>x.v<b.v?x:b, vtm[0]) : null);

  const quality = {
    rain: vr.length,
    tmean: vtm.length,
    tmin: vtn.length,
    tmax: vtx.length
  };

  return {
    rainTotal, rainMean, rainMax, rainMin,
    tMeanYear, tMinYear, tMaxYear,
    wetMonth: rainMax ? rainMax.i : null,
    wetVal: rainMax ? rainMax.v : null,
    dryMonth: rainMin ? rainMin.i : null,
    dryVal: rainMin ? rainMin.v : null,
    hotMonth: hot ? hot.i : null,
    hotVal: hot ? hot.v : null,
    coolMonth: cool ? cool.i : null,
    coolVal: cool ? cool.v : null,
    qualityText: `rain ${quality.rain}/12 • tmed ${quality.tmean}/12 • tmin ${quality.tmin}/12 • tmax ${quality.tmax}/12`,
    monthName: (i)=> (i==null? "—" : m[i])
  };
}

async function loadStationYear(id, year) {
  const key = `${id}-${year}`;
  if (state.cacheYearData.has(key)) return state.cacheYearData.get(key);

  const raw = await loadJSON(`assets/data/${id}/${year}.json`);
  const quad = extractMonthlyQuad(raw);
  const sum = summarize(quad);

  const payload = { raw, ...quad, summary: sum };
  state.cacheYearData.set(key, payload);
  return payload;
}

/* ========= CHART =========
   - Barras: chuva
   - Linha: T med
   - Faixa: entre T min e T max (band)
*/
function ensureChart() {
  if (state.chart) return;

  const ctx = $("#chart").getContext("2d");
  const labels = monthLabels();

  state.chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        // Chuva
        {
          type: "bar",
          label: "Precipitação (mm)",
          data: new Array(12).fill(null),
          yAxisID: "yRain",
          backgroundColor: "rgba(45, 125, 246, .85)",
          borderRadius: 8,
          barPercentage: 0.75,
          categoryPercentage: 0.75,
        },

        // TMAX (linha superior da faixa)
        {
          type: "line",
          label: "T máx (°C)",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 122, 80, .95)",
          backgroundColor: "rgba(255, 122, 80, .10)",
          pointRadius: 2,
          tension: 0.25,
          fill: false
        },

        // TMIN (linha inferior, preenchendo até a TMAX)
        {
          type: "line",
          label: "Faixa T min–T máx",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 122, 80, .25)",
          backgroundColor: "rgba(255, 122, 80, .14)",
          pointRadius: 0,
          tension: 0.25,
          fill: { target: 1 } // preenche até dataset index 1 (TMAX)
        },

        // TMED
        {
          type: "line",
          label: "T méd (°C)",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 92, 92, .95)",
          backgroundColor: "rgba(255, 92, 92, .10)",
          pointRadius: 3,
          pointHoverRadius: 6,
          tension: 0.25,
          fill: false
        },
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
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "xy" },
          pan: { enabled: true, mode: "xy" }
        }
      },
      scales: {
        yRain: {
          position: "left",
          title: { display: true, text: "Precipitação (mm)" },
          grid: { color: "rgba(15,23,42,.08)" },
          beginAtZero: true
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

  $("#chart").addEventListener("dblclick", () => state.chart?.resetZoom?.());
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
  $("#kRainMean").textContent = sum.rainMean == null ? "—" : `${fmt1(sum.rainMean)} mm`;
  $("#kRainMax").textContent = sum.rainMax == null ? "—" : `${sum.monthName(sum.rainMax.i)} • ${fmt1(sum.rainMax.v)} mm`;
  $("#kRainMin").textContent = sum.rainMin == null ? "—" : `${sum.monthName(sum.rainMin.i)} • ${fmt1(sum.rainMin.v)} mm`;
  $("#kQuality").textContent = sum.qualityText;

  const html = `
    <div class="item"><span class="badge">📌</span><div><b>${escapeHTML(id)}</b> • <b>${escapeHTML(String(year))}</b></div></div>
    <div class="item"><span class="badge">🌧️</span><div><b>Mês mais chuvoso:</b> ${sum.wetMonth==null? "—" : `${sum.monthName(sum.wetMonth)} (${fmt1(sum.wetVal)} mm)`}</div></div>
    <div class="item"><span class="badge">🏜️</span><div><b>Mês mais seco:</b> ${sum.dryMonth==null? "—" : `${sum.monthName(sum.dryMonth)} (${fmt1(sum.dryVal)} mm)`}</div></div>
    <div class="item"><span class="badge">🔥</span><div><b>Mês mais quente:</b> ${sum.hotMonth==null? "—" : `${sum.monthName(sum.hotMonth)} (${fmt1(sum.hotVal)} °C)`}</div></div>
    <div class="item"><span class="badge">❄️</span><div><b>Mês mais fresco:</b> ${sum.coolMonth==null? "—" : `${sum.monthName(sum.coolMonth)} (${fmt1(sum.coolVal)} °C)`}</div></div>
  `;
  $("#summary").innerHTML = html;

  ensureChart();
  // dataset[0] chuva
  state.chart.data.datasets[0].data = payload.rain.map(v => v == null ? null : Number(v));
  // dataset[1] tmax
  state.chart.data.datasets[1].data = payload.tmax.map(v => v == null ? null : Number(v));
  // dataset[2] tmin (faixa)
  state.chart.data.datasets[2].data = payload.tmin.map(v => v == null ? null : Number(v));
  // dataset[3] tmed
  state.chart.data.datasets[3].data = payload.tmean.map(v => v == null ? null : Number(v));

  state.chart.update();
}

async function selectStation(id, fromMap=false) {
  state.selectedStationId = id;
  renderList();

  const s = state.stations.find(x => x.id === id);
  if (s && state.map) {
    state.map.panTo([s.lat, s.lon], { animate: true });
    if (fromMap) state.map.setZoom(Math.max(state.map.getZoom(), 7));
  }

  const year = state.selectedYear;
  if (!year) return;

  try {
    setStatus(`Carregando ${id}/${year}…`);
    const payload = await loadStationYear(id, year);

    // se está tudo null, mostra diagnóstico claro
    const anyData =
      payload.rain.some(v=>v!=null) ||
      payload.tmean.some(v=>v!=null) ||
      payload.tmin.some(v=>v!=null) ||
      payload.tmax.some(v=>v!=null);

    if (!anyData) {
      setStatus("Dados não reconhecidos");
      $("#summary").innerHTML = `
        <div class="muted">
          Carreguei o arquivo, mas não consegui reconhecer os campos mensais.<br><br>
          <b>Dica:</b> abra este JSON e veja se tem algo como <code>monthly</code>, <code>months</code>, <code>series</code> ou meses <code>1..12</code>/<code>Jan..Dez</code>.<br>
          Arquivo: <code>assets/data/${escapeHTML(id)}/${escapeHTML(String(year))}.json</code>
        </div>
      `;
      return;
    }

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
    renderCount(); renderList(); renderMarkers();
  });

  $("#clearQ").addEventListener("click", () => {
    $("#q").value = "";
    state.filtered = filterStations("");
    renderCount(); renderList(); renderMarkers();
  });

  $("#yearSel").addEventListener("change", async () => {
    state.selectedYear = Number($("#yearSel").value);
    if (state.selectedStationId) await selectStation(state.selectedStationId);
  });

  $("#btnAll").addEventListener("click", () => {
    $("#q").value = "";
    state.filtered = [...state.stations];
    renderCount(); renderList(); renderMarkers();
    focusToFiltered();
  });

  $("#btnFocus").addEventListener("click", () => focusToFiltered());

  $("#list").addEventListener("click", (ev) => {
    const card = ev.target.closest(".station");
    if (!card) return;
    const id = card.getAttribute("data-id");
    if (id) selectStation(id, false);
  });

  $("#btnResetZoom").addEventListener("click", () => state.chart?.resetZoom?.());

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

      const rows = [["station_id","year","month","precip_mm","tmin_c","tmean_c","tmax_c"]];
      for (let i=0;i<12;i++){
        rows.push([
          id, String(year), labels[i],
          payload.rain[i] ?? "",
          payload.tmin[i] ?? "",
          payload.tmean[i] ?? "",
          payload.tmax[i] ?? "",
        ]);
      }

      const csv = rows.map(r => r.map(cell => {
        const v = String(cell ?? "");
        if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replaceAll('"','""')}"`;
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

async function main() {
  try {
    setStatus("Carregando estações…");
    const stRaw = await loadJSON("assets/stations.json");
    const yrRaw = await loadJSON("assets/years.json");

    state.stations = parseStations(stRaw);
    state.years = parseYears(yrRaw);

    if (!state.stations.length) throw new Error("stations.json carregou, mas não encontrei estações válidas (id/lat/lon).");
    if (!state.years.length) state.years = [2023, 2024];

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
        Verifique:
        <ul>
          <li><code>${escapeHTML(BASE)}assets/stations.json</code></li>
          <li><code>${escapeHTML(BASE)}assets/years.json</code></li>
        </ul>
        <b>Detalhe:</b> ${escapeHTML(e.message)}
      </div>
    `;
  }
}

setupEvents();
main();
