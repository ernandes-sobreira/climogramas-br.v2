const $ = (sel) => document.querySelector(sel);

const state = {
  stations: [],
  filtered: [],
  years: [],
  selectedYear: null,
  selectedStationId: null,
  map: null,
  cluster: null,
  markerById: new Map(),
  chart: null,
  cache: new Map(),      // `${id}-${year}` => parsed
  yearExistCache: new Map(), // url => boolean
  yearsByStation: new Map(), // id => years[]
};

function computeBase() {
  const p = window.location.pathname;
  return p.endsWith("/") ? p : p.substring(0, p.lastIndexOf("/") + 1);
}
const BASE = computeBase();

function setStatus(msg) { $("#status").textContent = msg; }
function setDebug(msg) { $("#debug").textContent = msg || ""; }

function escapeHTML(str) {
  return String(str)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function fmt1(x){ if(x==null||Number.isNaN(x)) return "—"; return (Math.round(x*10)/10).toFixed(1); }
function coerceNumber(v){
  if(v==null) return null;
  const s = String(v).trim();
  if(!s) return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return await res.json();
}
async function loadJSON(path) { return fetchJSON(BASE + path.replace(/^\.\//,"")); }

async function headExists(path) {
  const url = BASE + path.replace(/^\.\//,"");
  if (state.yearExistCache.has(url)) return state.yearExistCache.get(url);

  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-cache" });
    const ok = res.ok;
    state.yearExistCache.set(url, ok);
    return ok;
  } catch {
    state.yearExistCache.set(url, false);
    return false;
  }
}

function monthLabels(){ return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]; }

function normalizeStation(s) {
  const id = (s.id || s.ID || s.codigo || s.station_id || s.wmo || s.WMO || "").toString().trim();
  const name = (s.nome || s.name || s.estacao || s.ESTACAO || s.station || "").toString().trim();
  const uf = (s.uf || s.UF || s.estado || s.state || "").toString().trim();
  const latRaw = (s.lat ?? s.latitude ?? s.LATITUDE ?? s.Latitude ?? s.y);
  const lonRaw = (s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE ?? s.Longitude ?? s.x);
  const lat = parseFloat(String(latRaw).replace(",", "."));
  const lon = parseFloat(String(lonRaw).replace(",", "."));
  return { ...s, id, name, uf, lat, lon };
}
function parseStations(stRaw) {
  let arr = [];
  if (Array.isArray(stRaw)) arr = stRaw;
  else if (stRaw?.stations && Array.isArray(stRaw.stations)) arr = stRaw.stations;
  else if (stRaw?.data && Array.isArray(stRaw.data)) arr = stRaw.data;
  else if (stRaw && typeof stRaw === "object") arr = Object.entries(stRaw).map(([id, obj]) => ({ id, ...(obj||{}) }));

  const norm = arr.map(normalizeStation).filter(s => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  norm.sort((a,b) => (a.uf+a.name).localeCompare(b.uf+b.name, "pt-BR"));
  return norm;
}

function buildYears() {
  // ✅ SEMPRE 2000..2024 (nunca depende do years.json)
  const out = [];
  for (let y=2000; y<=2024; y++) out.push(y);
  return out;
}

function renderYears() {
  const sel = $("#yearSel");
  sel.innerHTML = "";
  state.years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  });
  state.selectedYear = 2024; // padrão
  sel.value = "2024";
}

function filterStations(q) {
  const t = (q || "").trim().toLowerCase();
  if (!t) return [...state.stations];
  return state.stations.filter(s => (`${s.id} ${s.name} ${s.uf}`).toLowerCase().includes(t));
}

function stationCardHTML(s, active=false) {
  const title = `${s.name || "SEM NOME"} (${s.uf || "—"})`;
  return `
    <div class="station ${active ? "active":""}" data-id="${escapeHTML(s.id)}">
      <div class="stationName">${escapeHTML(title)}</div>
      <div class="stationMeta">
        <span>ID ${escapeHTML(s.id)}</span>
        <span>${escapeHTML(fmt1(s.lat))}, ${escapeHTML(fmt1(s.lon))}</span>
      </div>
    </div>
  `;
}

function renderList() {
  $("#list").innerHTML = state.filtered.map(s => stationCardHTML(s, s.id === state.selectedStationId)).join("");
  $("#countInfo").textContent = `${state.filtered.length} estações`;
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
  state.markerById.clear();

  state.filtered.forEach(s => {
    const marker = L.marker([s.lat, s.lon], { title: `${s.name} (${s.uf})` });
    marker.on("click", () => selectStation(s.id, true));
    marker.bindTooltip(`${escapeHTML(s.name)} (${escapeHTML(s.uf)})<br><b>${escapeHTML(s.id)}</b>`, { sticky: true });
    state.cluster.addLayer(marker);
    state.markerById.set(s.id, marker);
  });
}

function focusToFiltered() {
  ensureMap();
  const pts = state.filtered.map(s => [s.lat, s.lon]);
  if (!pts.length) return;
  state.map.fitBounds(L.latLngBounds(pts).pad(0.12));
}

/* ===================== DADOS: parser robusto (inclui precip INMET) ===================== */

function findAny(obj, keys) {
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  return undefined;
}

function extractMonthlyQuad(raw) {
  const out = {
    rain: new Array(12).fill(null),
    tmean: new Array(12).fill(null),
    tmin: new Array(12).fill(null),
    tmax: new Array(12).fill(null),
  };

  // ✅ precip tem muitos nomes no INMET
  const pickRain = (o) => coerceNumber(findAny(o, [
    "rain","precip","prec","ppt","prcp","chuva","precipitacao","precipitacao_mm",
    "PRECIPITACAO","PRECIPITACAO_TOTAL","PRECIPITACAO_TOTAL_MENSAL","PRECIP_TOTAL",
    "prec_total","prec_total_mm","pr","P","RR","rr","CHUVA_TOTAL"
  ]));

  const pickTmean = (o) => coerceNumber(findAny(o, [
    "tmean","tmed","temp_med","temp_media","temperatura_media","temp",
    "TEMPERATURA_MEDIA","TEMP_MEDIA","T_MED"
  ]));

  const pickTmin = (o) => coerceNumber(findAny(o, [
    "tmin","temp_min","temp_minima","temperatura_minima",
    "TEMPERATURA_MINIMA","TEMP_MIN","T_MIN"
  ]));

  const pickTmax = (o) => coerceNumber(findAny(o, [
    "tmax","temp_max","temp_maxima","temperatura_maxima",
    "TEMPERATURA_MAXIMA","TEMP_MAX","T_MAX"
  ]));

  const put = (i, o) => {
    if (i<0 || i>11 || !o) return;
    const r  = pickRain(o);
    const tm = pickTmean(o);
    const tn = pickTmin(o);
    const tx = pickTmax(o);
    if (r  != null) out.rain[i]  = r;
    if (tm != null) out.tmean[i] = tm;
    if (tn != null) out.tmin[i]  = tn;
    if (tx != null) out.tmax[i]  = tx;
  };

  // monthly array
  if (Array.isArray(raw?.monthly)) {
    raw.monthly.forEach(row => {
      const mi = Number(findAny(row, ["month","mes","m","i","idx"])) || 0;
      put(clamp(mi-1,0,11), row);
    });
    return out;
  }

  // months array
  if (Array.isArray(raw?.months)) {
    raw.months.forEach((row, idx) => put(idx, row));
    return out;
  }

  // series arrays
  if (raw?.series && typeof raw.series === "object") {
    const sr = raw.series;
    const rain  = findAny(sr, ["rain","precip","chuva","prcp","ppt","PRECIPITACAO_TOTAL","RR"]);
    const tmean = findAny(sr, ["tmean","tmed","temp_med","temp_media","TEMPERATURA_MEDIA"]);
    const tmin  = findAny(sr, ["tmin","temp_min","temp_minima","TEMPERATURA_MINIMA"]);
    const tmax  = findAny(sr, ["tmax","temp_max","temp_maxima","TEMPERATURA_MAXIMA"]);
    if (Array.isArray(rain))  out.rain  = rain.slice(0,12).map(coerceNumber);
    if (Array.isArray(tmean)) out.tmean = tmean.slice(0,12).map(coerceNumber);
    if (Array.isArray(tmin))  out.tmin  = tmin.slice(0,12).map(coerceNumber);
    if (Array.isArray(tmax))  out.tmax  = tmax.slice(0,12).map(coerceNumber);
    return out;
  }

  // objeto 1..12
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    const numericKeys = keys.filter(k => /^\d{1,2}$/.test(k));
    if (numericKeys.length >= 10) {
      numericKeys.forEach(k => put(clamp(Number(k)-1,0,11), raw[k]));
      return out;
    }
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
  const rainMean  = vr.length ? rainTotal/vr.length : null;
  const rainMax   = vr.length ? vr.reduce((b,x)=>x.v>b.v?x:b, vr[0]) : null;
  const rainMin   = vr.length ? vr.reduce((b,x)=>x.v<b.v?x:b, vr[0]) : null;

  const tMeanYear = vtm.length ? vtm.reduce((a,x)=>a+x.v,0)/vtm.length : null;
  const tMinYear  = (vtn.length ? Math.min(...vtn.map(x=>x.v)) : (vtm.length ? Math.min(...vtm.map(x=>x.v)) : null));
  const tMaxYear  = (vtx.length ? Math.max(...vtx.map(x=>x.v)) : (vtm.length ? Math.max(...vtm.map(x=>x.v)) : null));

  const hot  = vtx.length ? vtx.reduce((b,x)=>x.v>b.v?x:b, vtx[0]) : (vtm.length ? vtm.reduce((b,x)=>x.v>b.v?x:b, vtm[0]) : null);
  const cool = vtn.length ? vtn.reduce((b,x)=>x.v<b.v?x:b, vtn[0]) : (vtm.length ? vtm.reduce((b,x)=>x.v<b.v?x:b, vtm[0]) : null);

  return {
    rainTotal, rainMean, rainMax, rainMin,
    tMeanYear, tMinYear, tMaxYear,
    wetMonth: rainMax?.i ?? null, wetVal: rainMax?.v ?? null,
    dryMonth: rainMin?.i ?? null, dryVal: rainMin?.v ?? null,
    hotMonth: hot?.i ?? null, hotVal: hot?.v ?? null,
    coolMonth: cool?.i ?? null, coolVal: cool?.v ?? null,
    qualityText: `rain ${vr.length}/12 • tmed ${vtm.length}/12 • tmin ${vtn.length}/12 • tmax ${vtx.length}/12`,
    monthName: (i)=> (i==null? "—" : m[i])
  };
}

async function loadStationYear(id, year) {
  const key = `${id}-${year}`;
  if (state.cache.has(key)) return state.cache.get(key);

  const candidates = [
    `assets/data/${id}/${year}.json`,
    `assets/data/${year}/${id}.json`,
    `assets/data/${year}.json`,     // arquivo único por ano
    `assets/${year}.json`,
    `assets/data/inmet_${year}.json`,
  ];

  let raw = null;
  let used = null;

  for (const p of candidates) {
    try {
      raw = await loadJSON(p);
      used = p;
      break;
    } catch {}
  }
  if (!raw) throw new Error(`Não encontrei ${id}/${year}.\nTentei:\n- ${candidates.join("\n- ")}`);

  // se for arquivo único por ano, tenta por id
  let payloadRaw = raw;
  if (!Array.isArray(raw) && typeof raw === "object") {
    const byId =
      raw[id] ??
      raw?.stations?.[id] ??
      raw?.data?.[id] ??
      raw?.estacoes?.[id] ??
      raw?.seriesByStation?.[id];
    if (byId && typeof byId === "object") payloadRaw = byId;
  }

  const quad = extractMonthlyQuad(payloadRaw);
  const sum = summarize(quad);

  const anyData =
    quad.rain.some(v=>v!=null) ||
    quad.tmean.some(v=>v!=null) ||
    quad.tmin.some(v=>v!=null) ||
    quad.tmax.some(v=>v!=null);

  const result = { ...quad, summary: sum, sourcePath: used, anyData };
  state.cache.set(key, result);
  return result;
}

/* ===================== DETECÇÃO DE ANOS DISPONÍVEIS (rápida) ===================== */

async function detectYearsForStation(id) {
  if (state.yearsByStation.has(id)) return state.yearsByStation.get(id);

  // detecção “barata”: testa padrões station/year (HEAD)
  const yearsFound = [];
  for (const y of state.years) {
    const ok1 = await headExists(`assets/data/${id}/${y}.json`);
    const ok2 = ok1 ? true : await headExists(`assets/data/${y}/${id}.json`);
    if (ok1 || ok2) yearsFound.push(y);
  }

  // se não achou nada nesses padrões, informa como “não detectado”
  state.yearsByStation.set(id, yearsFound);
  return yearsFound;
}

/* ===================== CHART (com médias horizontais) ===================== */

function ensureChart() {
  if (state.chart) return;

  // ✅ registra plugin corretamente (resolve “reset zoom não funciona”)
  const zoomPlugin = window.ChartZoom || window['chartjs-plugin-zoom'];
  if (zoomPlugin) Chart.register(zoomPlugin);

  const ctx = $("#chart").getContext("2d");

  state.chart = new Chart(ctx, {
    data: {
      labels: monthLabels(),
      datasets: [
        // chuva
        {
          type: "bar",
          label: "Precipitação (mm)",
          data: new Array(12).fill(null),
          yAxisID: "yRain",
          backgroundColor: "rgba(45, 125, 246, .80)",
          borderRadius: 8,
        },
        // linha média chuva (horizontal)
        {
          type: "line",
          label: "Média chuva (mês)",
          data: new Array(12).fill(null),
          yAxisID: "yRain",
          borderColor: "rgba(45, 125, 246, .35)",
          pointRadius: 0,
          tension: 0,
        },

        // tmax
        {
          type: "line",
          label: "T máx (°C)",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 122, 80, .95)",
          pointRadius: 2,
          tension: 0.25,
          fill: false
        },
        // faixa tmin (para preencher até tmax)
        {
          type: "line",
          label: "Faixa T min–T máx",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 122, 80, .18)",
          backgroundColor: "rgba(255, 122, 80, .12)",
          pointRadius: 0,
          tension: 0.25,
          fill: { target: 2 } // preenche até o dataset de T máx
        },
        // tmed
        {
          type: "line",
          label: "T méd (°C)",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 92, 92, .95)",
          pointRadius: 3,
          pointHoverRadius: 6,
          tension: 0.25,
          fill: false
        },
        // linha média anual de temp (horizontal)
        {
          type: "line",
          label: "Média anual (T méd)",
          data: new Array(12).fill(null),
          yAxisID: "yTemp",
          borderColor: "rgba(255, 92, 92, .35)",
          pointRadius: 0,
          tension: 0
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "xy" },
          pan: { enabled: true, mode: "xy" }
        }
      },
      scales: {
        yRain: { position: "left", title: { display: true, text: "Precipitação (mm)" }, beginAtZero: true },
        yTemp: { position: "right", title: { display: true, text: "Temperatura (°C)" }, grid: { drawOnChartArea: false } },
        x: { grid: { display: false } }
      }
    }
  });

  $("#chart").addEventListener("dblclick", () => state.chart?.resetZoom?.());
}

function setStationHeader(s) {
  $("#stationTitle").textContent = `${s.name} (${s.uf})`;
  $("#stationMeta").textContent = `ID ${s.id} • ${fmt1(s.lat)}, ${fmt1(s.lon)}`;
}

function applyToUI(id, year, data) {
  const s = state.stations.find(x => x.id === id);
  if (!s) return;

  setStationHeader(s);

  const sum = data.summary;

  $("#kTmin").textContent  = sum.tMinYear==null ? "—" : `${fmt1(sum.tMinYear)} °C`;
  $("#kTmean").textContent = sum.tMeanYear==null ? "—" : `${fmt1(sum.tMeanYear)} °C`;
  $("#kTmax").textContent  = sum.tMaxYear==null ? "—" : `${fmt1(sum.tMaxYear)} °C`;

  $("#kRain").textContent     = sum.rainTotal==null ? "—" : `${fmt1(sum.rainTotal)} mm`;
  $("#kRainMean").textContent = sum.rainMean==null ? "—" : `${fmt1(sum.rainMean)} mm`;
  $("#kRainMax").textContent  = sum.rainMax==null ? "—" : `${sum.monthName(sum.rainMax.i)} • ${fmt1(sum.rainMax.v)} mm`;
  $("#kRainMin").textContent  = sum.rainMin==null ? "—" : `${sum.monthName(sum.rainMin.i)} • ${fmt1(sum.rainMin.v)} mm`;
  $("#kQuality").textContent  = sum.qualityText;

  $("#summary").innerHTML = `
    <div class="item"><span class="badge">📌</span><div><b>${escapeHTML(id)}</b> • <b>${escapeHTML(String(year))}</b></div></div>
    <div class="item"><span class="badge">🌧️</span><div><b>Mês mais chuvoso:</b> ${sum.wetMonth==null? "—" : `${sum.monthName(sum.wetMonth)} (${fmt1(sum.wetVal)} mm)`}</div></div>
    <div class="item"><span class="badge">🏜️</span><div><b>Mês mais seco:</b> ${sum.dryMonth==null? "—" : `${sum.monthName(sum.dryMonth)} (${fmt1(sum.dryVal)} mm)`}</div></div>
    <div class="item"><span class="badge">🔥</span><div><b>Mês mais quente:</b> ${sum.hotMonth==null? "—" : `${sum.monthName(sum.hotMonth)} (${fmt1(sum.hotVal)} °C)`}</div></div>
    <div class="item"><span class="badge">❄️</span><div><b>Mês mais fresco:</b> ${sum.coolMonth==null? "—" : `${sum.monthName(sum.coolMonth)} (${fmt1(sum.coolVal)} °C)`}</div></div>
  `;

  ensureChart();

  // dados
  const rain = data.rain.map(v => v==null? null : Number(v));
  const tmax = data.tmax.map(v => v==null? null : Number(v));
  const tmin = data.tmin.map(v => v==null? null : Number(v));
  const tmed = data.tmean.map(v => v==null? null : Number(v));

  // linhas de média horizontais
  const rainMeanLine = (sum.rainMean==null) ? new Array(12).fill(null) : new Array(12).fill(Number(sum.rainMean));
  const tMeanLine    = (sum.tMeanYear==null) ? new Array(12).fill(null) : new Array(12).fill(Number(sum.tMeanYear));

  // aplica no chart
  state.chart.data.datasets[0].data = rain;          // bar
  state.chart.data.datasets[1].data = rainMeanLine;  // média chuva
  state.chart.data.datasets[2].data = tmax;          // tmax
  state.chart.data.datasets[3].data = tmin;          // faixa (tmin)
  state.chart.data.datasets[4].data = tmed;          // tmed
  state.chart.data.datasets[5].data = tMeanLine;     // média anual temp

  state.chart.update();

  setDebug(`Fonte: ${data.sourcePath}${data.anyData ? "" : "\n⚠️ Carregou arquivo, mas não reconheci os campos mensais."}`);
}

/* ===================== SELEÇÃO + ZOOM GARANTIDO ===================== */

async function selectStation(id, fromMap=false) {
  state.selectedStationId = id;
  renderList();

  const s = state.stations.find(x => x.id === id);

  // ✅ zoom/centralização “na marra”: flyTo + fallback setView
  if (s && state.map) {
    const targetZoom = 10;

    try {
      state.map.flyTo([s.lat, s.lon], targetZoom, { animate: true, duration: 0.8 });
    } catch {}

    // fallback (garante mesmo se fly falhar)
    setTimeout(() => {
      try { state.map.setView([s.lat, s.lon], targetZoom, { animate: false }); } catch {}
    }, 900);

    const mk = state.markerById.get(id);
    if (mk) setTimeout(() => { try { mk.openTooltip(); } catch{} }, 450);

    const el = document.querySelector(`.station[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // fecha drawer no mobile após selecionar
  closeDrawer();

  // anos disponíveis (detecção)
  $("#yearsAvail").textContent = "Detectando…";
  detectYearsForStation(id).then(yrs => {
    $("#yearsAvail").textContent = yrs.length
      ? yrs.join(", ")
      : "Não detectado pelos padrões (pode estar em arquivo único por ano).";
  });

  const year = state.selectedYear;
  if (!year) return;

  try {
    setStatus(`Carregando ${id}/${year}…`);
    const data = await loadStationYear(id, year);
    applyToUI(id, year, data);
    setStatus("Pronto ✅");
  } catch (e) {
    console.error(e);
    setStatus("Erro ao carregar dados");
    setDebug(e.message);

    // limpa UI
    $("#kTmin").textContent = $("#kTmean").textContent = $("#kTmax").textContent = "—";
    $("#kRain").textContent = $("#kRainMean").textContent = $("#kRainMax").textContent = $("#kRainMin").textContent = "—";
    $("#kQuality").textContent = "—";
    $("#summary").innerHTML = `<div class="muted">Não encontrei dados dessa estação/ano.</div>`;

    ensureChart();
    state.chart.data.datasets.forEach(d => d.data = new Array(12).fill(null));
    state.chart.update();
  }
}

/* ===================== EXPORTS ===================== */

function exportPNG() {
  if (!state.chart) return;
  const a = document.createElement("a");
  const id = state.selectedStationId || "station";
  const year = state.selectedYear || "year";
  a.download = `climograma_${id}_${year}.png`;
  a.href = state.chart.toBase64Image("image/png", 1);
  a.click();
}

async function exportCSV() {
  const id = state.selectedStationId;
  const year = state.selectedYear;
  if (!id || !year) return;

  const data = await loadStationYear(id, year);
  const labels = monthLabels();

  const rows = [["station_id","year","month","precip_mm","tmin_c","tmean_c","tmax_c"]];
  for (let i=0;i<12;i++){
    rows.push([id, String(year), labels[i], data.rain[i] ?? "", data.tmin[i] ?? "", data.tmean[i] ?? "", data.tmax[i] ?? ""]);
  }
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? "");
    return (s.includes(",")||s.includes('"')||s.includes("\n")) ? `"${s.replaceAll('"','""')}"` : s;
  }).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `climograma_${id}_${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================== DRAWER (mobile) ===================== */

function openDrawer(){
  $("#leftPanel").classList.add("open");
  $("#backdrop").classList.add("show");
}
function closeDrawer(){
  $("#leftPanel").classList.remove("open");
  $("#backdrop").classList.remove("show");
}

/* ===================== EVENTS ===================== */

function setupEvents() {
  $("#q").addEventListener("input", () => {
    state.filtered = filterStations($("#q").value);
    renderList(); renderMarkers();
  });
  $("#clearQ").addEventListener("click", () => {
    $("#q").value = "";
    state.filtered = filterStations("");
    renderList(); renderMarkers();
  });

  $("#yearSel").addEventListener("change", async () => {
    state.selectedYear = Number($("#yearSel").value);
    if (state.selectedStationId) await selectStation(state.selectedStationId);
  });

  $("#btnAll").addEventListener("click", () => {
    $("#q").value = "";
    state.filtered = [...state.stations];
    renderList(); renderMarkers();
    focusToFiltered();
  });

  $("#btnFocus").addEventListener("click", () => focusToFiltered());

  $("#btnResetZoom").addEventListener("click", () => {
    if (state.chart?.resetZoom) state.chart.resetZoom();
  });

  $("#btnPNG").addEventListener("click", exportPNG);
  $("#btnCSV").addEventListener("click", exportCSV);

  $("#list").addEventListener("click", (ev) => {
    const card = ev.target.closest(".station");
    if (!card) return;
    const id = card.getAttribute("data-id");
    if (id) selectStation(id, false);
  });

  // drawer
  $("#btnDrawer").addEventListener("click", openDrawer);
  $("#btnCloseDrawer").addEventListener("click", closeDrawer);
  $("#backdrop").addEventListener("click", closeDrawer);
}

/* ===================== INIT ===================== */

async function main() {
  try {
    setStatus("Carregando…");
    ensureMap();
    ensureChart();

    const stRaw = await loadJSON("assets/stations.json");
    state.stations = parseStations(stRaw);
    if (!state.stations.length) throw new Error("stations.json não tem estações válidas (id/lat/lon).");

    state.years = buildYears();
    renderYears();

    state.filtered = [...state.stations];
    renderList();
    renderMarkers();
    focusToFiltered();

    setStatus("Pronto ✅");
    setDebug("");

  } catch (e) {
    console.error(e);
    setStatus("Erro");
    setDebug(e.message);
  }
}

setupEvents();
main();
