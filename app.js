/* Transforma-Ação Climática — Climogramas do Brasil (INMET)
   Arquitetura esperada:
   - index.html, styles.css, app.js na raiz (main)
   - assets/stations.json
   - assets/years.json   (lista 2000..2024)
   - assets/data/<ID>/<ANO>.json
*/

const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

let stations = [];
let yearsAll = [];
let selectedStation = null;
let stationYears = [];
let selectedYear = null;

let map, cluster;
const markersById = new Map();

let chartTemp = null;
let chartPrec = null;

const yearExistsCache = new Map(); // key = `${id}|${year}` => true/false

function setStatus(text, ok=true){
  const pill = $("statusPill");
  pill.textContent = text;
  pill.style.background = ok ? "rgba(255,255,255,.12)" : "rgba(255,200,200,.18)";
  pill.style.borderColor = ok ? "rgba(255,255,255,.18)" : "rgba(255,180,180,.30)";
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
  const r = await fetch(path, { cache:"no-store" });
  if(!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
  return await r.json();
}

/* ---------- Station helpers ---------- */
function stationLabel(s){
  const id = (s.id ?? s.ID ?? s.codigo ?? s.codigo_wmo ?? s.wmo ?? s.station_id ?? "").toString().trim();
  const name = (s.name ?? s.NOME ?? s.estacao ?? s.station ?? "").toString().trim();
  const uf = (s.uf ?? s.UF ?? "").toString().trim();
  return { id, name, uf };
}

function stationLatLng(s){
  const lat = Number(s.lat ?? s.latitude ?? s.LATITUDE);
  const lon = Number(s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE);
  return [lat, lon];
}

/* ---------- UI: Years ---------- */
function fillYearSelect(list){
  const sel = $("yearSelect");
  sel.innerHTML = "";
  list.forEach(y=>{
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  });
  if(list.length){
    sel.value = String(list[list.length-1]);
    selectedYear = Number(sel.value);
  }
}

/* ---------- UI: Stations list ---------- */
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
        <span>ID ${id || "—"}</span>
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

/* ---------- Map ---------- */
function initMap(){
  map = L.map("map", { zoomControl:true }).setView([-14.2, -52.6], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  cluster = L.markerClusterGroup({
    showCoverageOnHover:false,
    chunkedLoading:true,
    chunkInterval: 60
  });

  stations.forEach(s=>{
    const {id,name,uf} = stationLabel(s);
    const [lat, lon] = stationLatLng(s);
    if(!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const m = L.marker([lat, lon], { title: `${name} (${uf})` });
    m.on("click", ()=> selectStationById(id, false));
    m.bindPopup(`<b>${name || "(sem nome)"}</b>${uf?` (${uf})`:""}<br/>ID ${id}`);

    markersById.set(String(id), m);
    cluster.addLayer(m);
  });

  map.addLayer(cluster);
  $("mapPill").textContent = `596 pontos`; // você pode trocar por stations.length
}

function zoomToStation(id){
  const m = markersById.get(String(id));
  if(!m) return;
  const ll = m.getLatLng();
  map.setView(ll, 9, { animate:true });
  m.openPopup();
}

/* ---------- Chart setup ---------- */
function buildBaseChart(ctx, type, yLabel){
  // plugin zoom (global)
  Chart.register(window.ChartZoom);

  return new Chart(ctx, {
    type,
    data: { labels: MONTHS, datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:"index", intersect:false },
      plugins: {
        legend: { position:"top" },
        tooltip: {
          callbacks: {
            label: (c) => {
              const v = c.parsed.y;
              if(v === null || v === undefined || Number.isNaN(v)) return `${c.dataset.label}: —`;
              return `${c.dataset.label}: ${Number(v).toFixed(1)}`;
            }
          }
        },
        zoom: {
          zoom: { wheel:{enabled:true}, pinch:{enabled:true}, mode:"x" },
          pan: { enabled:true, mode:"x" }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          title: { display:true, text: yLabel },
          grid: { color:"rgba(11,34,48,.08)" }
        },
        x: { grid: { color:"rgba(11,34,48,.06)" } }
      }
    }
  });
}

function ensureCharts(){
  if(!chartTemp){
    chartTemp = buildBaseChart($("chartTemp").getContext("2d"), "line", "Temperatura (°C)");
    $("chartTemp").addEventListener("dblclick", ()=> chartTemp?.resetZoom?.());
  }
  if(!chartPrec){
    chartPrec = buildBaseChart($("chartPrec").getContext("2d"), "bar", "Precipitação (mm)");
    $("chartPrec").addEventListener("dblclick", ()=> chartPrec?.resetZoom?.());
  }
}

function resetZoom(){
  const active = document.querySelector(".tab.active")?.dataset?.tab;
  if(active === "prec") chartPrec?.resetZoom?.();
  else chartTemp?.resetZoom?.();
}

/* ---------- Data logic ---------- */
async function yearExists(id, year){
  const key = `${id}|${year}`;
  if(yearExistsCache.has(key)) return yearExistsCache.get(key);

  const url = `assets/data/${id}/${year}.json`;
  try{
    // HEAD funciona bem no GitHub Pages; se falhar, tenta GET (mais compatível)
    let ok = false;
    try{
      const r = await fetch(url, { method:"HEAD", cache:"no-store" });
      ok = r.ok;
    }catch{
      const r2 = await fetch(url, { method:"GET", cache:"no-store" });
      ok = r2.ok;
    }
    yearExistsCache.set(key, ok);
    return ok;
  }catch{
    yearExistsCache.set(key, false);
    return false;
  }
}

async function computeStationYears(id){
  // otimizado: testa só os 25 anos (2000..2024) do yearsAll
  const found = [];
  // concorrência limitada
  const concurrency = 8;
  let i = 0;

  async function worker(){
    while(i < yearsAll.length){
      const y = yearsAll[i++];
      // eslint-disable-next-line no-await-in-loop
      if(await yearExists(id, y)) found.push(y);
    }
  }

  const workers = Array.from({length: concurrency}, () => worker());
  await Promise.all(workers);

  found.sort((a,b)=>a-b);
  return found;
}

function clearRight(msg){
  $("stationTitle").textContent = "Selecione uma estação";
  $("stationMeta").textContent = "—";
  $("kTmin").textContent = "—";
  $("kTmean").textContent = "—";
  $("kTmax").textContent = "—";
  $("kPtotal").textContent = "—";
  $("kPmean").textContent = "—";
  $("kPmax").textContent = "—";
  $("kPmin").textContent = "—";
  $("kYears").textContent = "—";
  $("summary").textContent = msg || "Selecione uma estação para ver o climograma.";

  ensureCharts();
  chartTemp.data.datasets = [];
  chartTemp.update();
  chartPrec.data.datasets = [];
  chartPrec.update();
}

function pickExtreme(months, key, mode){
  const vals = months
    .map(m => ({m: m.m, v: m[key]}))
    .filter(x => x.v != null && Number.isFinite(Number(x.v)));
  if(!vals.length) return null;
  vals.sort((a,b)=> mode==="max" ? (Number(b.v)-Number(a.v)) : (Number(a.v)-Number(b.v)));
  return vals[0];
}

function calcStats(arr){
  const v = arr.map(Number).filter(Number.isFinite);
  if(!v.length) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const mean = v.reduce((a,b)=>a+b,0)/v.length;
  return {min, max, mean};
}

function safeMonthly(d, key){
  const months = d.months || [];
  return MONTHS.map((_,i)=>{
    const mm = months.find(x => Number(x.m) === (i+1));
    const v = mm ? mm[key] : null;
    const n = (v===null || v===undefined) ? null : Number(v);
    return Number.isFinite(n) ? n : null;
  });
}

function updatePanels(d){
  const annual = d.annual || {};
  const months = d.months || [];

  // KPIs temperatura
  $("kTmin").textContent  = annual.tmin_c != null ? `${fmt(annual.tmin_c,1)} °C` : "—";
  $("kTmean").textContent = annual.tmean_c != null ? `${fmt(annual.tmean_c,1)} °C` : "—";
  $("kTmax").textContent  = annual.tmax_c != null ? `${fmt(annual.tmax_c,1)} °C` : "—";

  // KPIs precip
  $("kPtotal").textContent = annual.prec_total_mm != null ? `${fmt(annual.prec_total_mm,1)} mm` : "—";

  const precArr = months.map(m => m.prec_mm).map(Number).filter(Number.isFinite);
  const pMax = precArr.length ? Math.max(...precArr) : null;
  const pMin = precArr.length ? Math.min(...precArr) : null;
  const pMean = annual.prec_total_mm != null ? (Number(annual.prec_total_mm)/12) : (precArr.length ? precArr.reduce((a,b)=>a+b,0)/precArr.length : null);

  $("kPmean").textContent = pMean != null ? `${fmt(pMean,1)} mm` : "—";
  $("kPmax").textContent  = pMax != null ? `${fmt(pMax,1)} mm` : "—";
  $("kPmin").textContent  = pMin != null ? `${fmt(pMin,1)} mm` : "—";

  // Resumo
  const hottest = pickExtreme(months, "tmean_c", "max");
  const coldest = pickExtreme(months, "tmean_c", "min");
  const wettest = pickExtreme(months, "prec_mm", "max");
  const driest  = pickExtreme(months, "prec_mm", "min");

  const y = d.year ?? selectedYear;
  const sid = d?.meta?.id ?? d?.id ?? stationLabel(selectedStation).id ?? "—";

  $("summary").innerHTML = `
    <div style="font-weight:900;color:#0b2230;margin-bottom:6px">🧭 ${sid} • ${y}</div>
    <div>🌧️ Mês mais chuvoso: ${wettest ? `<b>${MONTHS[wettest.m-1]}</b> (${fmt(wettest.v,1)} mm)` : "—"}</div>
    <div>🏜️ Mês mais seco: ${driest ? `<b>${MONTHS[driest.m-1]}</b> (${fmt(driest.v,1)} mm)` : "—"}</div>
    <div>🔥 Mês mais quente: ${hottest ? `<b>${MONTHS[hottest.m-1]}</b> (${fmt(hottest.v,1)} °C)` : "—"}</div>
    <div>❄️ Mês mais fresco: ${coldest ? `<b>${MONTHS[coldest.m-1]}</b> (${fmt(coldest.v,1)} °C)` : "—"}</div>
    <div style="margin-top:8px;font-size:12px;color:#4e6b75">
      Chuva = soma mensal; Temperatura = média do mês; Tmin/Tmax = extremos do mês.
    </div>
  `;
}

function updateCharts(d){
  ensureCharts();

  // Temperatura
  const tmean = safeMonthly(d, "tmean_c");
  const tmin  = safeMonthly(d, "tmin_c");
  const tmax  = safeMonthly(d, "tmax_c");

  const tStats = calcStats(tmean.filter(v=>v!=null));
  const tMeanLine = tStats ? MONTHS.map(()=>tStats.mean) : MONTHS.map(()=>null);

  const dsT = [
    { type:"line", label:"Temp. média (°C)", data:tmean, pointRadius:2, tension:0.25, borderWidth:2 },
    { type:"line", label:"T máx (°C)", data:tmax, pointRadius:0, tension:0.25, borderWidth:1.5, borderDash:[4,4] },
    { type:"line", label:"T mín (°C)", data:tmin, pointRadius:0, tension:0.25, borderWidth:1.5, borderDash:[4,4] },
    { type:"line", label:"Média anual (T)", data:tMeanLine, pointRadius:0, tension:0, borderWidth:2, borderDash:[6,6] },
  ];

  // variável extra (se existir)
  const extraKey = $("extraVar").value;
  if(extraKey && d.vars && d.vars[extraKey] && Array.isArray(d.vars[extraKey].months) && d.vars[extraKey].months.length === 12){
    const extra = d.vars[extraKey].months.map(v => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    });
    const label = $("extraVar").selectedOptions[0].textContent || "Extra";
    dsT.push({ type:"line", label, data: extra, pointRadius:1, tension:0.2, borderWidth:2 });
  }

  chartTemp.data.labels = MONTHS;
  chartTemp.data.datasets = dsT;

  // eixo y bonito (auto, mas com margem)
  const tAll = [...tmean, ...tmin, ...tmax].filter(v => v!=null && Number.isFinite(v));
  if(tAll.length){
    const lo = Math.min(...tAll), hi = Math.max(...tAll);
    const pad = Math.max(0.8, (hi-lo)*0.12);
    chartTemp.options.scales.y.min = lo - pad;
    chartTemp.options.scales.y.max = hi + pad;
  }else{
    chartTemp.options.scales.y.min = undefined;
    chartTemp.options.scales.y.max = undefined;
  }
  chartTemp.update();

  // Precipitação
  const prec = safeMonthly(d, "prec_mm");
  const pStats = calcStats(prec.filter(v=>v!=null));
  const pMeanLine = pStats ? MONTHS.map(()=>pStats.mean) : MONTHS.map(()=>null);

  const dsP = [
    { type:"bar", label:"Precipitação (mm)", data:prec, borderWidth:0 },
    { type:"line", label:"Média mensal (chuva)", data:pMeanLine, pointRadius:0, tension:0.2, borderWidth:2, borderDash:[6,6] },
  ];

  chartPrec.data.labels = MONTHS;
  chartPrec.data.datasets = dsP;

  const pAll = prec.filter(v => v!=null && Number.isFinite(v));
  if(pAll.length){
    const hi = Math.max(...pAll);
    chartPrec.options.scales.y.min = 0;
    chartPrec.options.scales.y.max = Math.max(10, hi*1.15);
  }else{
    chartPrec.options.scales.y.min = 0;
    chartPrec.options.scales.y.max = 10;
  }
  chartPrec.update();
}

/* ---------- Load station-year JSON ---------- */
async function loadStationYear(id, year){
  const path = `assets/data/${id}/${year}.json`;
  setStatus(`Carregando ${id}/${year}…`);
  try{
    const d = await fetchJson(path);
    setStatus("Pronto ✅");

    updatePanels(d);
    updateCharts(d);

    return true;
  }catch(err){
    console.warn(err);
    setStatus("Sem dados nesse ano", false);
    clearRight(`Não encontrei dados para ${id}/${year}.`);
    return false;
  }
}

/* ---------- Selection ---------- */
async function selectStationById(id, fromList){
  const s = stations.find(x => stationLabel(x).id === String(id));
  if(!s) return;

  selectedStation = s;
  setActiveListItem(id);

  // zoom SEMPRE
  zoomToStation(id);

  // scroll item
  if(fromList){
    const el = document.querySelector(`.item[data-id="${CSS.escape(String(id))}"]`);
    el?.scrollIntoView({ block:"center", behavior:"smooth" });
  }

  const {name, uf} = stationLabel(s);
  const [lat, lon] = stationLatLng(s);

  $("stationTitle").textContent = `${name || "(sem nome)"}${uf?` (${uf})`:""}`;
  $("stationMeta").textContent = `ID ${id} • ${Number.isFinite(lat)&&Number.isFinite(lon) ? `${lat.toFixed(1)}, ${lon.toFixed(1)}` : ""}`;

  // Descobre anos realmente disponíveis
  setStatus("Descobrindo anos da estação…");
  stationYears = await computeStationYears(id);

  if(!stationYears.length){
    $("kYears").textContent = "0";
    clearRight("Sem dados disponíveis para essa estação.");
    setStatus("Sem dados", false);
    return;
  }

  $("kYears").textContent = `${stationYears[0]}–${stationYears[stationYears.length-1]} (${stationYears.length})`;
  fillYearSelect(stationYears);

  // carrega o ano selecionado (último disponível)
  selectedYear = Number($("yearSelect").value);
  await loadStationYear(id, selectedYear);
}

/* ---------- Base load ---------- */
async function loadBase(){
  setStatus("Carregando estações…");
  const st = await fetchJson("assets/stations.json");
  stations = Array.isArray(st) ? st : (st.stations || []);
  if(!stations.length) throw new Error("assets/stations.json vazio/inválido.");

  setStatus("Carregando anos…");
  const ys = await fetchJson("assets/years.json");
  yearsAll = (Array.isArray(ys) ? ys : (ys.years || []))
    .map(Number).filter(Number.isFinite).sort((a,b)=>a-b);

  // Se years.json estiver errado, forçamos 2000..2024
  if(!yearsAll.length){
    yearsAll = Array.from({length: 25}, (_,i)=>2000+i);
  }

  $("stationCount").textContent = stations.length;

  fillYearSelect(yearsAll);
  renderList(stations);
  initMap();
  ensureCharts();

  clearRight("Selecione uma estação para ver o climograma.");
  setStatus("Pronto ✅");
}

/* ---------- Events ---------- */
$("yearSelect").addEventListener("change", async ()=>{
  if(!selectedStation) return;
  const id = stationLabel(selectedStation).id;
  selectedYear = Number($("yearSelect").value);
  await loadStationYear(id, selectedYear);
});

$("extraVar").addEventListener("change", async ()=>{
  if(!selectedStation) return;
  const id = stationLabel(selectedStation).id;
  if(selectedYear == null) return;
  await loadStationYear(id, selectedYear);
});

$("btnResetZoom").addEventListener("click", resetZoom);

$("btnAll").addEventListener("click", ()=>{
  map.setView([-14.2, -52.6], 4, { animate:true });
});

$("btnFocus").addEventListener("click", ()=>{
  if(!selectedStation) return;
  const id = stationLabel(selectedStation).id;
  zoomToStation(id);
});

$("q").addEventListener("input", ()=>{
  const q = norm($("q").value);
  if(!q){
    renderList(stations);
    return;
  }
  const filtered = stations.filter(s=>{
    const {id,name,uf} = stationLabel(s);
    return norm(`${id} ${name} ${uf}`).includes(q);
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

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".tabPane").forEach(p=>p.classList.remove("active"));
    const tab = btn.dataset.tab;
    $(tab === "prec" ? "tab-prec" : "tab-temp").classList.add("active");
  });
});

$("btnPng").addEventListener("click", ()=>{
  if(!selectedStation) return;
  const active = document.querySelector(".tab.active")?.dataset?.tab || "temp";
  const c = active === "prec" ? chartPrec : chartTemp;
  if(!c) return;

  const {id} = stationLabel(selectedStation);
  const a = document.createElement("a");
  a.href = c.toBase64Image("image/png", 1);
  a.download = `climograma_${id}_${selectedYear}_${active}.png`;
  a.click();
});

$("btnCsv").addEventListener("click", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  if(selectedYear == null) return;

  try{
    const d = await fetchJson(`assets/data/${id}/${selectedYear}.json`);
    const rows = (d.months || []).map(m => ({
      ano: d.year ?? selectedYear,
      mes: m.m,
      mes_nome: MONTHS[(m.m||1)-1],
      prec_mm: m.prec_mm ?? "",
      tmean_c: m.tmean_c ?? "",
      tmin_c: m.tmin_c ?? "",
      tmax_c: m.tmax_c ?? "",
      rh: (d.vars?.rh?.months?.[(m.m||1)-1]) ?? "",
      rad: (d.vars?.rad?.months?.[(m.m||1)-1]) ?? "",
      press: (d.vars?.press?.months?.[(m.m||1)-1]) ?? "",
      wind: (d.vars?.wind?.months?.[(m.m||1)-1]) ?? ""
    }));

    if(!rows.length){
      alert("Sem dados mensais para exportar.");
      return;
    }

    const header = Object.keys(rows[0]);
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
    console.error(e);
    alert("Não consegui exportar CSV desse ano/estação.");
  }
});

/* ---------- Start ---------- */
loadBase().catch(err=>{
  console.error(err);
  setStatus("Erro ao iniciar", false);
  alert("Erro ao iniciar o app. Veja o console (F12).");
});
