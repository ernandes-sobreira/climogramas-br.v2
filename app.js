/* Transforma-Ação Climática — Climogramas do Brasil (INMET)
   Front-end leve: Leaflet + MarkerCluster + Chart.js (zoom)
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

let chartTemp = null;
let chartRain = null;

function setStatus(text, ok=true){
  const pill = $("statusPill");
  pill.textContent = text;
  pill.style.background = ok ? "rgba(11,111,117,.12)" : "rgba(220,38,38,.12)";
  pill.style.borderColor = ok ? "rgba(11,111,117,.18)" : "rgba(220,38,38,.18)";
  pill.style.color = ok ? "#0b6f75" : "#b91c1c";
}

function normText(s){
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

/* ---------------- Base load ---------------- */
async function loadBase(){
  setStatus("Carregando estações…");
  const st = await fetchJson("assets/stations.json");
  stations = Array.isArray(st) ? st : (st.stations || []);
  if(!stations.length) throw new Error("assets/stations.json vazio/inválido.");

  setStatus("Carregando anos…");
  const ys = await fetchJson("assets/years.json");
  yearsAll = Array.isArray(ys) ? ys : (ys.years || []);
  yearsAll = yearsAll.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!yearsAll.length) yearsAll = [2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024];

  fillYearSelect(yearsAll);
  $("stationCount").textContent = stations.length;

  renderList(stations);
  initMap();

  setStatus("Pronto ✅");
}

function fillYearSelect(yrs){
  const sel = $("yearSelect");
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

/* ---------------- Stations helpers ---------------- */
function stationLabel(s){
  const id = s.id ?? s.ID ?? s.codigo ?? s.codigo_wmo ?? s.wmo ?? s.station_id;
  const name = s.name ?? s.NOME ?? s.estacao ?? s.station ?? "";
  const uf = s.uf ?? s.UF ?? "";
  return {id: String(id), name, uf};
}

function stationLatLng(s){
  const lat = Number(s.lat ?? s.latitude ?? s.LATITUDE);
  const lon = Number(s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE);
  return [lat, lon];
}

/* ---------------- List ---------------- */
function renderList(arr){
  const box = $("stationList");
  box.innerHTML = "";

  arr.forEach(s=>{
    const {id,name,uf} = stationLabel(s);
    const [lat, lon] = stationLatLng(s);

    const div = document.createElement("div");
    div.className = "item";
    div.dataset.id = id;

    div.innerHTML = `
      <div class="name">${(name||"(sem nome)")}${uf?` <span style="opacity:.9">(${uf})</span>`:""}</div>
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

/* ---------------- Map ---------------- */
function initMap(){
  map = L.map("map", {zoomControl:true}).setView([-14.2, -52.6], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  cluster = L.markerClusterGroup({
    showCoverageOnHover:false,
    chunkedLoading:true,
    chunkInterval: 50
  });

  stations.forEach(s=>{
    const {id,name,uf} = stationLabel(s);
    const [lat, lon] = stationLatLng(s);
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const m = L.marker([lat, lon], {title: `${name} (${uf})`});
    m.on("click", ()=> selectStationById(id, false));
    m.bindPopup(`<b>${name}</b>${uf?` (${uf})`:""}<br/>ID ${id}`);

    markersById.set(String(id), m);
    cluster.addLayer(m);
  });

  map.addLayer(cluster);
}

function zoomToStation(id, zoom=9){
  const m = markersById.get(String(id));
  if(!m) return;
  const ll = m.getLatLng();
  map.setView(ll, zoom, {animate:true});
  m.openPopup();
}

/* ---------------- Year probing ---------------- */
async function probeYearsForStation(id, years){
  const exists = [];

  async function hasYear(y){
    const url = `assets/data/${id}/${y}.json`;
    try{
      const r = await fetch(url, {method:"HEAD", cache:"no-store"});
      return r.ok;
    }catch{ return false; }
  }

  // teste rápido
  const first = years[0], last = years[years.length-1];
  const quick = [...new Set([last,last-1,last-2,Math.round((first+last)/2),first,first+1])].filter(y=>years.includes(y));
  let any = false;
  for(const y of quick){
    // eslint-disable-next-line no-await-in-loop
    if(await hasYear(y)){ any = true; break; }
  }
  if(!any){
    // varre tudo
    for(const y of years){
      // eslint-disable-next-line no-await-in-loop
      if(await hasYear(y)) exists.push(y);
    }
    return exists;
  }

  // existe algum: varre tudo (simples e robusto)
  for(const y of years){
    // eslint-disable-next-line no-await-in-loop
    if(await hasYear(y)) exists.push(y);
  }
  return exists;
}

/* ---------------- Selection ---------------- */
async function selectStationById(id, fromList){
  const s = stations.find(x => stationLabel(x).id === String(id));
  if(!s) return;

  selectedStation = s;
  setActiveListItem(id);

  // sempre dá zoom ao selecionar
  zoomToStation(id, 9);

  // scroll lista
  if(fromList){
    const el = document.querySelector(`.item[data-id="${CSS.escape(String(id))}"]`);
    el?.scrollIntoView({block:"center", behavior:"smooth"});
  }

  // mobile: fecha painel após selecionar
  if(window.matchMedia("(max-width:1100px)").matches){
    $("leftPanel").classList.remove("open");
    $("toggleStations").textContent = "Abrir";
  }

  await loadStationYearsAndData();
}

async function loadStationYearsAndData(){
  const {id,name,uf} = stationLabel(selectedStation);
  $("stationTitle").textContent = `${name || "(sem nome)"}${uf?` (${uf})`:""}`;
  const [lat, lon] = stationLatLng(selectedStation);
  $("stationMeta").textContent = `ID ${id} • ${Number.isFinite(lat)&&Number.isFinite(lon) ? `${lat.toFixed(1)}, ${lon.toFixed(1)}` : ""}`;

  setStatus("Carregando dados…");

  // se já tiver anos embutidos no stations.json
  const yList = selectedStation.years || selectedStation.anos || selectedStation.available_years;
  if(Array.isArray(yList) && yList.length){
    stationYears = yList.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  }else{
    stationYears = await probeYearsForStation(id, yearsAll);
  }

  if(!stationYears.length){
    $("kYears").textContent = "0";
    setStatus("Sem anos nessa estação", false);
    clearRightPanel("Sem dados disponíveis para essa estação.");
    return;
  }

  $("kYears").textContent = `${stationYears[0]}–${stationYears[stationYears.length-1]} (${stationYears.length})`;

  fillYearSelect(stationYears);
  selectedYear = Number($("yearSelect").value);

  await loadStationYear(id, selectedYear);
}

async function loadStationYear(id, year){
  selectedYear = year;
  const path = `assets/data/${id}/${year}.json`;

  try{
    const data = await fetchJson(path);
    setStatus("Pronto ✅");
    renderRightPanel(data);
  }catch(err){
    setStatus("Erro ao carregar dados", false);
    clearRightPanel(`Não encontrei ${id}/${year}.json em assets/data/${id}/`);
    console.error(err);
  }
}

/* ---------------- Right panel ---------------- */
function clearRightPanel(msg){
  $("kTmin").textContent = "—";
  $("kTmean").textContent = "—";
  $("kTmax").textContent = "—";
  $("kPtotal").textContent = "—";
  $("kPmean").textContent = "—";
  $("kPmax").textContent = "—";
  $("kPmin").textContent = "—";
  $("summary").textContent = msg;

  if(chartTemp){ chartTemp.destroy(); chartTemp=null; }
  if(chartRain){ chartRain.destroy(); chartRain=null; }
}

function pickExtreme(months, key, mode){
  const vals = months
    .map(m => ({m: m.m, v: m[key]}))
    .filter(x => x.v != null && Number.isFinite(x.v));
  if(!vals.length) return null;
  vals.sort((a,b)=> mode==="max" ? (b.v-a.v) : (a.v-b.v));
  return vals[0];
}

function renderRightPanel(d){
  const annual = d.annual || {};
  const months = d.months || [];

  // Temp KPIs
  $("kTmin").textContent  = (annual.tmin_c!=null) ? `${fmt(annual.tmin_c,1)} °C` : "—";
  $("kTmean").textContent = (annual.tmean_c!=null) ? `${fmt(annual.tmean_c,1)} °C` : "—";
  $("kTmax").textContent  = (annual.tmax_c!=null) ? `${fmt(annual.tmax_c,1)} °C` : "—";

  // Precip KPIs
  $("kPtotal").textContent = (annual.prec_total_mm!=null) ? `${fmt(annual.prec_total_mm,1)} mm` : "—";

  const pVals = months.map(m => m.prec_mm ?? null).filter(v => v!=null && Number.isFinite(v));
  const pMean = (annual.prec_total_mm!=null) ? (annual.prec_total_mm/12) : (pVals.length ? (pVals.reduce((a,b)=>a+b,0)/12) : null);
  const pMax = pVals.length ? Math.max(...pVals) : null;
  const pMin = pVals.length ? Math.min(...pVals) : null;

  $("kPmean").textContent = (pMean!=null) ? `${fmt(pMean,1)} mm` : "—";
  $("kPmax").textContent = (pMax!=null) ? `${fmt(pMax,1)} mm` : "—";
  $("kPmin").textContent = (pMin!=null) ? `${fmt(pMin,1)} mm` : "—";

  // resumo
  const hottest = pickExtreme(months, "tmean_c", "max");
  const coldest = pickExtreme(months, "tmean_c", "min");
  const wettest = pickExtreme(months, "prec_mm", "max");
  const driest  = pickExtreme(months, "prec_mm", "min");

  const y = d.year ?? selectedYear;
  const id = d?.meta?.id ?? d?.id ?? "—";

  $("summary").innerHTML = `
    <div><b>🧭 ${id} • ${y}</b></div>
    <div>🌧️ Mês mais chuvoso: ${wettest ? `<b>${MONTHS[wettest.m-1]}</b> (${fmt(wettest.v,1)} mm)` : "—"}</div>
    <div>🏜️ Mês mais seco: ${driest ? `<b>${MONTHS[driest.m-1]}</b> (${fmt(driest.v,1)} mm)` : "—"}</div>
    <div>🔥 Mês mais quente: ${hottest ? `<b>${MONTHS[hottest.m-1]}</b> (${fmt(hottest.v,1)} °C)` : "—"}</div>
    <div>❄️ Mês mais fresco: ${coldest ? `<b>${MONTHS[coldest.m-1]}</b> (${fmt(coldest.v,1)} °C)` : "—"}</div>
    <div style="margin-top:8px;color:#4e6b75;font-size:12px">
      Dado mensal: chuva = soma do mês; T = média do mês; Tmin/Tmax = extremos do mês (hora a hora).
    </div>
  `;

  renderCharts(d);
}

/* ---------------- Charts (TABS) ---------------- */
function activeTab(){
  return $("chartRain").classList.contains("hidden") ? "temp" : "rain";
}

function ensureCharts(){
  if(chartTemp && chartRain) return;

  // plugin zoom (global)
  if (window.ChartZoom) {
    Chart.register(window.ChartZoom);
  } else if (window["chartjs-plugin-zoom"]) {
    Chart.register(window["chartjs-plugin-zoom"]);
  }
  // em muitos builds, o plugin já vem registrado; se der erro, não quebra.

  const baseOptions = {
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

  chartTemp = new Chart($("chartTemp").getContext("2d"), {
    type:"line",
    data:{ labels: MONTHS, datasets: [] },
    options:{
      ...baseOptions,
      scales:{
        ...baseOptions.scales,
        y:{ title:{ display:true, text:"Temperatura (°C)" }, grid:{ color:"rgba(11,34,48,.08)" } }
      }
    }
  });

  chartRain = new Chart($("chartRain").getContext("2d"), {
    type:"bar",
    data:{ labels: MONTHS, datasets: [] },
    options:{
      ...baseOptions,
      scales:{
        ...baseOptions.scales,
        y:{ title:{ display:true, text:"Precipitação (mm)" }, beginAtZero:true, grid:{ color:"rgba(11,34,48,.08)" } }
      }
    }
  });

  // dblclick reset
  $("chartTemp").addEventListener("dblclick", ()=> chartTemp?.resetZoom?.());
  $("chartRain").addEventListener("dblclick", ()=> chartRain?.resetZoom?.());
}

function renderCharts(d){
  ensureCharts();

  const months = d.months || [];
  const annual = d.annual || {};

  // arrays 12
  const prec  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.prec_mm ?? null);
  const tmean = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmean_c ?? null);
  const tmin  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmin_c ?? null);
  const tmax  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmax_c ?? null);

  // linhas médias
  const tMeanLine = (annual.tmean_c!=null) ? MONTHS.map(()=>annual.tmean_c) : MONTHS.map(()=>null);
  const pMeanLine = (annual.prec_total_mm!=null) ? MONTHS.map(()=>annual.prec_total_mm/12) : MONTHS.map(()=>null);

  // extra var
  const extraKey = $("extraVar").value;
  let extraArr = null;
  let extraLabel = "";
  if(extraKey && d.vars && d.vars[extraKey] && Array.isArray(d.vars[extraKey].months) && d.vars[extraKey].months.length === 12){
    extraArr = d.vars[extraKey].months.map(v => (v==null ? null : Number(v)));
    extraLabel = $("extraVar").selectedOptions[0].textContent;
  }

  // TEMP chart
  chartTemp.data.labels = MONTHS;
  chartTemp.data.datasets = [
    { label:"Temp. média (°C)", data:tmean, borderWidth:2, pointRadius:2, tension:.25 },
    { label:"Média anual (T)", data:tMeanLine, borderWidth:2, pointRadius:0, borderDash:[6,6], tension:0 },
    { label:"T máx (°C)", data:tmax, borderWidth:1.6, pointRadius:0, borderDash:[4,4], tension:.2 },
    { label:"T mín (°C)", data:tmin, borderWidth:1.6, pointRadius:0, borderDash:[4,4], tension:.2 },
  ].concat(extraArr ? [{
      label: extraLabel,
      data: extraArr,
      borderWidth:2,
      pointRadius:1,
      tension:.2
  }] : []);
  chartTemp.update();

  // RAIN chart
  chartRain.data.labels = MONTHS;
  chartRain.data.datasets = [
    { type:"bar", label:"Precipitação (mm)", data:prec, borderWidth:0 },
    { type:"line", label:"Chuva média (total/12)", data:pMeanLine, borderWidth:2, pointRadius:0, borderDash:[6,6], tension:.2 },
  ];
  chartRain.update();
}

/* ---------------- Events ---------------- */
$("yearSelect").addEventListener("change", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  await loadStationYear(id, Number($("yearSelect").value));
});

$("extraVar").addEventListener("change", ()=>{
  // re-render gráfico mantendo os dados já carregados
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  loadStationYear(id, selectedYear);
});

$("btnResetZoom").addEventListener("click", ()=>{
  if(chartTemp) chartTemp.resetZoom?.();
  if(chartRain) chartRain.resetZoom?.();
});

$("btnAll").addEventListener("click", ()=>{
  map.setView([-14.2, -52.6], 4, {animate:true});
});

$("btnFocus").addEventListener("click", ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  zoomToStation(id, 10);
});

$("q").addEventListener("input", ()=>{
  const q = normText($("q").value);
  if(!q){ renderList(stations); return; }
  const filtered = stations.filter(s=>{
    const {id,name,uf} = stationLabel(s);
    return normText(`${id} ${name} ${uf}`).includes(q);
  });
  renderList(filtered);
});

$("clearSearch").addEventListener("click", ()=>{
  $("q").value = "";
  renderList(stations);
});

$("toggleStations").addEventListener("click", ()=>{
  const panel = $("leftPanel");
  panel.classList.toggle("open");
  $("toggleStations").textContent = panel.classList.contains("open") ? "Fechar" : "Abrir";
});

$("tabTemp").addEventListener("click", ()=>{
  $("tabTemp").classList.add("active");
  $("tabRain").classList.remove("active");
  $("chartTemp").classList.remove("hidden");
  $("chartRain").classList.add("hidden");
});

$("tabRain").addEventListener("click", ()=>{
  $("tabRain").classList.add("active");
  $("tabTemp").classList.remove("active");
  $("chartRain").classList.remove("hidden");
  $("chartTemp").classList.add("hidden");
});

$("btnPng").addEventListener("click", ()=>{
  const isRain = activeTab() === "rain";
  const ch = isRain ? chartRain : chartTemp;
  if(!ch) return;

  const a = document.createElement("a");
  a.href = ch.toBase64Image("image/png", 1);
  const st = selectedStation ? stationLabel(selectedStation) : {id:"station"};
  a.download = `climograma_${isRain ? "chuva":"temp"}_${st.id}_${selectedYear}.png`;
  a.click();
});

$("btnCsv").addEventListener("click", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  try{
    const d = await fetchJson(`assets/data/${id}/${selectedYear}.json`);

    const rows = (d.months||[]).map(m=>({
      ano: d.year ?? selectedYear,
      mes: m.m,
      mes_nome: MONTHS[m.m-1],
      prec_mm: m.prec_mm ?? "",
      tmean_c: m.tmean_c ?? "",
      tmin_c: m.tmin_c ?? "",
      tmax_c: m.tmax_c ?? "",
      rh: d.vars?.rh?.months?.[m.m-1] ?? "",
      press: d.vars?.press?.months?.[m.m-1] ?? "",
      rad: d.vars?.rad?.months?.[m.m-1] ?? "",
      wind: d.vars?.wind?.months?.[m.m-1] ?? ""
    }));

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

/* ---------------- Start ---------------- */
loadBase().catch(err=>{
  console.error(err);
  setStatus("Erro ao iniciar", false);
  alert("Erro ao iniciar o app. Veja o console (F12).");
});
