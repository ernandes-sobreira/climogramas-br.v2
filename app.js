/* Transforma-Ação Climática — Climogramas do Brasil (INMET)
   Leaflet + MarkerCluster + Chart.js + Zoom
   Estrutura esperada:
   - assets/stations.json
   - assets/years.json
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
let markersById = new Map();

let chartTemp = null;
let chartRain = null;

function setStatus(text, ok=true){
  const pill = $("statusPill");
  pill.textContent = text;
  pill.style.background = ok ? "rgba(255,255,255,.14)" : "rgba(220,38,38,.22)";
  pill.style.borderColor = ok ? "rgba(255,255,255,.18)" : "rgba(220,38,38,.35)";
  pill.style.color = "#fff";
}

function fatal(msg){
  console.error(msg);
  $("fatalMsg").textContent = msg;
  $("fatal").classList.remove("hidden");
  setStatus("Erro ao iniciar", false);
}

function normTxt(s){
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

/* ---------- UI: years ---------- */
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
  } else {
    selectedYear = null;
  }
}

/* ---------- Stations list ---------- */
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

/* ---------- Map ---------- */
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

function zoomToStation(id){
  const m = markersById.get(String(id));
  if(!m) return;
  const ll = m.getLatLng();
  map.setView(ll, 9, {animate:true});
  m.openPopup();
}

/* ---------- Charts ---------- */
function ensureCharts(){
  if(!Chart || !window["chartjs-plugin-zoom"]){
    // Mesmo sem plugin, Chart roda. O zoom só não funciona.
  } else {
    // UMD do plugin se registra automaticamente; ainda assim, garantia:
    try{ Chart.register(window["chartjs-plugin-zoom"]); }catch{}
  }

  if(!chartTemp){
    chartTemp = new Chart($("chartTemp"), {
      type: "line",
      data: { labels: MONTHS, datasets: [] },
      options: chartOptions("Temperatura (°C)")
    });

    $("chartTemp").addEventListener("dblclick", ()=> chartTemp?.resetZoom?.());
  }

  if(!chartRain){
    chartRain = new Chart($("chartRain"), {
      type: "bar",
      data: { labels: MONTHS, datasets: [] },
      options: chartOptions("Precipitação (mm)", true)
    });

    $("chartRain").addEventListener("dblclick", ()=> chartRain?.resetZoom?.());
  }
}

function chartOptions(yTitle, isRain=false){
  return {
    responsive:true,
    maintainAspectRatio:false,
    interaction:{ mode:"index", intersect:false },
    plugins:{
      legend:{ position:"top" },
      tooltip:{
        callbacks:{
          label: (ctx)=>{
            const v = ctx.parsed.y;
            if(v==null || Number.isNaN(v)) return `${ctx.dataset.label}: —`;
            return `${ctx.dataset.label}: ${isRain ? fmt(v,1)+" mm" : fmt(v,1)+" °C"}`;
          }
        }
      },
      zoom:{
        zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:"x" },
        pan:{ enabled:true, mode:"x" }
      }
    },
    scales:{
      y:{
        beginAtZero: isRain,
        title:{ display:true, text:yTitle },
        grid:{ color:"rgba(11,34,48,.08)" }
      },
      x:{ grid:{ color:"rgba(11,34,48,.06)" } }
    }
  };
}

function setTabs(active){
  const t1 = $("tabTemp");
  const t2 = $("tabRain");
  const b1 = $("chartBoxTemp");
  const b2 = $("chartBoxRain");

  if(active === "temp"){
    t1.classList.add("active"); t2.classList.remove("active");
    b1.classList.add("show"); b2.classList.remove("show");
  } else {
    t2.classList.add("active"); t1.classList.remove("active");
    b2.classList.add("show"); b1.classList.remove("show");
  }
}

/* ---------- Station selection ---------- */
async function selectStationById(id, fromList){
  const s = stations.find(x => stationLabel(x).id === String(id));
  if(!s) return;

  selectedStation = s;
  setActiveListItem(id);

  zoomToStation(id);

  if(fromList){
    const el = document.querySelector(`.item[data-id="${CSS.escape(String(id))}"]`);
    el?.scrollIntoView({block:"center", behavior:"smooth"});
  }

  await loadStationYearsAndData();
}

async function loadStationYearsAndData(){
  const {id,name,uf} = stationLabel(selectedStation);
  const [lat, lon] = stationLatLng(selectedStation);

  $("stationTitle").textContent = `${name || "(sem nome)"}${uf?` (${uf})`:""}`;
  $("stationMeta").textContent = `ID ${id} • ${Number.isFinite(lat)&&Number.isFinite(lon) ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : ""}`;

  setStatus("Carregando anos…");

  // 1) se vier no stations.json
  const yList = selectedStation.years || selectedStation.anos || selectedStation.available_years;
  if(Array.isArray(yList) && yList.length){
    stationYears = yList.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  } else {
    // 2) senão, descobre por tentativa (GET leve)
    stationYears = await probeYearsForStation(id, yearsAll);
  }

  if(!stationYears.length){
    $("kYears").textContent = "0";
    clearPanels(`Sem dados disponíveis para essa estação (não achei JSONs em assets/data/${id}/).`);
    setStatus("Sem dados", false);
    return;
  }

  $("kYears").textContent = `${stationYears[0]}–${stationYears[stationYears.length-1]} (${stationYears.length})`;

  // Atualiza select para os anos disponíveis dessa estação
  fillYearSelect(stationYears);
  selectedYear = Number($("yearSelect").value);

  setStatus("Carregando dados…");
  await loadStationYear(id, selectedYear);
}

async function probeYearsForStation(id, years){
  // Estratégia: testa rapidamente alguns e depois varre todos se houver indício.
  const first = years[0];
  const last = years[years.length-1];
  const mids = Math.round((first+last)/2);

  const quick = [last, last-1, last-2, mids, first, first+1].filter(y=>years.includes(y));
  const uniq = [...new Set(quick)];

  async function existsYear(y){
    const url = `assets/data/${id}/${y}.json`;
    try{
      const r = await fetch(url, {cache:"no-store"});
      return r.ok;
    }catch{
      return false;
    }
  }

  let any = false;
  for(const y of uniq){
    // eslint-disable-next-line no-await-in-loop
    if(await existsYear(y)){ any = true; break; }
  }
  if(!any){
    // nenhum dos “prováveis” existe → ainda assim varre (pode ser estação antiga)
    const found = [];
    for(const y of years){
      // eslint-disable-next-line no-await-in-loop
      if(await existsYear(y)) found.push(y);
    }
    return found;
  }

  // há dados → varre todos
  const found = [];
  for(const y of years){
    // eslint-disable-next-line no-await-in-loop
    if(await existsYear(y)) found.push(y);
  }
  return found;
}

/* ---------- Load station-year JSON ---------- */
async function loadStationYear(id, year){
  selectedYear = year;
  const path = `assets/data/${id}/${year}.json`;

  try{
    const d = await fetchJson(path);
    setStatus("Pronto ✅");
    renderAll(d);
  }catch(err){
    console.error(err);
    setStatus("Erro ao carregar dados", false);
    clearPanels(`Não encontrei ${path}.`);
  }
}

function clearPanels(msg){
  $("kTmin").textContent = "—";
  $("kTmean").textContent = "—";
  $("kTmax").textContent = "—";
  $("kPtotal").textContent = "—";
  $("kPmean").textContent = "—";
  $("kPmax").textContent = "—";
  $("kPmin").textContent = "—";

  $("summary").textContent = msg;

  if(chartTemp){ chartTemp.data.datasets = []; chartTemp.update(); }
  if(chartRain){ chartRain.data.datasets = []; chartRain.update(); }
}

/* ---------- Render ---------- */
function renderAll(d){
  ensureCharts();

  const months = Array.isArray(d.months) ? d.months : [];
  const annual = d.annual || {};

  // Pega valores mensais (12)
  const m = (key) => MONTHS.map((_,i)=>{
    const row = months.find(x => Number(x.m) === i+1);
    const v = row ? row[key] : null;
    return (v === "" || v === undefined) ? null : (v==null ? null : Number(v));
  });

  const tmean = m("tmean_c");
  const tmin  = m("tmin_c");
  const tmax  = m("tmax_c");
  const prec  = m("prec_mm");

  // Deriva annual se não vier pronto
  const tMeanAnnual = (annual.tmean_c!=null) ? Number(annual.tmean_c) : meanOf(tmean);
  const tMinAnnual  = (annual.tmin_c!=null) ? Number(annual.tmin_c) : minOf(tmin);
  const tMaxAnnual  = (annual.tmax_c!=null) ? Number(annual.tmax_c) : maxOf(tmax);

  const pTotal = (annual.prec_total_mm!=null) ? Number(annual.prec_total_mm) : sumOf(prec);
  const pMean  = (pTotal!=null && Number.isFinite(pTotal)) ? pTotal/12 : meanOf(prec);
  const pMax   = maxOf(prec);
  const pMin   = minOf(prec);

  // KPIs
  $("kTmin").textContent  = (tMinAnnual!=null) ? `${fmt(tMinAnnual,1)} °C` : "—";
  $("kTmean").textContent = (tMeanAnnual!=null) ? `${fmt(tMeanAnnual,1)} °C` : "—";
  $("kTmax").textContent  = (tMaxAnnual!=null) ? `${fmt(tMaxAnnual,1)} °C` : "—";

  $("kPtotal").textContent = (pTotal!=null) ? `${fmt(pTotal,1)} mm` : "—";
  $("kPmean").textContent  = (pMean!=null) ? `${fmt(pMean,1)} mm` : "—";
  $("kPmax").textContent   = (pMax!=null) ? `${fmt(pMax,1)} mm` : "—";
  $("kPmin").textContent   = (pMin!=null) ? `${fmt(pMin,1)} mm` : "—";

  // Resumo climático
  const hot = pickExtreme(months, "tmean_c", "max");
  const cold = pickExtreme(months, "tmean_c", "min");
  const wet = pickExtreme(months, "prec_mm", "max");
  const dry = pickExtreme(months, "prec_mm", "min");

  const id = (d?.meta?.id ?? d?.id ?? stationLabel(selectedStation).id);
  const y = (d?.year ?? selectedYear);

  $("summary").innerHTML = `
    <div><b>🧭 ${id} • ${y}</b></div>
    <div>🌧️ Mês mais chuvoso: ${wet ? `<b>${MONTHS[wet.m-1]}</b> (${fmt(wet.v,1)} mm)` : "—"}</div>
    <div>🏜️ Mês mais seco: ${dry ? `<b>${MONTHS[dry.m-1]}</b> (${fmt(dry.v,1)} mm)` : "—"}</div>
    <div>🔥 Mês mais quente: ${hot ? `<b>${MONTHS[hot.m-1]}</b> (${fmt(hot.v,1)} °C)` : "—"}</div>
    <div>❄️ Mês mais fresco: ${cold ? `<b>${MONTHS[cold.m-1]}</b> (${fmt(cold.v,1)} °C)` : "—"}</div>
    <div style="margin-top:8px;color:#4e6b75;font-size:12px">
      Mensal: chuva = soma do mês; T = média do mês; Tmin/Tmax = extremos do mês (hora a hora).
    </div>
  `;

  // Variável extra (se existir)
  populateExtraVars(d);

  // Atualiza gráficos
  renderTempChart(tmean, tmin, tmax, tMeanAnnual, d);
  renderRainChart(prec, pMean, d);
}

function populateExtraVars(d){
  const sel = $("extraVar");
  const current = sel.value || "";

  // reconstrói as opções mantendo a primeira
  const baseOpt = sel.querySelector('option[value=""]');
  sel.innerHTML = "";
  sel.appendChild(baseOpt);

  const vars = d?.vars || {};
  const keys = Object.keys(vars);

  // tenta mapear nomes “bonitos”
  const pretty = (k)=>{
    const nk = k.toLowerCase();
    if(nk.includes("umid") || nk === "rh") return "Umidade relativa (média %)";
    if(nk.includes("rad")) return "Radiação (média)";
    if(nk.includes("press")) return "Pressão (média)";
    if(nk.includes("wind") || nk.includes("vento")) return "Vento (média)";
    return `Variável: ${k}`;
  };

  for(const k of keys){
    const arr = vars[k]?.months;
    if(Array.isArray(arr) && arr.length === 12){
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = pretty(k);
      sel.appendChild(opt);
    }
  }

  // restaura seleção anterior se ainda existir
  if(current && [...sel.options].some(o=>o.value===current)){
    sel.value = current;
  } else {
    sel.value = "";
  }
}

function renderTempChart(tmean, tmin, tmax, tMeanAnnual, d){
  const extraKey = $("extraVar").value;
  const extra = extraKey ? (d?.vars?.[extraKey]?.months || null) : null;

  const ds = [];

  if(has12(tmean)){
    ds.push({ label:"Temp. média (°C)", data: tmean, tension:.25, pointRadius:2, borderWidth:2 });
  }
  if(has12(tmax)){
    ds.push({ label:"T máx (°C)", data: tmax, tension:.2, pointRadius:0, borderDash:[5,4], borderWidth:2 });
  }
  if(has12(tmin)){
    ds.push({ label:"T mín (°C)", data: tmin, tension:.2, pointRadius:0, borderDash:[5,4], borderWidth:2 });
  }
  if(tMeanAnnual!=null){
    ds.push({ label:"Média anual (T)", data: MONTHS.map(()=>tMeanAnnual), pointRadius:0, borderDash:[7,6], borderWidth:2, tension:0 });
  }

  // extra como segunda linha no gráfico de temperatura (escala própria)
  if(Array.isArray(extra) && extra.length===12){
    const ex = extra.map(v => (v==null || v==="" ? null : Number(v)));
    ds.push({ label: $("extraVar").selectedOptions[0].textContent, data: ex, tension:.2, pointRadius:1, borderWidth:2 });
  }

  chartTemp.data.labels = MONTHS;
  chartTemp.data.datasets = ds;
  chartTemp.update();
}

function renderRainChart(prec, pMean, d){
  const ds = [];

  if(has12(prec)){
    ds.push({ type:"bar", label:"Precipitação (mm)", data: prec.map(v=>v==null?0:v), borderWidth:0 });
  }
  if(pMean!=null){
    ds.push({ type:"line", label:"Chuva média (total/12)", data: MONTHS.map(()=>pMean), pointRadius:0, borderDash:[7,6], borderWidth:2, tension:.15 });
  }

  chartRain.data.labels = MONTHS;
  chartRain.data.datasets = ds;
  chartRain.update();
}

/* ---------- helpers ---------- */
function pickExtreme(months, key, mode){
  const vals = (months||[])
    .map(m => ({m: Number(m.m), v: Number(m[key])}))
    .filter(x => Number.isFinite(x.m) && Number.isFinite(x.v));
  if(!vals.length) return null;
  vals.sort((a,b)=> mode==="max" ? (b.v-a.v) : (a.v-b.v));
  return vals[0];
}

function has12(arr){
  return Array.isArray(arr) && arr.length===12 && arr.some(v=>v!=null && Number.isFinite(v));
}

function meanOf(arr){
  const v = (arr||[]).filter(x=>x!=null && Number.isFinite(x));
  if(!v.length) return null;
  return v.reduce((a,b)=>a+b,0)/v.length;
}
function sumOf(arr){
  const v = (arr||[]).filter(x=>x!=null && Number.isFinite(x));
  if(!v.length) return null;
  return v.reduce((a,b)=>a+b,0);
}
function minOf(arr){
  const v = (arr||[]).filter(x=>x!=null && Number.isFinite(x));
  if(!v.length) return null;
  return Math.min(...v);
}
function maxOf(arr){
  const v = (arr||[]).filter(x=>x!=null && Number.isFinite(x));
  if(!v.length) return null;
  return Math.max(...v);
}

/* ---------- Events ---------- */
$("yearSelect").addEventListener("change", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  await loadStationYear(id, Number($("yearSelect").value));
});

$("extraVar").addEventListener("change", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  await loadStationYear(id, selectedYear);
});

$("btnResetZoom").addEventListener("click", ()=>{
  chartTemp?.resetZoom?.();
  chartRain?.resetZoom?.();
});

$("btnAll").addEventListener("click", ()=>{
  map.setView([-14.2, -52.6], 4, {animate:true});
});

$("q").addEventListener("input", ()=>{
  const q = normTxt($("q").value);
  if(!q){ renderList(stations); return; }
  const filtered = stations.filter(s=>{
    const {id,name,uf} = stationLabel(s);
    return normTxt(`${id} ${name} ${uf}`).includes(q);
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

$("btnPng").addEventListener("click", ()=>{
  // exporta o gráfico da aba ativa
  const isTemp = $("tabTemp").classList.contains("active");
  const ch = isTemp ? chartTemp : chartRain;
  if(!ch) return;

  const a = document.createElement("a");
  a.href = ch.toBase64Image("image/png", 1);
  const st = selectedStation ? stationLabel(selectedStation) : {id:"station"};
  a.download = `climograma_${st.id}_${selectedYear}_${isTemp?"temp":"prec"}.png`;
  a.click();
});

$("btnCsv").addEventListener("click", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);

  try{
    const d = await fetchJson(`assets/data/${id}/${selectedYear}.json`);
    const months = d.months || [];
    const rows = months.map(m=>({
      ano: d.year ?? selectedYear,
      mes: m.m,
      mes_nome: MONTHS[m.m-1],
      prec_mm: m.prec_mm ?? "",
      tmean_c: m.tmean_c ?? "",
      tmin_c: m.tmin_c ?? "",
      tmax_c: m.tmax_c ?? "",
      // extras (se existirem)
      extra_1: "",
      extra_2: ""
    }));

    // Se tiver vars no JSON, tenta adicionar 2 extras úteis
    const vars = d.vars || {};
    const keys = Object.keys(vars).filter(k=>Array.isArray(vars[k]?.months) && vars[k].months.length===12);

    if(keys[0]){
      rows.forEach((r,i)=> r.extra_1 = vars[keys[0]].months[i] ?? "");
      rows.forEach(r=> r.extra_1_nome = keys[0]);
    }
    if(keys[1]){
      rows.forEach((r,i)=> r.extra_2 = vars[keys[1]].months[i] ?? "");
      rows.forEach(r=> r.extra_2_nome = keys[1]);
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
    console.error(e);
    alert("Não consegui exportar CSV desse ano/estação.");
  }
});

$("tabTemp").addEventListener("click", ()=> setTabs("temp"));
$("tabRain").addEventListener("click", ()=> setTabs("rain"));

/* ---------- Start ---------- */
async function loadBase(){
  try{
    if(typeof L === "undefined") throw new Error("Leaflet não carregou (L undefined).");
    if(typeof Chart === "undefined") throw new Error("Chart.js não carregou (Chart undefined).");

    setStatus("Carregando estações…");
    const st = await fetchJson("assets/stations.json");
    stations = Array.isArray(st) ? st : (st.stations || []);
    if(!stations.length) throw new Error("stations.json vazio/inválido.");

    setStatus("Carregando anos…");
    const ys = await fetchJson("assets/years.json");
    yearsAll = (Array.isArray(ys) ? ys : (ys.years || [])).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!yearsAll.length){
      // fallback seguro: 2000..2024
      yearsAll = Array.from({length:25},(_,i)=>2000+i);
    }

    $("stationCount").textContent = stations.length;
    fillYearSelect(yearsAll);

    renderList(stations);
    initMap();

    setTabs("temp");
    setStatus("Pronto ✅");
  }catch(err){
    console.error(err);
    fatal(err.message || String(err));
  }
}

loadBase();
