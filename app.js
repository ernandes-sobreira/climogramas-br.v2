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

// base relativa robusta
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

// ====== LEITURA DO TEU JSON (MENSAL/ANUAL) ======
async function loadStationYearMonthly(code, year){
  const key = `${code}_${year}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const raw = await fetchJSON(`assets/data/${code}/${year}.json`);

  // teu padrão real:
  // { station:"A001", year:2000, months:[{m,p,tmean},...], annual:{...} }
  const months = Array.isArray(raw.months) ? raw.months : [];
  const annual = raw.annual || null;

  const normMonths = months.map(x => ({
    year,
    m: Number(x.m),
    p: parseNum(x.p),
    tmean: parseNum(x.tmean),
    tmin: parseNum(x.tmin),
    tmax: parseNum(x.tmax)
  })).filter(r => r.m>=1 && r.m<=12);

  const out = { year, months: normMonths, annual };
  CACHE.set(key, out);
  return out;
}

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

function getVarLabel(id){
  if (id==="temp") return "Temperatura (°C)";
  if (id==="prec") return "Precipitação (mm)";
  return id;
}

function populateVars(){
  var1.innerHTML = "";
  var2.innerHTML = "";
  var1.appendChild(new Option("Temperatura (°C)", "temp"));
  var1.appendChild(new Option("Precipitação (mm)", "prec"));
  var2.appendChild(new Option("Precipitação (mm)", "prec"));
  var2.appendChild(new Option("Temperatura (°C)", "temp"));
  var1.value = "temp";
  var2.value = "prec";
}

async function findAvailableYearsWithData(code, years){
  // tenta achar quais anos realmente tem algum dado (tmean ou p em qualquer mês)
  const okYears = [];
  let missingFiles = 0;

  for (const y of years){
    try{
      const pack = await loadStationYearMonthly(code, y);
      const has = pack.months.some(r => Number.isFinite(r.tmean) || Number.isFinite(r.p));
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
      plugins:{ legend:{ position:"top" } },
      scales:{
        x:{ grid:{ color:"rgba(255,255,255,.06)" } },
        y:{ position:"left", title:{ display:true, text:yLabel||"" }, grid:{ color:"rgba(255,255,255,.06)" } },
        y2:{ position:"right", title:{ display:!!y2Label, text:y2Label||"" }, grid:{ drawOnChartArea:false } }
      }
    }
  });
}

async function render(){
  enableDownloads(false);
  subPanel.innerHTML = "";
  setKpis([]);

  if (!selectedStation){ setMsg("Selecione uma estação.", "warn"); return; }
  const [y0,y1] = currentYears();
  if (!Number.isFinite(y0) || !Number.isFinite(y1)){ setMsg("Selecione os anos.", "warn"); return; }

  const years = yearsForStation(selectedStation.code).filter(y => y>=y0 && y<=y1).sort((a,b)=>a-b);
  if (!years.length){
    setMsg("Intervalo sem anos cadastrados para essa estação.", "warn");
    return;
  }

  pillData.textContent = `Dados: carregando (${years.length} ano(s))…`;

  const allPacks = [];
  let missingFiles = 0;
  for (const y of years){
    try{
      const pack = await loadStationYearMonthly(selectedStation.code, y);
      allPacks.push(pack);
    }catch{
      missingFiles++;
    }
  }

  // junta todos os meses
  const allMonths = [];
  for (const p of allPacks) allMonths.push(...p.months);

  const hasAny = allMonths.some(r => Number.isFinite(r.tmean) || Number.isFinite(r.p));
  if (!hasAny){
    pillData.textContent = `Dados: 0 ano(s) úteis • ${missingFiles} faltando`;
    setMsg("Sem dados úteis no intervalo (anos ausentes ou JSON vazio).", "bad");
    setTable([]);
    destroyChart();
    chartTitle.textContent = "Sem dados";
    chartMeta.textContent = "—";
    return;
  }

  // meta
  const yearsOk = unique(allMonths.map(r=>r.year)).sort((a,b)=>a-b);
  pillData.textContent = `Dados: ${yearsOk.length} ano(s) úteis • ${missingFiles} faltando • meses=${allMonths.length}`;

  const stationLabel = `${selectedStation.code} • ${selectedStation.name} (${selectedStation.uf})`;

  // ====== MODO CLIMOGRAMA (MÉDIA MENSAL MULTI-ANOS) ======
  if (mode==="monthly"){
    const out = [];
    for (let m=1;m<=12;m++){
      const rows = allMonths.filter(r => r.m===m);
      out.push({
        mes: m,
        tmean: meanFinite(rows.map(r=>r.tmean)),
        p: meanFinite(rows.map(r=>r.p)),
        n: rows.filter(r => Number.isFinite(r.tmean) || Number.isFinite(r.p)).length
      });
    }

    setTable(out);

    const labels = out.map(r => ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][r.mes-1]);
    const datasets = [];

    if (optPrecBars.checked){
      datasets.push({ type:"bar", label:"Precipitação média (mm)", data: out.map(r=>r.p), yAxisID:"y2" });
    }

    datasets.push({ type:"line", label:"Temperatura média (°C)", data: out.map(r=>r.tmean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:0.25 });

    renderChart(labels, datasets, "Temperatura (°C)", optPrecBars.checked ? "Precipitação (mm)" : "");

    chartTitle.textContent = `Climograma (média mensal) — ${stationLabel}`;
    chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length-1]} (ignorando meses nulos).`;
    lastChartTitle = `climograma_${selectedStation.code}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}`;

    // KPIs rápidos
    const tAll = out.map(r=>r.tmean);
    const pAll = out.map(r=>r.p);
    setKpis([
      { k:"Temp média", v: fmt(meanFinite(tAll),1) },
      { k:"Temp min (mês)", v: fmt(minFinite(tAll),1) },
      { k:"Temp max (mês)", v: fmt(maxFinite(tAll),1) },
      { k:"Prec média mês", v: fmt(meanFinite(pAll),1) }
    ]);

    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  // ====== MODO SÉRIE ANUAL ======
  if (mode==="annual"){
    // usa annual quando existir; se não, estima do months
    const rows = [];
    for (const y of years){
      const pack = allPacks.find(p=>p.year===y);
      if (!pack) continue;

      const ann = pack.annual || {};
      const pTotal = parseNum(ann.p_total);
      const tMean = parseNum(ann.tmean);

      const pFromMonths = sumFinite(pack.months.map(r=>r.p));
      const tFromMonths = meanFinite(pack.months.map(r=>r.tmean));

      rows.push({
        ano: y,
        tmean: Number.isFinite(tMean) ? tMean : tFromMonths,
        p_total: Number.isFinite(pTotal) ? pTotal : pFromMonths
      });
    }

    setTable(rows);

    const labels = rows.map(r=>r.ano);
    const datasets = [];

    // Var1 controla o principal
    const main = var1.value;

    if (main==="temp"){
      datasets.push({ type:"line", label:"Temperatura média anual (°C)", data: rows.map(r=>r.tmean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:0.25 });
      if (optPrecBars.checked){
        datasets.push({ type:"bar", label:"Precipitação total anual (mm)", data: rows.map(r=>r.p_total), yAxisID:"y2" });
      }
      renderChart(labels, datasets, "Temperatura (°C)", optPrecBars.checked ? "Precipitação (mm/ano)" : "");
    }else{
      datasets.push({ type:"bar", label:"Precipitação total anual (mm)", data: rows.map(r=>r.p_total), yAxisID:"y", });
      datasets.push({ type:"line", label:"Temperatura média anual (°C)", data: rows.map(r=>r.tmean), yAxisID:"y2", borderWidth:3, pointRadius:3, tension:0.25 });
      renderChart(labels, datasets, "Precipitação (mm/ano)", "Temperatura (°C)");
    }

    chartTitle.textContent = `Série anual — ${stationLabel}`;
    chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length-1]} (se annual faltar, estima por months).`;
    lastChartTitle = `serie_anual_${selectedStation.code}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}`;

    setKpis([
      { k:"Anos úteis", v: String(rows.filter(r=>Number.isFinite(r.tmean)||Number.isFinite(r.p_total)).length) },
      { k:"Temp média (anos)", v: fmt(meanFinite(rows.map(r=>r.tmean)),1) },
      { k:"Prec total médio", v: fmt(meanFinite(rows.map(r=>r.p_total)),1) }
    ]);

    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  // ====== RELAÇÃO ENTRE VARIÁVEIS (por mês agregado) ======
  if (mode==="relations"){
    const A = var1.value;
    const B = var2.value;
    if (A===B){ setMsg("Escolha duas variáveis diferentes.", "warn"); return; }

    // cria pontos (ano-mês)
    const pts = [];
    for (const r of allMonths){
      const x = (A==="temp") ? r.tmean : r.p;
      const y = (B==="temp") ? r.tmean : r.p;
      if (Number.isFinite(x) && Number.isFinite(y)){
        pts.push({ periodo: `${r.year}-${String(r.m).padStart(2,"0")}`, x, y });
      }
    }

    setTable(pts);

    destroyChart();
    const ctx = $("chart").getContext("2d");
    chart = new Chart(ctx, {
      type:"scatter",
      data:{ datasets:[{ label:`${getVarLabel(A)} × ${getVarLabel(B)}`, data: pts.map(p=>({x:p.x, y:p.y})), pointRadius:3 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ title:{display:true, text:getVarLabel(A)} },
          y:{ title:{display:true, text:getVarLabel(B)} }
        }
      }
    });

    chartTitle.textContent = `Relação entre variáveis — ${stationLabel}`;
    chartMeta.textContent = `Pontos: ano-mês com ambos valores não-nulos.`;
    lastChartTitle = `relacao_${selectedStation.code}_${A}_x_${B}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}`;

    enableDownloads(true);
    setMsg("Pronto.", "ok");
    return;
  }

  setMsg("Modo 'Mensal por ano' eu ativo na próxima rodada. O grosso já está funcionando.", "warn");
}

// ====== SELEÇÃO DE ESTAÇÃO: ajusta anos automaticamente ======
async function selectStation(code, panTo=false){
  const s = STATIONS.find(x=>x.code===code);
  if (!s) return;

  selectedStation = s;
  stationSelect.value = s.code;

  pillStation.textContent = `Estação: ${s.code}`;
  stationHint.textContent = `${s.name} • ${s.uf} • lat ${fmt(s.lat,4)} lon ${fmt(s.lon,4)}`;

  populateVars();

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
    populateYearsAuto(candidate); // pelo menos mostra algo
    setMsg("Não encontrei nenhum ano com dados úteis (p/tmean). Pode ser caminho errado em assets/data/.", "bad");
  }else{
    populateYearsAuto(okYears);
    pillData.textContent = `Dados: ${okYears.length} ano(s) úteis • ${missingFiles} faltando`;
    setMsg("Pronto. Agora clique em “Gerar”.", "ok");
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

    const first = filterStations()[0];
    if (first) await selectStation(first.code, false);

    chartTitle.textContent = "Selecione uma estação e clique em Gerar";
    chartMeta.textContent = "O sistema ignora meses/anos nulos e usa só o que existe.";
  }catch(err){
    console.error(err);
    setMsg(`Falha ao iniciar: ${err.message}`, "bad");
  }
})();
