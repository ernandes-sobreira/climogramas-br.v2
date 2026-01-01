const $ = (id) => document.getElementById(id);

const ufSelect = $("ufSelect");
const stationSelect = $("stationSelect");
const searchStation = $("searchStation");
const yearStart = $("yearStart");
const yearEnd = $("yearEnd");

const tabMonthly = $("tabMonthly");
const tabAnnual = $("tabAnnual");
const tabMonthSeries = $("tabMonthSeries");
const tabRelations = $("tabRelations");

const var1 = $("var1");
const var2 = $("var2");

const optMinMax = $("optMinMax");
const optMean = $("optMean");
const optPrecBars = $("optPrecBars");

const btnRender = $("btnRender");
const btnPNG = $("btnPNG");
const btnCSV = $("btnCSV");
const btnReset = $("btnReset");

const pillStation = $("pillStation");
const pillYears = $("pillYears");
const pillData = $("pillData");

const msg = $("msg");
const stationHint = $("stationHint");
const chartTitle = $("chartTitle");
const chartMeta = $("chartMeta");
const kpis = $("kpis");
const subPanel = $("subPanel");

const table = $("table");
const thead = table.querySelector("thead");
const tbody = table.querySelector("tbody");
const tableHint = $("tableHint");

let MAP, markersLayer;
let STATIONS = [];
let YEARS_INDEX = null;
let selectedStation = null;
let selectedUF = "ALL";
let mode = "monthly";

let chart = null;
let lastTableRows = [];
let lastChartTitle = "";
const CACHE = new Map();

/** 🔥 Base URL robusta no GitHub Pages */
const BASE = new URL("./", window.location.href).href;
const pathOf = (p) => new URL(p, BASE).href;

function setMsg(text, type="ok"){
  msg.textContent = text;
  msg.style.color = type==="bad" ? "rgb(251,113,133)" :
                    type==="warn" ? "rgb(251,191,36)" :
                    "rgba(170,182,214,1)";
}
function fmt(n, digits=2){
  if (!Number.isFinite(n)) return "—";
  const p = Math.pow(10, digits);
  return (Math.round(n*p)/p).toString();
}
function safeLower(s){ return String(s||"").toLowerCase(); }
function parseNum(v){
  if (v===null || v===undefined) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return NaN;
  const z = s.replace(/\./g,"").replace(",",".");
  const n = Number(z);
  return Number.isFinite(n) ? n : NaN;
}
function parseDateSmart(v){
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  if (m){
    const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    return isNaN(d) ? null : d;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m){
    let y = Number(m[3]); if (y < 100) y += 2000;
    const d = new Date(y, Number(m[2])-1, Number(m[1]));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function ymd(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function monthKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}
function pearson(x, y){
  const pts = [];
  for (let i=0;i<x.length;i++){
    const a = x[i], b = y[i];
    if (Number.isFinite(a) && Number.isFinite(b)) pts.push([a,b]);
  }
  const n = pts.length;
  if (n < 3) return { r: NaN, n };
  let sx=0, sy=0;
  for (const [a,b] of pts){ sx+=a; sy+=b; }
  const mx = sx/n, my = sy/n;
  let sxx=0, syy=0, sxy=0;
  for (const [a,b] of pts){
    const dx = a-mx, dy = b-my;
    sxx += dx*dx; syy += dy*dy; sxy += dx*dy;
  }
  const denom = Math.sqrt(sxx*syy);
  return { r: denom ? (sxy/denom) : NaN, n };
}
function downloadBlob(filename, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

const KEY_PATTERNS = {
  date:[/^(data|date)$/i,/data/i],
  hour:[/hora/i,/utc/i],
  prec:[/precip/i,/chuva/i,/prec/i],
  temp:[/temp/i,/temper/i],
  tmin:[/temp.*min/i,/(mín|min).*(temp|temper)/i],
  tmax:[/temp.*max/i,/(máx|max).*(temp|temper)/i],
  press:[/press/i,/atm/i,/mB/i,/hpa/i],
  rad:[/rad/i,/radiac/i,/global/i,/kj\/m/i,/w\/m/i],
  hum:[/umid/i,/humidity/i],
  wind:[/vento/i,/wind/i],
};
function pickKey(obj, kind){
  const keys = Object.keys(obj||{});
  const patterns = KEY_PATTERNS[kind] || [];
  for (const p of patterns){
    const found = keys.find(k => p.test(k));
    if (found) return found;
  }
  return null;
}
function buildVariableCatalog(sampleRow){
  const base = [
    { id:"temp",  label:"Temperatura (°C)" },
    { id:"prec",  label:"Precipitação (mm)" },
    { id:"press", label:"Pressão (mB/hPa)" },
    { id:"rad",   label:"Radiação" },
    { id:"hum",   label:"Umidade (%)" },
    { id:"wind",  label:"Vento (m/s)" },
  ];
  const found = new Set(["temp","prec"]);
  if (sampleRow){
    if (pickKey(sampleRow,"press")) found.add("press");
    if (pickKey(sampleRow,"rad")) found.add("rad");
    if (pickKey(sampleRow,"hum")) found.add("hum");
    if (pickKey(sampleRow,"wind")) found.add("wind");
  }
  return base.filter(v => found.has(v.id));
}

async function fetchJSON(relPath){
  const url = pathOf(relPath);
  const r = await fetch(url, { cache:"no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${relPath}`);
  return await r.json();
}

function normalizeStations(raw){
  const arr = Array.isArray(raw) ? raw : (raw.stations || raw.data || []);
  return arr.map(s => {
    const code = s.code || s.codigo || s.id || s.wmo || s.estacao || s.CODIGO || s.CODIGO_WMO;
    const name = s.name || s.nome || s.estacao || s.ESTACAO || s.station || "";
    const uf   = s.uf || s.UF || s.state || "";
    const lat  = parseNum(s.lat ?? s.latitude ?? s.LATITUDE);
    const lon  = parseNum(s.lon ?? s.longitude ?? s.LONGITUDE);
    const alt  = parseNum(s.alt ?? s.altitude ?? s.ALTITUDE);
    return { code:String(code||"").trim(), name:String(name||"").trim(), uf:String(uf||"").trim(), lat, lon, alt };
  }).filter(s => s.code && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

function yearsForStation(code){
  if (!YEARS_INDEX) return [];
  if (Array.isArray(YEARS_INDEX)) return YEARS_INDEX.map(Number).filter(Number.isFinite);
  if (YEARS_INDEX.stations && YEARS_INDEX.stations[code]) return YEARS_INDEX.stations[code].map(Number);
  if (YEARS_INDEX[code]) return YEARS_INDEX[code].map(Number);
  if (YEARS_INDEX.years) return YEARS_INDEX.years.map(Number);
  return [];
}

async function loadStationYear(code, year){
  const key = `${code}_${year}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const raw = await fetchJSON(`assets/data/${code}/${year}.json`);
  let rows = raw;
  if (!Array.isArray(rows)) rows = raw.data || raw.rows || raw.values || [];
  if (!Array.isArray(rows)) rows = [];

  const norm = normalizeToDaily(rows);
  CACHE.set(key, norm);
  return norm;
}

function stats(arr){
  const v = arr.filter(Number.isFinite);
  const n = v.length;
  if (!n) return {n:0, mean:NaN, min:NaN, max:NaN};
  let s=0, mn=v[0], mx=v[0];
  for (const x of v){ s+=x; if(x<mn)mn=x; if(x>mx)mx=x; }
  return {n, mean:s/n, min:mn, max:mx};
}
function sum(arr){
  const v = arr.filter(Number.isFinite);
  if (!v.length) return NaN;
  let s=0; for (const x of v) s+=x;
  return s;
}
function aggregateDaily(rows){
  const m = new Map();
  for (const r of rows){
    const k = r.ymd;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  const out = [];
  for (const [k, arr] of m){
    const d = arr[0].date;
    out.push({
      date: d,
      ymd: k,
      year: d.getFullYear(),
      month: d.getMonth()+1,
      tempMean: stats(arr.map(x=>x.tempMean)).mean,
      tempMin:  stats(arr.map(x=>x.tempMin)).min,
      tempMax:  stats(arr.map(x=>x.tempMax)).max,
      precSum:  sum(arr.map(x=>x.precSum)),
      pressMean: stats(arr.map(x=>x.pressMean)).mean,
      radMean:   stats(arr.map(x=>x.radMean)).mean,
      humMean:   stats(arr.map(x=>x.humMean)).mean,
      windMean:  stats(arr.map(x=>x.windMean)).mean
    });
  }
  out.sort((a,b)=>a.date-b.date);
  return out;
}

function normalizeToDaily(rows){
  if (!rows.length) return [];
  const sample = rows.find(r => r && typeof r === "object") || rows[0];
  const kDate = pickKey(sample, "date") || "Data" || "date";
  const kHour = pickKey(sample, "hour");
  const kPrec = pickKey(sample, "prec");
  const kTemp = pickKey(sample, "temp");
  const kTmin = pickKey(sample, "tmin");
  const kTmax = pickKey(sample, "tmax");
  const kPress= pickKey(sample, "press");
  const kRad  = pickKey(sample, "rad");
  const kHum  = pickKey(sample, "hum");
  const kWind = pickKey(sample, "wind");

  const isHourly = !!kHour;

  const out = [];
  for (const r of rows){
    if (!r || typeof r !== "object") continue;
    const d = parseDateSmart(r[kDate] ?? r.date ?? r.Data);
    if (!d) continue;
    out.push({
      date: d,
      ymd: ymd(d),
      year: d.getFullYear(),
      month: d.getMonth()+1,
      tempMean: parseNum(r[kTemp]),
      tempMin:  parseNum(r[kTmin]),
      tempMax:  parseNum(r[kTmax]),
      precSum:  parseNum(r[kPrec]),
      pressMean: parseNum(r[kPress]),
      radMean:   parseNum(r[kRad]),
      humMean:   parseNum(r[kHum]),
      windMean:  parseNum(r[kWind])
    });
  }

  // Se for horário, agrega por dia. Se já for diário, também agrega pra garantir 1 linha/dia.
  return aggregateDaily(out);
}

function extractVar(row, varId){
  switch(varId){
    case "temp": return row.tempMean;
    case "prec": return row.precSum;
    case "press":return row.pressMean;
    case "rad":  return row.radMean;
    case "hum":  return row.humMean;
    case "wind": return row.windMean;
    default: return NaN;
  }
}

function computeMonthlyClimogram(dailyRows, y0, y1){
  const inRange = dailyRows.filter(r => r.year>=y0 && r.year<=y1);
  const ym = new Map();
  for (const r of inRange){
    const k = `${r.year}-${String(r.month).padStart(2,"0")}`;
    if (!ym.has(k)) ym.set(k, []);
    ym.get(k).push(r);
  }

  const perYM = [];
  for (const [k, arr] of ym){
    const tMean = stats(arr.map(a=>a.tempMean)).mean;
    const tMin  = stats(arr.map(a=>a.tempMin)).min;
    const tMax  = stats(arr.map(a=>a.tempMax)).max;
    const pSum  = sum(arr.map(a=>a.precSum));
    perYM.push({ y:Number(k.slice(0,4)), m:Number(k.slice(5,7)), tMean, tMin, tMax, pSum });
  }

  const byM = new Map();
  for (const r of perYM){
    if (!byM.has(r.m)) byM.set(r.m, []);
    byM.get(r.m).push(r);
  }

  const out = [];
  for (let m=1;m<=12;m++){
    const arr = byM.get(m) || [];
    out.push({
      month: m,
      tempMean: stats(arr.map(a=>a.tMean)).mean,
      tempMin:  stats(arr.map(a=>a.tMin)).mean,
      tempMax:  stats(arr.map(a=>a.tMax)).mean,
      prec:     stats(arr.map(a=>a.pSum)).mean,
      nYears:   stats(arr.map(a=>a.pSum)).n
    });
  }
  return out;
}

function computeAnnualSeries(dailyRows, y0, y1, varId){
  const inRange = dailyRows.filter(r => r.year>=y0 && r.year<=y1);
  const byY = new Map();
  for (const r of inRange){
    if (!byY.has(r.year)) byY.set(r.year, []);
    byY.get(r.year).push(r);
  }
  const out = [];
  for (let y=y0;y<=y1;y++){
    const arr = byY.get(y) || [];
    if (!arr.length){ out.push({year:y, mean:NaN, min:NaN, max:NaN, sum:NaN, n:0}); continue; }
    const vals = arr.map(r => extractVar(r,varId));
    const st = stats(vals);
    const s  = (varId==="prec") ? sum(vals) : NaN;
    let mn = st.min, mx = st.max;
    if (varId==="temp"){
      mn = stats(arr.map(r=>r.tempMin)).min;
      mx = stats(arr.map(r=>r.tempMax)).max;
    }
    out.push({year:y, mean:st.mean, min:mn, max:mx, sum:s, n:st.n});
  }
  return out;
}

function computeRelations(dailyRows, y0, y1, varA, varB){
  const inRange = dailyRows.filter(r => r.year>=y0 && r.year<=y1);
  const byYM = new Map();
  for (const r of inRange){
    const k = monthKey(r.date);
    if (!byYM.has(k)) byYM.set(k, []);
    byYM.get(k).push(r);
  }
  const x = [], y = [], meta = [];
  for (const [k, arr] of byYM){
    const a = (varA==="prec") ? sum(arr.map(r=>extractVar(r,varA))) : stats(arr.map(r=>extractVar(r,varA))).mean;
    const b = (varB==="prec") ? sum(arr.map(r=>extractVar(r,varB))) : stats(arr.map(r=>extractVar(r,varB))).mean;
    if (Number.isFinite(a) && Number.isFinite(b)){ x.push(a); y.push(b); meta.push(k); }
  }
  return { x, y, meta, corr: pearson(x,y) };
}

function initMap(){
  MAP = L.map("map", { zoomControl:true }).setView([-14.2, -52.9], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "&copy; OpenStreetMap"
  }).addTo(MAP);
  markersLayer = L.layerGroup().addTo(MAP);
}

function renderMarkers(filteredStations){
  markersLayer.clearLayers();
  for (const s of filteredStations){
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 6, weight: 2,
      color: "rgba(86,242,255,.9)",
      fillColor: "rgba(167,139,250,.35)",
      fillOpacity: 0.9
    }).addTo(markersLayer);
    marker.bindTooltip(`<b>${s.code}</b> • ${s.name} • ${s.uf}`, { sticky:true });
    marker.on("click", () => selectStation(s.code, true));
  }
}

function unique(arr){ return Array.from(new Set(arr)); }

function populateUF(){
  const ufs = unique(STATIONS.map(s=>s.uf).filter(Boolean)).sort();
  ufSelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "ALL";
  optAll.textContent = "Todas";
  ufSelect.appendChild(optAll);
  for (const uf of ufs){
    const o = document.createElement("option");
    o.value = uf; o.textContent = uf;
    ufSelect.appendChild(o);
  }
  ufSelect.value = "ALL";
}

function filterStations(){
  const q = safeLower(searchStation.value);
  return STATIONS.filter(s => {
    const ufOk = (selectedUF==="ALL") || (s.uf===selectedUF);
    if (!ufOk) return false;
    if (!q) return true;
    return safeLower(s.name).includes(q) || safeLower(s.code).includes(q);
  });
}

function populateStationSelect(){
  const list = filterStations();
  stationSelect.innerHTML = "";
  for (const s of list){
    const o = document.createElement("option");
    o.value = s.code;
    o.textContent = `${s.code} • ${s.name} (${s.uf})`;
    stationSelect.appendChild(o);
  }
  if (selectedStation) stationSelect.value = selectedStation.code;
  else if (list.length) stationSelect.value = list[0].code;
  renderMarkers(list);
}

function populateYears(){
  const years = selectedStation ? yearsForStation(selectedStation.code) : [];
  const sorted = years.slice().sort((a,b)=>a-b);
  yearStart.innerHTML = ""; yearEnd.innerHTML = "";
  for (const y of sorted){
    const o1 = document.createElement("option");
    o1.value = y; o1.textContent = y; yearStart.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = y; o2.textContent = y; yearEnd.appendChild(o2);
  }
  if (sorted.length){ yearStart.value = sorted[0]; yearEnd.value = sorted[sorted.length-1]; }
  pillYears.textContent = sorted.length ? `Anos: ${sorted[0]} → ${sorted[sorted.length-1]}` : `Anos: —`;
}

function populateVars(sampleRow){
  const catalog = buildVariableCatalog(sampleRow);
  function fill(sel, preferId){
    sel.innerHTML = "";
    for (const v of catalog){
      const o = document.createElement("option");
      o.value = v.id; o.textContent = v.label;
      sel.appendChild(o);
    }
    sel.value = catalog.some(v=>v.id===preferId) ? preferId : (catalog[0]?.id || "temp");
  }
  fill(var1, "temp");
  fill(var2, "prec");
}

function setMode(m){
  mode = m;
  tabMonthly.classList.toggle("on", mode==="monthly");
  tabAnnual.classList.toggle("on", mode==="annual");
  tabMonthSeries.classList.toggle("on", mode==="monthSeries");
  tabRelations.classList.toggle("on", mode==="relations");
  var2.parentElement.style.opacity = (mode==="relations") ? "1" : "0.55";
}

function currentYears(){
  const y0 = Number(yearStart.value);
  const y1 = Number(yearEnd.value);
  return [Math.min(y0,y1), Math.max(y0,y1)];
}

function destroyChart(){ if (chart){ chart.destroy(); chart=null; } }
function setKpis(items){
  kpis.innerHTML = "";
  for (const it of items){
    const d = document.createElement("div");
    d.className = "kpi";
    d.innerHTML = `<div class="k">${it.k}</div><div class="v">${it.v}</div>`;
    kpis.appendChild(d);
  }
}
function setTable(rows){
  lastTableRows = rows || [];
  thead.innerHTML = ""; tbody.innerHTML = "";
  if (!rows.length){ tableHint.textContent = "Sem linhas para exibir."; return; }
  const cols = Object.keys(rows[0]);
  const trh = document.createElement("tr");
  for (const c of cols){ const th=document.createElement("th"); th.textContent=c; trh.appendChild(th); }
  thead.appendChild(trh);
  const preview = rows.slice(0,40);
  for (const r of preview){
    const tr = document.createElement("tr");
    for (const c of cols){
      const td=document.createElement("td");
      const v=r[c];
      td.textContent = (typeof v==="number") ? fmt(v,3) : String(v ?? "");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableHint.textContent = `Mostrando ${Math.min(40, rows.length)} de ${rows.length} linhas.`;
}
function enableDownloads(on){ btnPNG.disabled=!on; btnCSV.disabled=!on; }

function chartToPNG(){
  if (!chart) return;
  const a = document.createElement("a");
  a.href = chart.toBase64Image("image/png", 1);
  a.download = (lastChartTitle || "grafico") + ".png";
  a.click();
}
function tableToCSV(){
  if (!lastTableRows.length) return;
  const cols = Object.keys(lastTableRows[0]);
  const lines = [cols.join(",")];
  for (const r of lastTableRows){
    lines.push(cols.map(c=>{
      const v = r[c];
      if (typeof v==="number" && Number.isFinite(v)) return String(Math.round(v*10000)/10000);
      const s = String(v ?? "");
      return (s.includes(",")||s.includes('"')||s.includes("\n")) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(","));
  }
  downloadBlob("tabela.csv", new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"}));
}

function buildDatasetsForMain(varId, rows, xKey){
  const labels = rows.map(r => r[xKey]);
  const ds = [];

  if (optPrecBars.checked && rows[0] && "prec" in rows[0]){
    ds.push({ type:"bar", label:"Precipitação (mm)", data: rows.map(r=>r.prec), yAxisID:"y2", borderWidth:0 });
  }

  if (optMinMax.checked && varId==="temp"){
    ds.push({ type:"line", label:"Temp mín (°C)", data: rows.map(r=>r.tempMin), yAxisID:"y", pointRadius:2, borderWidth:2, tension:0.25 });
    ds.push({ type:"line", label:"Temp máx (°C)", data: rows.map(r=>r.tempMax), yAxisID:"y", pointRadius:2, borderWidth:2, tension:0.25 });
  }

  if (optMean.checked){
    const mainLabel =
      varId==="temp" ? "Temperatura média (°C)" :
      varId==="prec" ? "Precipitação (mm)" :
      varId==="press"? "Pressão média" :
      varId==="rad"  ? "Radiação média" :
      varId==="hum"  ? "Umidade média" :
      varId==="wind" ? "Vento médio" : "Média";
    ds.push({ type:"line", label: mainLabel, data: rows.map(r=>r.main), yAxisID:"y", pointRadius:3, borderWidth:3, tension:0.25 });
  }

  return { labels, datasets: ds };
}

function renderChart(labels, datasets, yLabel, y2Label){
  destroyChart();
  const ctx = $("chart").getContext("2d");
  chart = new Chart(ctx, {
    data: { labels, datasets },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ position:"top" } },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,.06)" } },
        y:{ position:"left", title:{ display:true, text:yLabel||"" }, grid:{ color:"rgba(255,255,255,.06)" } },
        y2:{ position:"right", title:{ display:!!y2Label, text:y2Label||"" }, grid:{ drawOnChartArea:false } }
      }
    }
  });
}

async function buildDailyForPeriod(code, y0, y1){
  const years = yearsForStation(code).filter(y => y>=y0 && y<=y1).sort((a,b)=>a-b);
  pillData.textContent = `Dados: carregando… (${years.length} ano(s))`;

  const all = [];
  let loaded = 0, missing = 0;
  for (const y of years){
    try{
      const daily = await loadStationYear(code, y);
      loaded++;
      all.push(...daily);
    }catch{
      missing++;
    }
  }
  all.sort((a,b)=>a.date-b.date);
  pillData.textContent = `Dados: ${loaded} ano(s) ok • ${missing} faltando • ${all.length} dias`;
  return all;
}

async function render(){
  enableDownloads(false);
  subPanel.innerHTML = "";
  setKpis([]);

  if (!selectedStation){ setMsg("Selecione uma estação.", "warn"); return; }
  const [y0,y1] = currentYears();
  if (!Number.isFinite(y0) || !Number.isFinite(y1)){ setMsg("Selecione os anos.", "warn"); return; }

  const daily = await buildDailyForPeriod(selectedStation.code, y0, y1);
  if (!daily.length){
    setMsg("Sem dados no intervalo selecionado.", "bad");
    chartTitle.textContent = "Sem dados";
    chartMeta.textContent = "—";
    setTable([]);
    return;
  }

  // garante catálogo com base em dados reais
  const keepV1 = var1.value;
  const keepV2 = var2.value;
  populateVars(daily[0]);
  if (Array.from(var1.options).some(o=>o.value===keepV1)) var1.value = keepV1;
  if (Array.from(var2.options).some(o=>o.value===keepV2)) var2.value = keepV2;

  const stationLabel = `${selectedStation.code} • ${selectedStation.name} (${selectedStation.uf})`;

  if (mode==="monthly"){
    const clim = computeMonthlyClimogram(daily, y0, y1);

    setTable(clim.map(r => ({
      mes: r.month,
      temp_min: r.tempMin,
      temp_med: r.tempMean,
      temp_max: r.tempMax,
      prec_mm: r.prec,
      anos_com_dado: r.nYears
    })));

    const plotRows = clim.map(r => ({
      month: ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][r.month-1],
      tempMin: r.tempMin, tempMax: r.tempMax, main: r.tempMean, prec: r.prec
    }));
    const { labels, datasets } = buildDatasetsForMain("temp", plotRows, "month");
    renderChart(labels, datasets, "Temperatura (°C)", optPrecBars.checked ? "Precipitação (mm)" : "");

    chartTitle.textContent = `Climograma (média mensal) — ${stationLabel}`;
    chartMeta.textContent = `Intervalo: ${y0}–${y1}.`;
    lastChartTitle = `climograma_${selectedStation.code}_${y0}_${y1}`;
    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  if (mode==="annual"){
    const v = var1.value;
    const series = computeAnnualSeries(daily, y0, y1, v);
    setTable(series.map(r => ({ ano:r.year, media:r.mean, minimo:r.min, maximo:r.max, soma:r.sum, n:r.n })));

    const plotRows = series.map(r => ({
      year: r.year,
      main: (v==="prec") ? r.sum : r.mean,
      tempMin: (v==="temp") ? r.min : NaN,
      tempMax: (v==="temp") ? r.max : NaN
    }));
    const { labels, datasets } = buildDatasetsForMain(v, plotRows, "year");

    renderChart(labels, datasets,
      v==="temp" ? "Temperatura (°C)" :
      v==="prec" ? "Precipitação (mm/ano)" : "Valor",
      ""
    );

    chartTitle.textContent = `Série anual — ${stationLabel}`;
    chartMeta.textContent = `Variável: ${var1.options[var1.selectedIndex].text} • ${y0}–${y1}.`;
    lastChartTitle = `serie_anual_${selectedStation.code}_${v}_${y0}_${y1}`;
    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  if (mode==="relations"){
    const a = var1.value, b = var2.value;
    if (a===b){ setMsg("Escolha duas variáveis diferentes.", "warn"); return; }
    const rel = computeRelations(daily, y0, y1, a, b);

    setTable(rel.x.map((x,i)=>({ periodo: rel.meta[i], x:x, y:rel.y[i] })));

    destroyChart();
    const ctx = $("chart").getContext("2d");
    chart = new Chart(ctx, {
      type:"scatter",
      data:{ datasets:[{ label:`${var1.options[var1.selectedIndex].text} × ${var2.options[var2.selectedIndex].text}`,
                        data: rel.x.map((x,i)=>({x, y:rel.y[i]})), pointRadius:3 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ title:{display:true, text: var1.options[var1.selectedIndex].text} },
          y:{ title:{display:true, text: var2.options[var2.selectedIndex].text} }
        }
      }
    });

    subPanel.innerHTML = `<b>Correlação de Pearson (mensal, por ano-mês)</b><br>
      n = <b>${rel.corr.n}</b> • r = <b>${fmt(rel.corr.r,3)}</b>`;

    chartTitle.textContent = `Relação entre variáveis — ${stationLabel}`;
    chartMeta.textContent = `Intervalo: ${y0}–${y1}.`;
    lastChartTitle = `relacao_${selectedStation.code}_${a}_x_${b}_${y0}_${y1}`;
    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  // monthSeries (fica pra tua próxima etapa — não é o que tá te travando agora)
  setMsg("Modo 'Mensal por ano' será ajustado na próxima rodada.", "warn");
}

async function selectStation(code, panTo=false){
  const s = STATIONS.find(x=>x.code===code);
  if (!s) return;

  selectedStation = s;
  stationSelect.value = s.code;

  pillStation.textContent = `Estação: ${s.code}`;
  stationHint.textContent = `${s.name} • ${s.uf} • lat ${fmt(s.lat,4)} lon ${fmt(s.lon,4)}`;

  populateYears();

  // ✅ IMPORTANTÍSSIMO: tenta achar 1 ano que exista MESMO para essa estação
  const ys = yearsForStation(s.code).slice().sort((a,b)=>a-b);
  let sampleDaily = null;
  for (const y of ys){
    try{
      sampleDaily = await loadStationYear(s.code, y);
      if (sampleDaily && sampleDaily.length) break;
    }catch{}
  }
  populateVars(sampleDaily && sampleDaily[0] ? sampleDaily[0] : null);

  if (panTo && MAP){
    MAP.setView([s.lat, s.lon], 8, { animate:true });
  }
}

function resetAll(){
  selectedUF = "ALL";
  selectedStation = null;
  searchStation.value = "";
  ufSelect.value = "ALL";

  setMode("monthly");
  optMinMax.checked = true;
  optMean.checked = true;
  optPrecBars.checked = true;

  pillStation.textContent = "Estação: —";
  pillYears.textContent = "Anos: —";
  pillData.textContent = "Dados: —";

  destroyChart();
  chartTitle.textContent = "—";
  chartMeta.textContent = "—";
  setKpis([]);
  setTable([]);
  subPanel.innerHTML = "";
  enableDownloads(false);

  populateStationSelect();
  setMsg("Reset feito. Selecione uma estação.", "ok");
}

ufSelect.addEventListener("change", ()=>{ selectedUF = ufSelect.value; populateStationSelect(); });
searchStation.addEventListener("input", populateStationSelect);
stationSelect.addEventListener("change", ()=>selectStation(stationSelect.value, true));

tabMonthly.addEventListener("click", ()=>setMode("monthly"));
tabAnnual.addEventListener("click", ()=>setMode("annual"));
tabMonthSeries.addEventListener("click", ()=>setMode("monthSeries"));
tabRelations.addEventListener("click", ()=>setMode("relations"));

btnRender.addEventListener("click", ()=>render().catch(err=>{
  console.error(err);
  setMsg(`Erro: ${err.message}`, "bad");
}));

btnPNG.addEventListener("click", ()=>{
  if (!chart) return;
  chartToPNG();
});
btnCSV.addEventListener("click", tableToCSV);
btnReset.addEventListener("click", resetAll);

(async function boot(){
  try{
    setMsg("Carregando base…", "warn");
    initMap();

    const stationsRaw = await fetchJSON("assets/stations.json");
    STATIONS = normalizeStations(stationsRaw);

    YEARS_INDEX = await fetchJSON("assets/years.json");

    populateUF();
    populateStationSelect();

    const first = filterStations()[0];
    if (first) await selectStation(first.code, false);

    setMsg(`Base ok: ${STATIONS.length} estações. Selecione e clique em “Gerar”.`, "ok");
  }catch(err){
    console.error(err);
    setMsg(`Falha ao iniciar: ${err.message}`, "bad");
  }
})();
