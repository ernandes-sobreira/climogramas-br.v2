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
let chart = null;

function setStatus(text, ok=true){
  const pill = $("statusPill");
  pill.textContent = text;
  pill.style.background = ok ? "rgba(11,111,117,.12)" : "rgba(220,38,38,.12)";
  pill.style.borderColor = ok ? "rgba(11,111,117,.18)" : "rgba(220,38,38,.18)";
  pill.style.color = ok ? "#0b6f75" : "#b91c1c";
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

function fmtInt(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  return String(Math.round(Number(n)));
}

async function fetchJson(path){
  const r = await fetch(path, {cache:"no-store"});
  if(!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
  return await r.json();
}

/* -------- Load base files -------- */
async function loadBase(){
  setStatus("Carregando estações…");
  const st = await fetchJson("assets/stations.json");

  // aceita array ou {stations:[]}
  stations = Array.isArray(st) ? st : (st.stations || []);
  if(!stations.length) throw new Error("stations.json vazio/inválido.");

  setStatus("Carregando anos…");
  const ys = await fetchJson("assets/years.json");
  yearsAll = Array.isArray(ys) ? ys : (ys.years || []);
  yearsAll = yearsAll.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);

  // UI anos (depois trocamos para anos da estação quando selecionar)
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
  // default: último ano
  if(yrs.length){
    sel.value = String(yrs[yrs.length-1]);
    selectedYear = Number(sel.value);
  }
}

/* -------- Stations list -------- */
function stationLabel(s){
  const id = s.id ?? s.ID ?? s.codigo ?? s.codigo_wmo ?? s.wmo ?? s.station_id;
  const name = s.name ?? s.NOME ?? s.estacao ?? s.station ?? "";
  const uf = s.uf ?? s.UF ?? "";
  return {id, name, uf};
}

function stationLatLng(s){
  const lat = Number(s.lat ?? s.latitude ?? s.LATITUDE);
  const lon = Number(s.lon ?? s.lng ?? s.longitude ?? s.LONGITUDE);
  return [lat, lon];
}

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

/* -------- Map -------- */
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

/* -------- Station selection + load years -------- */
async function selectStationById(id, fromList){
  const s = stations.find(x => String(stationLabel(x).id) === String(id));
  if(!s) return;

  selectedStation = s;
  setActiveListItem(id);

  // zoom no mapa SEMPRE quando selecionar
  zoomToStation(id);

  // scrola a lista para o item (quando veio de busca/lista)
  if(fromList){
    const el = document.querySelector(`.item[data-id="${CSS.escape(String(id))}"]`);
    el?.scrollIntoView({block:"center", behavior:"smooth"});
  }

  // Carrega anos disponíveis da estação (varrendo assets/data/<id>/???.json via tentativa inteligente)
  // Estratégia: usa yearsAll e testa existência com HEAD (leve, mas são muitos). Então:
  // - para performance: testa apenas anosAll e para no primeiro bloco que achar, e depois amplia.
  // - se você tiver years_by_station pronto no stations.json, ele usa direto.
  await loadStationYearsAndData();
}

async function loadStationYearsAndData(){
  const {id,name,uf} = stationLabel(selectedStation);
  $("stationTitle").textContent = `${name || "(sem nome)"}${uf?` (${uf})`:""}`;
  const [lat, lon] = stationLatLng(selectedStation);
  $("stationMeta").textContent = `ID ${id} • ${Number.isFinite(lat)&&Number.isFinite(lon) ? `${lat.toFixed(1)}, ${lon.toFixed(1)}` : ""}`;

  setStatus("Carregando dados…");

  // 1) Se stations.json já tiver uma lista de anos:
  const yList = selectedStation.years || selectedStation.anos || selectedStation.available_years;
  if(Array.isArray(yList) && yList.length){
    stationYears = yList.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  } else {
    // 2) Caso não tenha: testa anos (mas de forma controlada)
    stationYears = await probeYearsForStation(id, yearsAll);
  }

  if(!stationYears.length){
    $("kYears").textContent = "0";
    setStatus("Sem anos nessa estação", false);
    clearRightPanel("Sem dados disponíveis para essa estação.");
    return;
  }

  $("kYears").textContent = `${stationYears[0]}–${stationYears[stationYears.length-1]} (${stationYears.length})`;

  // atualiza select de anos para os anos da estação
  fillYearSelect(stationYears);
  selectedYear = Number($("yearSelect").value);

  // carrega ano selecionado
  await loadStationYear(id, selectedYear);
}

async function probeYearsForStation(id, years){
  // Testa poucos anos primeiro (rápido) e depois amplia.
  const exists = [];
  const quick = [];
  const last = years[years.length-1];
  const first = years[0];

  // amostras: fim, meio, início, e últimos 5
  quick.push(last, last-1, last-2, last-3, last-4);
  quick.push(Math.round((first+last)/2));
  quick.push(first, first+1);

  const uniq = [...new Set(quick)].filter(y=>years.includes(y));

  // se nenhum desses existir, aí sim tenta o resto (mas isso é raro)
  async function hasYear(y){
    const url = `assets/data/${id}/${y}.json`;
    try{
      const r = await fetch(url, {method:"HEAD", cache:"no-store"});
      return r.ok;
    }catch{ return false; }
  }

  let any = false;
  for(const y of uniq){
    if(await hasYear(y)){ any = true; break; }
  }
  if(!any){
    // varre tudo (pode demorar um pouco na primeira seleção)
    for(const y of years){
      if(await hasYear(y)) exists.push(y);
    }
    return exists;
  }

  // existe algum — então varre tudo, mas com chunk e “não trava”
  for(const y of years){
    // eslint-disable-next-line no-await-in-loop
    if(await hasYear(y)) exists.push(y);
  }
  return exists;
}

/* -------- Load & render station-year JSON -------- */
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

function clearRightPanel(msg){
  $("kTmin").textContent = "—";
  $("kTmean").textContent = "—";
  $("kTmax").textContent = "—";
  $("kPtotal").textContent = "—";
  $("kPmean").textContent = "—";
  $("kPmax").textContent = "—";
  $("kPmin").textContent = "—";

  $("summary").textContent = msg;

  if(chart){
    chart.destroy();
    chart = null;
  }
}

function renderRightPanel(d){
  const annual = d.annual || {};
  const months = d.months || [];

  // KPIs temp
  $("kTmin").textContent  = (annual.tmin_c!=null) ? `${fmt(annual.tmin_c,1)} °C` : "—";
  $("kTmean").textContent = (annual.tmean_c!=null) ? `${fmt(annual.tmean_c,1)} °C` : "—";
  $("kTmax").textContent  = (annual.tmax_c!=null) ? `${fmt(annual.tmax_c,1)} °C` : "—";

  // KPIs precip
  $("kPtotal").textContent = (annual.prec_total_mm!=null) ? `${fmt(annual.prec_total_mm,1)} mm` : "—";

  const pVals = months.map(m => m.prec_mm ?? null).filter(v => v!=null);
  const pMean = (annual.prec_total_mm!=null) ? (annual.prec_total_mm/12) : null;
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

  // gráfico
  renderChart(d);
}

function pickExtreme(months, key, mode){
  const vals = months
    .map(m => ({m: m.m, v: m[key]}))
    .filter(x => x.v != null && Number.isFinite(x.v));
  if(!vals.length) return null;
  vals.sort((a,b)=> mode==="max" ? (b.v-a.v) : (a.v-b.v));
  return vals[0];
}

function renderChart(d){
  const months = d.months || [];

  const prec = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.prec_mm ?? null);
  const tmean = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmean_c ?? null);
  const tmin  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmin_c ?? null);
  const tmax  = MONTHS.map((_,i)=> months.find(m=>m.m===i+1)?.tmax_c ?? null);

  const annual = d.annual || {};
  const tMeanLine = (annual.tmean_c!=null) ? MONTHS.map(()=>annual.tmean_c) : MONTHS.map(()=>null);
  const pMeanLine = (annual.prec_total_mm!=null) ? MONTHS.map(()=>annual.prec_total_mm/12) : MONTHS.map(()=>null);

  // variável extra (opcional)
  const extraKey = $("extraVar").value;
  let extraArr = null;
  let extraLabel = "";
  let extraAxis = "y2";
  if(extraKey){
    const v = d.vars?.[extraKey]?.months;
    if(Array.isArray(v) && v.length===12){
      extraArr = v.map(x => (x==null?null:Number(x)));
      extraLabel = $("extraVar").selectedOptions[0].textContent;
    }
  }

  const ctx = $("chart").getContext("2d");
  if(chart){ chart.destroy(); }

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTHS,
      datasets: [
        {
          type: "bar",
          label: "Precipitação (mm)",
          data: prec,
          yAxisID: "y",
          borderWidth: 0,
          order: 2
        },
        {
          type: "line",
          label: "Chuva média (total/12)",
          data: pMeanLine,
          yAxisID: "y",
          borderWidth: 2,
          pointRadius: 0,
          tension: .2,
          order: 1
        },
        {
          type: "line",
          label: "Temp. média (°C)",
          data: tmean,
          yAxisID: "y1",
          borderWidth: 2,
          pointRadius: 2,
          tension: .25,
          order: 3
        },
        {
          type: "line",
          label: "Média anual (T)",
          data: tMeanLine,
          yAxisID: "y1",
          borderWidth: 1.8,
          pointRadius: 0,
          borderDash: [6,6],
          tension: 0,
          order: 0
        },
        {
          type: "line",
          label: "Faixa Tmin–Tmax",
          data: tmax,
          yAxisID: "y1",
          pointRadius: 0,
          borderWidth: 1.2,
          fill: { target: "-1" },  // preenche até o dataset anterior (tmin)
          order: 4
        },
        {
          type: "line",
          label: "Tmin (°C)",
          data: tmin,
          yAxisID: "y1",
          pointRadius: 0,
          borderWidth: 1.2,
          order: 4
        },
      ].concat(extraArr ? [{
          type: "line",
          label: extraLabel,
          data: extraArr,
          yAxisID: extraAxis,
          borderWidth: 2,
          pointRadius: 1,
          tension: .2,
          order: 5
      }] : [])
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              if(v==null || Number.isNaN(v)) return `${ctx.dataset.label}: —`;
              const isTemp = ctx.dataset.yAxisID !== "y";
              return `${ctx.dataset.label}: ${isTemp ? fmt(v,1)+" °C" : fmt(v,1)+" mm"}`;
            }
          }
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: { enabled: true, mode: "x" }
        }
      },
      scales: {
        y: {
          position: "left",
          title: { display: true, text: "Precipitação (mm)" },
          beginAtZero: true,
          grid: { color: "rgba(11,34,48,.08)" }
        },
        y1: {
          position: "right",
          title: { display: true, text: "Temperatura (°C)" },
          grid: { drawOnChartArea: false }
        },
        y2: {
          position: "right",
          display: !!extraArr,
          offset: true,
          title: { display: !!extraArr, text: extraLabel },
          grid: { drawOnChartArea: false }
        },
        x: { grid: { color: "rgba(11,34,48,.06)" } }
      }
    }
  });

  // duplo clique reseta zoom
  $("chart").ondblclick = () => chart?.resetZoom?.();
}

/* -------- Events -------- */
$("yearSelect").addEventListener("change", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  await loadStationYear(id, Number($("yearSelect").value));
});

$("extraVar").addEventListener("change", ()=>{
  // re-render gráfico com a variável extra
  if(!selectedStation || !chart) return;
  const {id} = stationLabel(selectedStation);
  loadStationYear(id, selectedYear);
});

$("btnResetZoom").addEventListener("click", ()=>{
  chart?.resetZoom?.();
});

$("btnAll").addEventListener("click", ()=>{
  // zoom para Brasil
  map.setView([-14.2, -52.6], 4, {animate:true});
  cluster.refreshClusters?.();
});

$("q").addEventListener("input", ()=>{
  const q = norm($("q").value);
  if(!q){
    renderList(stations);
    return;
  }
  const filtered = stations.filter(s=>{
    const {id,name,uf} = stationLabel(s);
    const t = norm(`${id} ${name} ${uf}`);
    return t.includes(q);
  });
  renderList(filtered);
});

$("clearSearch").addEventListener("click", ()=>{
  $("q").value = "";
  renderList(stations);
});

$("toggleStations").addEventListener("click", ()=>{
  // em mobile: alterna lista
  const panel = $("leftPanel");
  panel.classList.toggle("open");
  $("toggleStations").textContent = panel.classList.contains("open") ? "Fechar" : "Abrir";
});

$("btnPng").addEventListener("click", ()=>{
  if(!chart) return;
  const a = document.createElement("a");
  a.href = chart.toBase64Image("image/png", 1);
  const st = selectedStation ? stationLabel(selectedStation) : {id:"station"};
  a.download = `climograma_${st.id}_${selectedYear}.png`;
  a.click();
});

$("btnCsv").addEventListener("click", async ()=>{
  if(!selectedStation) return;
  const {id} = stationLabel(selectedStation);
  try{
    const d = await fetchJson(`assets/data/${id}/${selectedYear}.json`);
    const rows = (d.months||[]).map(m=>({
      ano: d.year,
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

/* -------- Start -------- */
loadBase().catch(err=>{
  console.error(err);
  setStatus("Erro ao iniciar", false);
  alert("Erro ao iniciar o app. Veja o console (F12).");
});
