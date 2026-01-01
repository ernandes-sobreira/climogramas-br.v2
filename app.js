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

const heatLegend = $("heatLegend");
const heatMinEl = $("heatMin");
const heatMaxEl = $("heatMax");

const trendBox = $("trendBox");
const trendModel = $("trendModel");
const polyDegreeBox = $("polyDegreeBox");
const polyDegree = $("polyDegree");
const showTrend = $("showTrend");
const showR2 = $("showR2");

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

const BASE = new URL("./", window.location.href).href;
const pathOf = (p) => new URL(p, BASE).href;

function setMsg(text, type="ok"){
  msg.textContent = text;
  msg.style.color =
    type==="bad" ? "rgb(251,113,133)" :
    type==="warn" ? "rgb(251,191,36)" :
    "rgba(170,182,214,1)";
}

function fmt(n, digits=2){
  if (!Number.isFinite(n)) return "—";
  const p = Math.pow(10, digits);
  return (Math.round(n*p)/p).toString();
}

function parseNum(v){
  if (v===null || v===undefined) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return NaN;
  const z = s.replace(/\./g,"").replace(",",".");
  const n = Number(z);
  return Number.isFinite(n) ? n : NaN;
}

function safeLower(s){ return String(s||"").toLowerCase(); }
function unique(arr){ return Array.from(new Set(arr)); }

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
  if (YEARS_INDEX.stations && YEARS_INDEX.stations[code]) return YEARS_INDEX.stations[code].map(Number);
  if (YEARS_INDEX[code]) return YEARS_INDEX[code].map(Number);
  if (YEARS_INDEX.years) return YEARS_INDEX.years.map(Number);
  return [];
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

function populateUF(){
  const ufs = unique(STATIONS.map(s=>s.uf).filter(Boolean)).sort();
  ufSelect.innerHTML = "";
  ufSelect.appendChild(new Option("Todas", "ALL"));
  for (const uf of ufs) ufSelect.appendChild(new Option(uf, uf));
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
    stationSelect.appendChild(new Option(`${s.code} • ${s.name} (${s.uf})`, s.code));
  }
  if (selectedStation) stationSelect.value = selectedStation.code;
  else if (list.length) stationSelect.value = list[0].code;

  renderMarkers(list);
}

function setMode(m){
  mode = m;
  tabMonthly.classList.toggle("on", mode==="monthly");
  tabAnnual.classList.toggle("on", mode==="annual");
  tabMonthSeries.classList.toggle("on", mode==="monthSeries");
  tabRelations.classList.toggle("on", mode==="relations");

  trendBox.style.display = (mode==="relations") ? "block" : "none";
  heatLegend.style.display = (mode==="monthSeries") ? "block" : "none";
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

function downloadBlob(filename, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

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

// ====== Estatísticas helpers ======
function meanFinite(arr){
  const v = arr.filter(Number.isFinite);
  if (!v.length) return NaN;
  return v.reduce((a,b)=>a+b,0)/v.length;
}
function minFinite(arr){
  const v = arr.filter(Number.isFinite);
  if (!v.length) return NaN;
  return Math.min(...v);
}
function maxFinite(arr){
  const v = arr.filter(Number.isFinite);
  if (!v.length) return NaN;
  return Math.max(...v);
}
function sumFinite(arr){
  const v = arr.filter(Number.isFinite);
  if (!v.length) return NaN;
  return v.reduce((a,b)=>a+b,0);
}

// ====== Leitura do teu JSON (mensal/anual) ======
async function loadStationYear(code, year){
  const key = `${code}_${year}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const raw = await fetchJSON(`assets/data/${code}/${year}.json`);

  const months = Array.isArray(raw.months) ? raw.months : [];
  const annual = raw.annual || null;

  const normMonths = months.map(x => {
    const o = { year, m: Number(x.m) };
    // copia TODAS as chaves numéricas que existirem (p, tmean, tmin, tmax, rad, press, etc.)
    for (const [k,v] of Object.entries(x)){
      if (k==="m") continue;
      const n = parseNum(v);
      o[k] = n;
    }
    return o;
  }).filter(r => r.m>=1 && r.m<=12);

  const out = { year, months: normMonths, annual, raw };
  CACHE.set(key, out);
  return out;
}

// Descobre variáveis disponíveis olhando um ano “bom”
function discoverVariablesFromPack(pack){
  const keys = new Set();
  for (const row of pack.months){
    for (const [k,v] of Object.entries(row)){
      if (k==="year" || k==="m") continue;
      if (Number.isFinite(v)) keys.add(k);
    }
  }
  // ordena com prioridade: temp/prec primeiro
  const priority = ["tmean","tmin","tmax","p","prec","prcp","ppt"];
  const all = Array.from(keys);
  all.sort((a,b)=>{
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    if (ia!==-1 && ib!==-1) return ia-ib;
    if (ia!==-1) return -1;
    if (ib!==-1) return 1;
    return a.localeCompare(b);
  });
  return all;
}

// labels bonitos
function labelOfVar(k){
  const map = {
    tmean: "Temperatura média (°C)",
    tmin: "Temperatura mínima (°C)",
    tmax: "Temperatura máxima (°C)",
    p: "Precipitação (mm)",
    prec: "Precipitação (mm)",
    prcp: "Precipitação (mm)",
    ppt: "Precipitação (mm)",
    rh: "Umidade relativa (%)",
    ur: "Umidade relativa (%)",
    wind: "Vento (m/s)",
    ws: "Vento (m/s)",
    rad: "Radiação",
    press: "Pressão",
    patm: "Pressão atmosférica",
    tdew: "Ponto de orvalho (°C)"
  };
  return map[k] || k;
}

// escolhe defaults inteligentes
function defaultVar1(vars){
  if (vars.includes("tmean")) return "tmean";
  if (vars.includes("p")) return "p";
  return vars[0] || "";
}
function defaultVar2(vars, v1){
  if (!vars.length) return "";
  // se var1 é temp, tenta precip; se var1 é precip, tenta tmean
  if (v1==="tmean" && (vars.includes("p"))) return "p";
  if (v1==="p" && (vars.includes("tmean"))) return "tmean";
  // senão qualquer diferente
  const v = vars.find(x=>x!==v1);
  return v || v1;
}

function populateVarSelects(vars){
  var1.innerHTML = "";
  var2.innerHTML = "";

  for (const v of vars){
    var1.appendChild(new Option(labelOfVar(v), v));
    var2.appendChild(new Option(labelOfVar(v), v));
  }

  const v1 = defaultVar1(vars);
  var1.value = v1;
  var2.value = defaultVar2(vars, v1);
}

async function findAvailableYearsWithData(code, years){
  const okYears = [];
  let missingFiles = 0;
  for (const y of years){
    try{
      const pack = await loadStationYear(code, y);
      const has = pack.months.some(r => Object.entries(r).some(([k,v]) => (k!=="year" && k!=="m" && Number.isFinite(v))));
      if (has) okYears.push(y);
    }catch{
      missingFiles++;
    }
  }
  return { okYears, missingFiles };
}

function populateYearsAuto(okYears){
  const sorted = okYears.slice().sort((a,b)=>a-b);
  yearStart.innerHTML = ""; yearEnd.innerHTML = "";
  for (const y of sorted){
    yearStart.appendChild(new Option(y, y));
    yearEnd.appendChild(new Option(y, y));
  }
  if (sorted.length){
    yearStart.value = sorted[0];
    yearEnd.value = sorted[sorted.length-1];
    pillYears.textContent = `Anos: ${sorted[0]} → ${sorted[sorted.length-1]}`;
  }else{
    pillYears.textContent = "Anos: —";
  }
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
      plugins:{ legend:{ position:"top" }, tooltip:{ enabled:true } },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,.06)" } },
        y:{ position:"left", title:{ display:true, text:yLabel||"" }, grid:{ color:"rgba(255,255,255,.06)" } },
        y2:{ position:"right", title:{ display:!!y2Label, text:y2Label||"" }, grid:{ drawOnChartArea:false } }
      }
    }
  });
}

// ====== “Mensal por ano” (heatmap) ======
function colorForValue(v, vmin, vmax){
  if (!Number.isFinite(v)) return "rgba(255,255,255,.06)";
  if (vmax===vmin) return "rgba(86,242,255,.35)";
  const t = (v - vmin) / (vmax - vmin);
  // gradiente simples: ciano -> roxo -> rosa
  const a = Math.max(0, Math.min(1, t));
  const c1 = [86,242,255];   // ciano
  const c2 = [167,139,250];  // roxo
  const c3 = [251,113,133];  // rosa
  let rgb;
  if (a < 0.5){
    const tt = a/0.5;
    rgb = c1.map((x,i)=> Math.round(x + (c2[i]-x)*tt));
  }else{
    const tt = (a-0.5)/0.5;
    rgb = c2.map((x,i)=> Math.round(x + (c3[i]-x)*tt));
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.75)`;
}

// ====== Regressões + R² ======
function r2Of(y, yhat){
  const yy = y.filter((_,i)=> Number.isFinite(yhat[i]));
  const yhh = yhat.filter(Number.isFinite);
  if (!yy.length || yy.length!==yhh.length) return NaN;
  const meanY = yy.reduce((a,b)=>a+b,0)/yy.length;
  let ssTot=0, ssRes=0;
  for (let i=0;i<yy.length;i++){
    ssTot += Math.pow(yy[i]-meanY,2);
    ssRes += Math.pow(yy[i]-yhh[i],2);
  }
  return ssTot===0 ? NaN : (1 - ssRes/ssTot);
}

function linReg(x,y){
  const n = x.length;
  let sx=0, sy=0, sxx=0, sxy=0;
  for (let i=0;i<n;i++){ sx+=x[i]; sy+=y[i]; sxx+=x[i]*x[i]; sxy+=x[i]*y[i]; }
  const den = (n*sxx - sx*sx);
  if (den===0) return null;
  const a = (n*sxy - sx*sy)/den; // slope
  const b = (sy - a*sx)/n;       // intercept
  return {a,b, predict:(xx)=>a*xx+b};
}

function logReg(x,y){
  // y = a*ln(x) + b ; precisa x>0
  const xx=[], yy=[];
  for (let i=0;i<x.length;i++){
    if (x[i]>0){ xx.push(Math.log(x[i])); yy.push(y[i]); }
  }
  if (xx.length<3) return null;
  const fit = linReg(xx, yy);
  if (!fit) return null;
  return { predict:(xv)=> (xv>0 ? fit.predict(Math.log(xv)) : NaN) };
}

function expReg(x,y){
  // y = A * exp(Bx) => ln(y)=ln(A)+Bx ; precisa y>0
  const xx=[], yy=[];
  for (let i=0;i<x.length;i++){
    if (y[i]>0){ xx.push(x[i]); yy.push(Math.log(y[i])); }
  }
  if (xx.length<3) return null;
  const fit = linReg(xx, yy);
  if (!fit) return null;
  const A = Math.exp(fit.b);
  const B = fit.a;
  return { predict:(xv)=> A*Math.exp(B*xv) };
}

function polyReg(x,y,deg){
  // ajuste normal eq via eliminação gaussiana simples
  const n = x.length;
  if (n < deg+1) return null;

  // monta matriz
  const m = deg+1;
  const A = Array.from({length:m}, ()=>Array(m).fill(0));
  const B = Array(m).fill(0);

  for (let row=0; row<m; row++){
    for (let col=0; col<m; col++){
      let s=0;
      for (let i=0;i<n;i++) s += Math.pow(x[i], row+col);
      A[row][col]=s;
    }
    let sb=0;
    for (let i=0;i<n;i++) sb += y[i]*Math.pow(x[i], row);
    B[row]=sb;
  }

  // gauss
  for (let i=0;i<m;i++){
    // pivô
    let maxRow=i;
    for (let r=i+1;r<m;r++) if (Math.abs(A[r][i])>Math.abs(A[maxRow][i])) maxRow=r;
    [A[i],A[maxRow]]=[A[maxRow],A[i]];
    [B[i],B[maxRow]]=[B[maxRow],B[i]];

    const piv = A[i][i];
    if (Math.abs(piv)<1e-12) return null;

    for (let c=i;c<m;c++) A[i][c]/=piv;
    B[i]/=piv;

    for (let r=0;r<m;r++){
      if (r===i) continue;
      const f = A[r][i];
      for (let c=i;c<m;c++) A[r][c]-=f*A[i][c];
      B[r]-=f*B[i];
    }
  }

  const coeff = B; // c0 + c1*x + ...
  return {
    coeff,
    predict:(xv)=>{
      let s=0;
      for (let i=0;i<coeff.length;i++) s += coeff[i]*Math.pow(xv,i);
      return s;
    }
  };
}

function buildTrend(x,y){
  const model = trendModel.value;
  const deg = Number(polyDegree.value);

  if (model==="linear"){
    const fit = linReg(x,y);
    if (!fit) return null;
    return { name:"Linear", predict:fit.predict };
  }
  if (model==="exp"){
    const fit = expReg(x,y);
    if (!fit) return null;
    return { name:"Exponencial", predict:fit.predict };
  }
  if (model==="log"){
    const fit = logReg(x,y);
    if (!fit) return null;
    return { name:"Logarítmica", predict:fit.predict };
  }
  if (model==="poly"){
    const fit = polyReg(x,y,deg);
    if (!fit) return null;
    return { name:`Polinomial (grau ${deg})`, predict:fit.predict };
  }
  return null;
}

function monthName(m){
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][m-1];
}

// ====== Render principal ======
async function render(){
  enableDownloads(false);
  subPanel.innerHTML = "";
  setKpis([]);
  heatLegend.style.display = (mode==="monthSeries") ? "block" : "none";

  if (!selectedStation){ setMsg("Selecione uma estação.", "warn"); return; }
  const [y0,y1] = currentYears();
  if (!Number.isFinite(y0) || !Number.isFinite(y1)){ setMsg("Selecione os anos.", "warn"); return; }

  const years = yearsForStation(selectedStation.code).filter(y => y>=y0 && y<=y1).sort((a,b)=>a-b);
  if (!years.length){
    setMsg("Intervalo sem anos cadastrados para essa estação.", "warn");
    return;
  }

  pillData.textContent = `Dados: carregando (${years.length} ano(s))…`;

  const packs = [];
  let missingFiles = 0;
  for (const y of years){
    try{
      packs.push(await loadStationYear(selectedStation.code, y));
    }catch{
      missingFiles++;
    }
  }

  const allMonths = [];
  for (const p of packs) allMonths.push(...p.months);

  const hasAny = allMonths.some(r => Object.entries(r).some(([k,v]) => (k!=="year" && k!=="m" && Number.isFinite(v))));
  if (!hasAny){
    pillData.textContent = `Dados: 0 ano(s) úteis • ${missingFiles} faltando`;
    setMsg("Sem dados úteis no intervalo (anos ausentes ou JSON vazio).", "bad");
    setTable([]);
    destroyChart();
    chartTitle.textContent = "Sem dados";
    chartMeta.textContent = "—";
    return;
  }

  const yearsOk = unique(allMonths.map(r=>r.year)).sort((a,b)=>a-b);
  pillData.textContent = `Dados: ${yearsOk.length} ano(s) úteis • ${missingFiles} faltando • meses=${allMonths.length}`;

  const stationLabel = `${selectedStation.code} • ${selectedStation.name} (${selectedStation.uf})`;
  const V1 = var1.value;
  const V2 = var2.value;

  // ====== MODO 1: Climograma (média mensal multi-anos) ======
  if (mode==="monthly"){
    const out = [];
    for (let m=1;m<=12;m++){
      const rows = allMonths.filter(r => r.m===m);
      const vals = rows.map(r=>r[V1]).filter(Number.isFinite);

      out.push({
        mes: m,
        mean: meanFinite(vals),
        min: minFinite(vals),
        max: maxFinite(vals),
        n: vals.length
      });
    }

    setTable(out);

    const labels = out.map(r => monthName(r.mes));
    const datasets = [];

    // Se V1 for temperatura média e existirem tmin/tmax no JSON, usa eles como min/max “de verdade”
    const canTMinMax = (V1==="tmean") && allMonths.some(r=>Number.isFinite(r.tmin) || Number.isFinite(r.tmax));
    if (optMinMax.checked){
      if (canTMinMax){
        const byM = [];
        for (let m=1;m<=12;m++){
          const rows = allMonths.filter(r=>r.m===m);
          byM.push({
            min: meanFinite(rows.map(r=>r.tmin)),
            max: meanFinite(rows.map(r=>r.tmax))
          });
        }
        datasets.push({ type:"line", label:"Temp mín (média mensal)", data: byM.map(r=>r.min), yAxisID:"y", borderWidth:2, pointRadius:2, tension:0.25 });
        datasets.push({ type:"line", label:"Temp máx (média mensal)", data: byM.map(r=>r.max), yAxisID:"y", borderWidth:2, pointRadius:2, tension:0.25 });
      }else{
        datasets.push({ type:"line", label:`${labelOfVar(V1)} • mín`, data: out.map(r=>r.min), yAxisID:"y", borderWidth:2, pointRadius:2, tension:0.25 });
        datasets.push({ type:"line", label:`${labelOfVar(V1)} • máx`, data: out.map(r=>r.max), yAxisID:"y", borderWidth:2, pointRadius:2, tension:0.25 });
      }
    }

    if (optMean.checked){
      datasets.push({ type:"line", label:`${labelOfVar(V1)} • média`, data: out.map(r=>r.mean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:0.25 });
    }

    // barras de precip quando fizer sentido
    const canPrec = allMonths.some(r => Number.isFinite(r.p));
    if (optPrecBars.checked && canPrec && (V1!=="p")){
      const pOut = [];
      for (let m=1;m<=12;m++){
        const rows = allMonths.filter(r=>r.m===m);
        pOut.push(meanFinite(rows.map(r=>r.p)));
      }
      datasets.unshift({ type:"bar", label:"Precipitação média (mm)", data: pOut, yAxisID:"y2" });
      renderChart(labels, datasets, labelOfVar(V1), "Precipitação (mm)");
    }else{
      renderChart(labels, datasets, labelOfVar(V1), "");
    }

    chartTitle.textContent = `Climograma (média mensal) — ${stationLabel}`;
    chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length-1]} (ignorando meses nulos).`;
    lastChartTitle = `climograma_${selectedStation.code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}`;

    setKpis([
      { k:"Anos úteis", v: String(yearsOk.length) },
      { k:"Média (12 meses)", v: fmt(meanFinite(out.map(r=>r.mean)),2) },
      { k:"Min (mês)", v: fmt(minFinite(out.map(r=>r.min)),2) },
      { k:"Max (mês)", v: fmt(maxFinite(out.map(r=>r.max)),2) },
    ]);

    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

// ====== MODO 2: Série anual ======
if (mode === "annual") {
  const rows = [];

  // 1) Estatística anual de V1 a partir dos meses
  for (const y of years) {
    const pack = packs.find(p => p.year === y);
    if (!pack) continue;

    const vals = (pack.months || []).map(r => r?.[V1]).filter(Number.isFinite);

    rows.push({
      ano: y,
      mean: meanFinite(vals),
      min: minFinite(vals),
      max: maxFinite(vals),
      sum: sumFinite(vals),
      n: vals.length
    });
  }

  // se não tiver nada, avisa e sai
  if (!rows.length) {
    setTable([]);
    enableDownloads(false);
    setMsg("Sem dados no intervalo selecionado.", "err");
    return;
  }

  setTable(rows);

  // 2) Detecta automaticamente a chave da precipitação nos JSON da estação
  const PREC_KEYS = ["p", "prec", "prcp", "ppt", "precip", "precipitacao"];
  let PKEY = null;

  outer:
  for (const pack of packs) {
    for (const m of (pack.months || [])) {
      if (!m || typeof m !== "object") continue;
      for (const k of PREC_KEYS) {
        if (k in m && Number.isFinite(m[k])) { PKEY = k; break outer; }
      }
    }
  }

  // 3) Precipitação anual = soma dos meses (se existir)
  let annualPrec = null;
  if (PKEY) {
    annualPrec = rows.map(r => {
      const pack = packs.find(p => p.year === r.ano);
      if (!pack) return null;
      const pv = (pack.months || []).map(mm => mm?.[PKEY]).filter(Number.isFinite);
      return pv.length ? sumFinite(pv) : null;
    });
  }

  const labels = rows.map(r => r.ano);
  const datasets = [];

  // 4) Linhas min/max anuais
  if (optMinMax.checked) {
    datasets.push({
      type: "line",
      label: `${labelOfVar(V1)} • mín (ano)`,
      data: rows.map(r => r.min),
      yAxisID: "y",
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.25
    });

    datasets.push({
      type: "line",
      label: `${labelOfVar(V1)} • máx (ano)`,
      data: rows.map(r => r.max),
      yAxisID: "y",
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.25
    });
  }

  // 5) Linha média anual
  if (optMean.checked) {
    datasets.push({
      type: "line",
      label: `${labelOfVar(V1)} • média (ano)`,
      data: rows.map(r => r.mean),
      yAxisID: "y",
      borderWidth: 3,
      pointRadius: 3,
      tension: 0.25
    });
  }

  // 6) Barras de precipitação anual (eixo direito) — usando o ID certo: optPrecBars
  const showPrecBars = !!(optPrecBars.checked && annualPrec && annualPrec.some(Number.isFinite));

  if (showPrecBars) {
    datasets.push({
      type: "bar",
      label: "Precipitação anual (mm)",
      data: annualPrec,
      yAxisID: "yP",
      borderWidth: 1,
      order: 3
    });
  }

  // 7) Render anual com eixo direito yP garantido
  if (chart) { chart.destroy(); chart = null; }

  chart = new Chart(ctx, {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (c) => {
              const lab = c.dataset?.label || "";
              const v = c.parsed?.y;
              return `${lab}: ${Number.isFinite(v) ? fmt(v, 2) : "sem dado"}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Ano" },
          ticks: { autoSkip: true, maxRotation: 0 },
          grid: { color: "rgba(255,255,255,.06)" }
        },
        y: {
          position: "left",
          title: { display: true, text: labelOfVar(V1) },
          grid: { color: "rgba(255,255,255,.06)" }
        },
        yP: {
          position: "right",
          display: showPrecBars,
          title: { display: showPrecBars, text: "Precipitação (mm)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  chartTitle.textContent = `Série anual — ${stationLabel}`;
  chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length - 1]} (por months).`;
  lastChartTitle = `serie_anual_${selectedStation.code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length - 1]}`;

  setKpis([
    { k: "Anos úteis", v: String(rows.filter(r => r.n > 0).length) },
    { k: "Média (anos)", v: fmt(meanFinite(rows.map(r => r.mean)), 2) },
    { k: "Min (ano)", v: fmt(minFinite(rows.map(r => r.min)), 2) },
    { k: "Max (ano)", v: fmt(maxFinite(rows.map(r => r.max)), 2) },
  ]);

  enableDownloads(true);
  setMsg("Pronto.", "ok");
  return;
}


  // ====== MODO 3: Mensal por ano (HEATMAP) ======
  if (mode==="monthSeries"){
    // monta grid ano×mês
    const grid = [];
    const points = [];
    const yearsAxis = yearsOk.slice();
    const valsAll = [];

    for (const y of yearsAxis){
      for (let m=1;m<=12;m++){
        const row = allMonths.find(r => r.year===y && r.m===m);
        const v = row ? row[V1] : NaN;
        if (Number.isFinite(v)) valsAll.push(v);
        grid.push({ ano:y, mes:m, valor: Number.isFinite(v) ? v : NaN });
      }
    }

    const vmin = minFinite(valsAll);
    const vmax = maxFinite(valsAll);

    heatMinEl.textContent = `${fmt(vmin,2)} (${labelOfVar(V1)})`;
    heatMaxEl.textContent = `${fmt(vmax,2)} (${labelOfVar(V1)})`;

    // dados para chart (usando scatter como "tiles" (quadradinhos))
    // cada ponto vira um quadradinho grande -> dá um efeito heatmap.
    // (simples, leve, funciona sem plugin extra)
    for (const cell of grid){
      points.push({
        x: cell.ano,
        y: cell.mes,
        v: cell.valor
      });
    }

    // tabela preview
    setTable(grid.map(c=>({
      ano: c.ano,
      mes: monthName(c.mes),
      valor: c.valor
    })));

    destroyChart();
    const ctx = $("chart").getContext("2d");

    chart = new Chart(ctx, {
      type:"scatter",
      data:{
        datasets:[{
          label: `Heatmap ${labelOfVar(V1)}`,
          data: points.map(p=>({x:p.x, y:p.y, v:p.v})),
          pointRadius: 10,
          pointHoverRadius: 12,
          pointStyle: "rectRounded",
          backgroundColor: (c)=>{
            const v = c.raw?.v;
            return colorForValue(v, vmin, vmax);
          }
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
            ticks:{
              callback:(v)=>monthName(v),
              stepSize:1
            },
            grid:{ color:"rgba(255,255,255,.06)" }
          }
        }
      }
    });

    chartTitle.textContent = `Mensal por ano (heatmap) — ${stationLabel}`;
    chartMeta.textContent = `Var: ${labelOfVar(V1)} • anos úteis: ${yearsAxis[0]}–${yearsAxis[yearsAxis.length-1]}`;
    lastChartTitle = `mensal_por_ano_${selectedStation.code}_${V1}_${yearsAxis[0]}_${yearsAxis[yearsAxis.length-1]}`;

    setKpis([
      { k:"Anos úteis", v: String(yearsAxis.length) },
      { k:"Min (tudo)", v: fmt(vmin,2) },
      { k:"Max (tudo)", v: fmt(vmax,2) },
      { k:"Média (tudo)", v: fmt(meanFinite(valsAll),2) }
    ]);

    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  // ====== MODO 4: Relação entre variáveis + tendência + R² ======
  if (mode==="relations"){
    if (V1===V2){
      setMsg("Escolha duas variáveis diferentes.", "warn");
      return;
    }

    const pts = [];
    for (const r of allMonths){
      const x = r[V1];
      const y = r[V2];
      if (Number.isFinite(x) && Number.isFinite(y)){
        pts.push({ periodo: `${r.year}-${String(r.m).padStart(2,"0")}`, x, y });
      }
    }

    if (pts.length<3){
      setMsg("Poucos pontos com dados para relação (precisa pelo menos 3).", "warn");
      setTable(pts);
      destroyChart();
      return;
    }

    setTable(pts);

    // dados para regressão
    const xs = pts.map(p=>p.x);
    const ys = pts.map(p=>p.y);

    // tendência
    let trend = buildTrend(xs, ys);

// fallback automático se o modelo escolhido falhar
let trendNote = "";
if (!trend) {
  const old = trendModel.value;
  trendModel.value = "linear";
  trend = buildTrend(xs, ys);
  trendModel.value = old;
  trendNote = " (fallback: linear)";
}

    // linha (amostra)
    let lineData = [];
    let r2 = NaN;

    if (trend){
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const N = 120;
      for (let i=0;i<=N;i++){
        const xx = minX + (maxX-minX)*i/N;
        const yy = trend.predict(xx);
        if (Number.isFinite(yy)) lineData.push({x:xx, y:yy});
      }
      const yhat = xs.map(xv => trend.predict(xv)).filter(Number.isFinite);
      const yuse = ys.filter((_,i)=>Number.isFinite(trend.predict(xs[i])));
      r2 = r2Of(yuse, yhat);
    }

    destroyChart();
    const ctx = $("chart").getContext("2d");

    const datasets = [{
      type:"scatter",
      label: `${labelOfVar(V1)} × ${labelOfVar(V2)}`,
      data: pts.map(p=>({x:p.x, y:p.y})),
      pointRadius: 3
    }];

    if (showTrend.checked && trend && lineData.length){
      datasets.push({
        type:"line",
        label: `Tendência: ${trend.name}`,
        data: lineData,
        borderWidth: 3,
        pointRadius: 0,
        tension: 0
      });
    }

    chart = new Chart(ctx, {
      data:{ datasets },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ position:"top" },
          tooltip:{
            callbacks:{
              afterBody: ()=>{
                if (showR2.checked && Number.isFinite(r2)){
                  return `R² = ${fmt(r2,4)}`;
                }
                return "";
              }
            }
          }
        },
        scales:{
          x:{ title:{display:true, text:labelOfVar(V1)}, grid:{ color:"rgba(255,255,255,.06)"} },
          y:{ title:{display:true, text:labelOfVar(V2)}, grid:{ color:"rgba(255,255,255,.06)"} }
        }
      }
    });

    const r2Txt = (showR2.checked && Number.isFinite(r2)) ? ` • R²=${fmt(r2,4)}` : "";
chartTitle.textContent = `Relação entre variáveis — ${stationLabel}`;
chartMeta.textContent = `${labelOfVar(V1)} vs ${labelOfVar(V2)} • pontos: ${pts.length}${r2Txt}${trendNote}`;


    setKpis([
      { k:"Pontos", v: String(pts.length) },
      { k:"X min", v: fmt(minFinite(xs),2) },
      { k:"X max", v: fmt(maxFinite(xs),2) },
      { k:"R²", v: Number.isFinite(r2) ? fmt(r2,4) : "—" }
    ]);

    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }
}

// ====== seleção de estação ======
async function selectStation(code, panTo=false){
  const s = STATIONS.find(x=>x.code===code);
  if (!s) return;

  selectedStation = s;
  stationSelect.value = s.code;

  pillStation.textContent = `Estação: ${s.code}`;
  stationHint.textContent = `${s.name} • ${s.uf} • lat ${fmt(s.lat,4)} lon ${fmt(s.lon,4)}`;

  const candidate = yearsForStation(s.code).slice().sort((a,b)=>a-b);
  if (!candidate.length){
    yearStart.innerHTML=""; yearEnd.innerHTML="";
    pillYears.textContent = "Anos: —";
    setMsg("Essa estação não tem anos listados no years.json", "warn");
    return;
  }

  setMsg("Checando anos com dados reais…", "warn");
  const { okYears, missingFiles } = await findAvailableYearsWithData(s.code, candidate);

  if (!okYears.length){
    pillData.textContent = `Dados: 0 ano(s) úteis • ${missingFiles} faltando`;
    populateYearsAuto(candidate);
    setMsg("Não achei nenhum ano com dados úteis. Pode ser caminho errado em assets/data/.", "bad");
  }else{
    populateYearsAuto(okYears);
    pillData.textContent = `Dados: ${okYears.length} ano(s) úteis • ${missingFiles} faltando`;
    setMsg("Pronto. Clique em “Gerar”.", "ok");

    // descobre variáveis (pega o primeiro ano útil)
   // descobre variáveis olhando alguns anos úteis (não só o primeiro)
const sampleYears = okYears.slice(0, Math.min(5, okYears.length));
const keys = new Set();

for (const y of sampleYears) {
  try {
    const pack = await loadStationYear(s.code, y);
    const vs = discoverVariablesFromPack(pack);
    for (const v of vs) keys.add(v);
  } catch {}
}

const vars = Array.from(keys);
vars.sort((a,b)=>labelOfVar(a).localeCompare(labelOfVar(b)));
populateVarSelects(vars);
  }

  if (panTo && MAP) MAP.setView([s.lat, s.lon], 8, { animate:true });
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

// listeners
ufSelect.addEventListener("change", ()=>{ selectedUF = ufSelect.value; populateStationSelect(); });
searchStation.addEventListener("input", populateStationSelect);
stationSelect.addEventListener("change", ()=>selectStation(stationSelect.value, true));

tabMonthly.addEventListener("click", ()=>setMode("monthly"));
tabAnnual.addEventListener("click", ()=>setMode("annual"));
tabMonthSeries.addEventListener("click", ()=>setMode("monthSeries"));
tabRelations.addEventListener("click", ()=>setMode("relations"));

trendModel.addEventListener("change", ()=>{
  polyDegreeBox.style.display = (trendModel.value==="poly") ? "block" : "none";
});

btnRender.addEventListener("click", ()=>render().catch(err=>{
  console.error(err);
  setMsg(`Erro: ${err.message}`, "bad");
}));

btnPNG.addEventListener("click", chartToPNG);
btnCSV.addEventListener("click", tableToCSV);
btnReset.addEventListener("click", resetAll);

// boot
(async function boot(){
  try{
    setMsg("Carregando base…", "warn");
    initMap();

    const stationsRaw = await fetchJSON("assets/stations.json");
    STATIONS = normalizeStations(stationsRaw);

    YEARS_INDEX = await fetchJSON("assets/years.json");

    populateUF();
    populateStationSelect();
    setMode("monthly");

    trendModel.dispatchEvent(new Event("change"));

    const first = filterStations()[0];
    if (first) await selectStation(first.code, false);

    chartTitle.textContent = "Selecione uma estação e clique em Gerar";
    chartMeta.textContent = "O sistema ignora meses/anos nulos e usa só o que existe.";
  }catch(err){
    console.error(err);
    setMsg(`Falha ao iniciar: ${err.message}`, "bad");
  }
})();
