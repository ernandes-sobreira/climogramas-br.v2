/* climogramas-br v2 — app.js (robusto, sem erros)
   Estrutura esperada:
   - assets/stations.json
   - assets/data/<CODE>/<YEAR>.json  (cada arquivo: {station, year, months:[{m,...}], annual:{...}})
*/

(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const BASE = new URL(".", location.href).toString(); // funciona em subpasta do GitHub Pages
  const ASSETS = new URL("assets/", BASE).toString();

  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const monthName = (m) => monthNames[(m-1)] || String(m);

  const fmt = (v, d=2) => Number.isFinite(v) ? v.toFixed(d) : "—";

  const meanFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((a,b)=>a+b,0)/xs.length;
  };
  const sumFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((a,b)=>a+b,0);
  };
  const minFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return Math.min(...xs);
  };
  const maxFinite = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return Math.max(...xs);
  };

  const safeNum = (v) => (v===null || v===undefined) ? NaN : (typeof v==="number" ? v : Number(v));
  const isObj = (x) => x && typeof x === "object";

  function setMsg(text, kind="ok"){
    const box = $("msgBox");
    box.textContent = text;
    box.style.borderColor = (kind==="err") ? "rgba(251,113,133,.35)" : "rgba(255,255,255,.08)";
    box.style.background = (kind==="err") ? "rgba(251,113,133,.10)" : "rgba(7,11,22,.35)";
    box.style.color = (kind==="err") ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.70)";
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function downloadPngFromChart(chart, filename){
    const a = document.createElement("a");
    a.href = chart.toBase64Image("image/png", 1);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- UI refs ----------
  const ufSelect = $("ufSelect");
  const searchStation = $("searchStation");
  const stationSelect = $("stationSelect");
  const stationMeta = $("stationMeta");
  const yearStart = $("yearStart");
  const yearEnd = $("yearEnd");

  const btnRun = $("btnRun");
  const btnPng = $("btnPng");
  const btnCsv = $("btnCsv");
  const btnReset = $("btnReset");

  const btnClim = $("btnClim");
  const btnAnnual = $("btnAnnual");
  const btnHeatmap = $("btnHeatmap");
  const btnRel = $("btnRel");

  const var1 = $("var1");
  const var2 = $("var2");

  const showTrend = $("showTrend");
  const showR2 = $("showR2");
  const optMinMax = $("optMinMax");
  const optMean = $("optMean");
  const optPrecBars = $("optPrecBars");

  const chartTitle = $("chartTitle");
  const chartMeta = $("chartMeta");
  const kpisBox = $("kpis");

  const tblHead = $("tblHead");
  const tblBody = $("tblBody");
  const tableMeta = $("tableMeta");

  const pillStation = $("pillStation");
  const pillYears = $("pillYears");
  const pillData = $("pillData");

  // ---------- state ----------
  let stations = [];
  let filteredStations = [];
  let selectedStation = null;

  let mode = "clim";
  let chart = null;
  let lastRows = [];
  let lastCsvName = "tabela.csv";
  let lastPngName = "grafico.png";

  // cache JSON packs by station+year
  const packCache = new Map(); // key `${code}_${year}` -> pack
  // cache station-year existence
  const existsCache = new Map(); // key -> boolean

  // Map
  let map = null;
  let markersLayer = null;

  // ---------- variable label map ----------
  const VAR_LABELS = {
    tmean: "Temperatura média (°C)",
    tmin: "Temperatura mínima (°C)",
    tmax: "Temperatura máxima (°C)",
    p: "Precipitação (mm)",
    prec: "Precipitação (mm)",
    prcp: "Precipitação (mm)",
    ppt: "Precipitação (mm)",
    press: "Pressão (hPa)",
    rad: "Radiação",
    rh: "Umidade relativa (%)",
    wind: "Vento",
  };

  function labelOfVar(k){
    return VAR_LABELS[k] || k;
  }

  function setMode(newMode){
    mode = newMode;
    for (const b of document.querySelectorAll(".modeBtn")) b.classList.remove("active");
    const btn = document.querySelector(`.modeBtn[data-mode="${newMode}"]`);
    if (btn) btn.classList.add("active");

    // var2 e trend/r2 só no modo rel
    const relOn = (mode === "rel");
    var2.disabled = !relOn;
    showTrend.disabled = !relOn;
    showR2.disabled = !relOn;

    // heatmap: var2 irrelevant
    if (mode === "heatmap") var2.disabled = true;
  }

  function setKpis(items){
    kpisBox.innerHTML = "";
    for (const it of items){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="k">${it.k}</div><div class="v">${it.v}</div>`;
      kpisBox.appendChild(div);
    }
  }

  function setTable(rows){
    lastRows = rows || [];
    tblHead.innerHTML = "";
    tblBody.innerHTML = "";

    if (!rows || !rows.length){
      tableMeta.textContent = "Sem linhas para exibir.";
      return;
    }

    const cols = Object.keys(rows[0]);
    tableMeta.textContent = `Mostrando ${rows.length} de ${rows.length} linhas.`;

    const trh = document.createElement("tr");
    for (const c of cols){
      const th = document.createElement("th");
      th.textContent = c;
      trh.appendChild(th);
    }
    tblHead.appendChild(trh);

    for (const r of rows){
      const tr = document.createElement("tr");
      for (const c of cols){
        const td = document.createElement("td");
        const v = r[c];
        td.textContent = (typeof v==="number" && Number.isFinite(v)) ? v : (v ?? "");
        tr.appendChild(td);
      }
      tblBody.appendChild(tr);
    }
  }

  function rowsToCsv(rows){
    if (!rows || !rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (s) => {
      const t = String(s ?? "");
      if (/[",\n;]/.test(t)) return `"${t.replaceAll('"','""')}"`;
      return t;
    };
    const lines = [];
    lines.push(cols.join(";"));
    for (const r of rows){
      lines.push(cols.map(c=>esc(r[c])).join(";"));
    }
    return lines.join("\n");
  }

  // ---------- data loading ----------
  async function fetchJson(url){
    const res = await fetch(url, {cache:"no-store"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function dataUrl(code, year){
    // assets/data/A001/2000.json
    return new URL(`data/${code}/${year}.json`, ASSETS).toString();
  }

  async function yearExists(code, year){
    const key = `${code}_${year}`;
    if (existsCache.has(key)) return existsCache.get(key);

    try{
      const res = await fetch(dataUrl(code, year), {method:"HEAD", cache:"no-store"});
      const ok = res.ok;
      existsCache.set(key, ok);
      return ok;
    } catch(e){
      existsCache.set(key, false);
      return false;
    }
  }

  async function loadPack(code, year){
    const key = `${code}_${year}`;
    if (packCache.has(key)) return packCache.get(key);

    const url = dataUrl(code, year);
    const obj = await fetchJson(url);

    // normaliza months
    if (!Array.isArray(obj.months)) obj.months = [];
    obj.year = year;
    obj.station = obj.station || code;

    packCache.set(key, obj);
    return obj;
  }

  async function loadPacksForRange(code, y0, y1){
    const packs = [];
    for (let y=y0; y<=y1; y++){
      try{
        // tenta carregar; se não existir, ignora
        const ok = await yearExists(code, y);
        if (!ok) continue;
        const pack = await loadPack(code, y);
        packs.push(pack);
      }catch(e){
        // ignora ano problemático
      }
    }
    return packs;
  }

  function collectVarsFromPacks(packs){
    const keys = new Set();
    for (const p of packs){
      for (const m of (p.months||[])){
        if (!isObj(m)) continue;
        for (const k of Object.keys(m)){
          if (k === "m") continue;
          keys.add(k);
        }
      }
    }
    // prioriza tmean e p
    const arr = Array.from(keys);
    arr.sort((a,b)=>{
      const pr = (x) => (x==="tmean"?0:(x==="p"?1:10));
      const d = pr(a)-pr(b);
      if (d!==0) return d;
      return a.localeCompare(b);
    });
    return arr;
  }

  // ---------- chart ----------
  function destroyChart(){
    if (chart){ chart.destroy(); chart = null; }
  }

  function ensureChart(){
    const canvas = $("mainChart");
    if (!canvas) throw new Error("Canvas mainChart não encontrado.");
    return canvas.getContext("2d");
  }

  function renderChart(config){
    destroyChart();
    const ctx = ensureChart();
    chart = new Chart(ctx, config);
  }

  // ---------- stats for relation ----------
  function linearRegression(xs, ys){
    // returns {a,b,r2, yhat(x)}
    const n = xs.length;
    const xbar = xs.reduce((a,b)=>a+b,0)/n;
    const ybar = ys.reduce((a,b)=>a+b,0)/n;
    let ssxx=0, ssxy=0, ssyy=0;
    for (let i=0;i<n;i++){
      const dx = xs[i]-xbar;
      const dy = ys[i]-ybar;
      ssxx += dx*dx;
      ssxy += dx*dy;
      ssyy += dy*dy;
    }
    const b = ssxy/ssxx;
    const a = ybar - b*xbar;

    // r2
    let ssres=0;
    for (let i=0;i<n;i++){
      const yhat = a + b*xs[i];
      ssres += (ys[i]-yhat)**2;
    }
    const r2 = 1 - (ssres/ssyy);
    return {a,b,r2};
  }

  // ---------- UI population ----------
  function fillSelect(sel, items, getLabel=(x)=>x, getValue=(x)=>x, keepValue=true){
    const old = sel.value;
    sel.innerHTML = "";
    for (const it of items){
      const opt = document.createElement("option");
      opt.value = getValue(it);
      opt.textContent = getLabel(it);
      sel.appendChild(opt);
    }
    if (keepValue && old && [...sel.options].some(o=>o.value===old)) sel.value = old;
  }

  function updatePills(info){
    pillStation.textContent = `Estação: ${info.station ?? "—"}`;
    pillYears.textContent = `Anos: ${info.years ?? "—"}`;
    pillData.textContent = `Dados: ${info.data ?? "—"}`;
  }

  function stationLabel(s){
    if (!s) return "—";
    return `${s.code} · ${s.name} (${s.uf})`;
  }

  function applyFilters(){
    const uf = ufSelect.value;
    const q = (searchStation.value || "").trim().toLowerCase();

    filteredStations = stations.filter(s=>{
      const okUf = (uf==="Todas") || (s.uf===uf);
      const hay = `${s.code} ${s.name} ${s.city||""}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      return okUf && okQ;
    });

    fillSelect(
      stationSelect,
      filteredStations,
      s => `${s.code} · ${s.name} (${s.uf})`,
      s => s.code,
      false
    );

    if (!filteredStations.length){
      selectedStation = null;
      stationMeta.textContent = "—";
      updatePills({station:"—", years:"—", data:"—"});
      return;
    }

    const code = stationSelect.value || filteredStations[0].code;
    stationSelect.value = code;
    selectStation(code, false);
  }

  function selectStation(code, zoomMap=true){
    selectedStation = stations.find(s=>s.code===code) || null;
    stationMeta.textContent = selectedStation
      ? `${selectedStation.city || selectedStation.name} · ${selectedStation.uf} · lat ${selectedStation.lat} lon ${selectedStation.lon}`
      : "—";
    updatePills({station: selectedStation ? selectedStation.code : "—", years:"—", data:"—"});

    // anos
    const years = [];
    for (let y=2000; y<=2024; y++) years.push(String(y));
    fillSelect(yearStart, years, y=>y, y=>y, true);
    fillSelect(yearEnd, years, y=>y, y=>y, true);

    if (zoomMap && selectedStation && map){
      map.setView([selectedStation.lat, selectedStation.lon], 7, {animate:true});
    }
  }

  // ---------- map ----------
  function initMap(){
    map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([-14.2, -55.0], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
  }

  function renderMarkers(){
    if (!map || !markersLayer) return;
    markersLayer.clearLayers();

    for (const s of filteredStations){
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const mk = L.circleMarker([s.lat, s.lon], {
        radius: 5,
        weight: 1,
        opacity: .9,
        fillOpacity: .65
      });
      mk.bindTooltip(`${s.code} · ${s.name} (${s.uf})`, {sticky:true});
      mk.on("click", ()=>{
        stationSelect.value = s.code;
        selectStation(s.code, false);
        setMsg(`Selecionado: ${s.code}`, "ok");
      });
      mk.addTo(markersLayer);
    }
  }

  // ---------- core render ----------
  async function run(){
    try{
      if (!selectedStation){
        setMsg("Selecione uma estação.", "err");
        return;
      }

      const code = selectedStation.code;
      let y0 = Number(yearStart.value);
      let y1 = Number(yearEnd.value);
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) { y0=2000; y1=2024; }
      if (y0>y1) [y0,y1] = [y1,y0];

      setMsg("Carregando dados...", "ok");

      const packs = await loadPacksForRange(code, y0, y1);
      if (!packs.length){
        setTable([]);
        destroyChart();
        setKpis([]);
        updatePills({station: code, years:`${y0}–${y1}`, data:`0 ano(s)`});
        setMsg("Sem dados no intervalo selecionado (anos ausentes ou JSON vazio).", "err");
        return;
      }

      // anos realmente carregados
      const yearsOk = packs.map(p=>p.year).sort((a,b)=>a-b);
      updatePills({
        station: code,
        years: `${yearsOk[0]}–${yearsOk[yearsOk.length-1]}`,
        data: `${yearsOk.length} ano(s)`
      });

      // variáveis disponíveis
      const vars = collectVarsFromPacks(packs);
      if (!vars.length){
        setMsg("Dados sem variáveis reconhecíveis.", "err");
        return;
      }

      // popula selects de variáveis (preserva escolha)
      fillSelect(var1, vars, k=>labelOfVar(k), k=>k, true);
      fillSelect(var2, vars, k=>labelOfVar(k), k=>k, true);

      // default var1/var2 se vazio
      if (!var1.value) var1.value = vars.includes("tmean") ? "tmean" : vars[0];
      if (!var2.value) var2.value = vars.includes("p") ? "p" : vars[0];

      const V1 = var1.value;
      const V2 = var2.value;

      // ---------- MODE: climogram ----------
      if (mode === "clim"){
        // para cada mês, junta valores de todos os anos
        const perMonth = Array.from({length:12}, (_,i)=>({m:i+1, vals:[], pvals:[]}));

        // detect precip key
        const PREC_KEYS = ["p","prec","prcp","ppt","precip","precipitacao"];
        let PKEY = null;
        outer:
        for (const p of packs){
          for (const r of (p.months||[])){
            for (const k of PREC_KEYS){
              if (k in r && Number.isFinite(safeNum(r[k]))) { PKEY=k; break outer; }
            }
          }
        }

        for (const p of packs){
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;
            const v = safeNum(r[V1]);
            if (Number.isFinite(v)) perMonth[m-1].vals.push(v);
            if (PKEY){
              const pv = safeNum(r[PKEY]);
              if (Number.isFinite(pv)) perMonth[m-1].pvals.push(pv);
            }
          }
        }

        const rows = perMonth.map(o=>{
          const mean = meanFinite(o.vals);
          const mn = minFinite(o.vals);
          const mx = maxFinite(o.vals);
          return { mes: o.m, mean, min: mn, max: mx, n: o.vals.filter(Number.isFinite).length };
        });

        setTable(rows);

        // datasets V1
        const labels = perMonth.map(o=>monthName(o.m));
        const ds = [];

        // barras precip (mensal média)
        const showBars = !!(optPrecBars.checked && PKEY);
        if (showBars){
          const pmean = perMonth.map(o=>meanFinite(o.pvals));
          ds.push({
            type:"bar",
            label: "Precipitação média (mm)",
            data: pmean.map(v=>Number.isFinite(v)?v:null),
            yAxisID:"yP",
            order: 3
          });
        }

        if (optMinMax.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • mín`, data: rows.map(r=>Number.isFinite(r.min)?r.min:null), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
          ds.push({ type:"line", label:`${labelOfVar(V1)} • máx`, data: rows.map(r=>Number.isFinite(r.max)?r.max:null), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
        }
        if (optMean.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • média`, data: rows.map(r=>Number.isFinite(r.mean)?r.mean:null), yAxisID:"y", borderWidth:3, pointRadius:3, tension:.25 });
        }

        renderChart({
          data:{ labels, datasets: ds },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            interaction:{mode:"index", intersect:false},
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:false}, grid:{color:"rgba(255,255,255,.06)"} },
              y:{ position:"left", title:{display:true, text: labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
              yP:{ position:"right", display:showBars, title:{display:showBars, text:"Precipitação (mm)"}, grid:{drawOnChartArea:false} }
            }
          }
        });

        chartTitle.textContent = `Climograma (média mensal) — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Anos usados: ${yearsOk[0]}–${yearsOk[yearsOk.length-1]} (ignorando meses nulos).`;

        const means = rows.map(r=>r.mean).filter(Number.isFinite);
        const mins = rows.map(r=>r.min).filter(Number.isFinite);
        const maxs = rows.map(r=>r.max).filter(Number.isFinite);

        setKpis([
          {k:"Anos úteis", v:String(yearsOk.length)},
          {k:"Média (12 meses)", v:fmt(meanFinite(means),2)},
          {k:"Min (mês)", v:fmt(minFinite(mins),2)},
          {k:"Max (mês)", v:fmt(maxFinite(maxs),2)},
        ]);

        lastCsvName = `climograma_${code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.csv`;
        lastPngName = `climograma_${code}_${V1}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // ---------- MODE: annual ----------
      if (mode === "annual"){
        const rows = [];

        for (const p of packs){
          const vals = (p.months||[]).map(r=>safeNum(r[V1])).filter(Number.isFinite);
          if (!vals.length) continue;

          rows.push({
            ano: p.year,
            mean: meanFinite(vals),
            min: minFinite(vals),
            max: maxFinite(vals),
            n: vals.length
          });
        }

        if (!rows.length){
          setTable([]);
          destroyChart();
          setKpis([]);
          setMsg("Sem dados suficientes para série anual (variável ausente).", "err");
          return;
        }

        setTable(rows);

        // detect precip key
        const PREC_KEYS = ["p","prec","prcp","ppt","precip","precipitacao"];
        let PKEY = null;
        outer:
        for (const p of packs){
          for (const r of (p.months||[])){
            for (const k of PREC_KEYS){
              if (k in r && Number.isFinite(safeNum(r[k]))) { PKEY=k; break outer; }
            }
          }
        }

        let annualPrec = null;
        if (PKEY){
          annualPrec = rows.map(r=>{
            const pack = packs.find(pp=>pp.year===r.ano);
            if (!pack) return null;
            const pv = (pack.months||[]).map(mm=>safeNum(mm[PKEY])).filter(Number.isFinite);
            return pv.length ? sumFinite(pv) : null;
          });
        }

        const labels = rows.map(r=>r.ano);
        const ds = [];

        if (optMinMax.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • mín (ano)`, data: rows.map(r=>r.min), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
          ds.push({ type:"line", label:`${labelOfVar(V1)} • máx (ano)`, data: rows.map(r=>r.max), yAxisID:"y", borderWidth:2, pointRadius:2, tension:.25 });
        }
        if (optMean.checked){
          ds.push({ type:"line", label:`${labelOfVar(V1)} • média (ano)`, data: rows.map(r=>r.mean), yAxisID:"y", borderWidth:3, pointRadius:3, tension:.25 });
        }

        const showBars = !!(optPrecBars.checked && annualPrec && annualPrec.some(Number.isFinite));
        if (showBars){
          ds.push({ type:"bar", label:"Precipitação anual (mm)", data: annualPrec, yAxisID:"yP", order:3 });
        }

        renderChart({
          data:{ labels, datasets: ds },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            interaction:{mode:"index", intersect:false},
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:true, text:"Ano"}, grid:{color:"rgba(255,255,255,.06)"} },
              y:{ position:"left", title:{display:true, text:labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
              yP:{ position:"right", display:showBars, title:{display:showBars, text:"Precipitação (mm)"}, grid:{drawOnChartArea:false} },
            }
          }
        });

        chartTitle.textContent = `Série anual — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Anos usados: ${labels[0]}–${labels[labels.length-1]} (por months).`;

        setKpis([
          {k:"Anos úteis", v:String(rows.length)},
          {k:"Média (anos)", v:fmt(meanFinite(rows.map(r=>r.mean)),2)},
          {k:"Min (ano)", v:fmt(minFinite(rows.map(r=>r.min)),2)},
          {k:"Max (ano)", v:fmt(maxFinite(rows.map(r=>r.max)),2)},
        ]);

        lastCsvName = `serie_anual_${code}_${V1}_${labels[0]}_${labels[labels.length-1]}.csv`;
        lastPngName = `serie_anual_${code}_${V1}_${labels[0]}_${labels[labels.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // ---------- MODE: heatmap ----------
      if (mode === "heatmap"){
        // matriz (ano x mês) com V1
        const yearsAxis = yearsOk.slice().sort((a,b)=>a-b);

        const points = [];
        let vmin = Infinity, vmax = -Infinity;

        for (const p of packs){
          const y = p.year;
          const byM = new Map();
          for (const r of (p.months||[])){
            const m = Number(r.m);
            if (!(m>=1 && m<=12)) continue;
            const v = safeNum(r[V1]);
            byM.set(m, Number.isFinite(v)?v:null);
          }
          for (let m=1;m<=12;m++){
            const v = byM.has(m) ? byM.get(m) : null;
            if (Number.isFinite(v)){
              vmin = Math.min(vmin, v);
              vmax = Math.max(vmax, v);
            }
            points.push({x:y, y:m, v});
          }
        }
        if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin===vmax){
          vmin = 0; vmax = 1;
        }

        // tabela: 12 meses + valores por ano é pesado; aqui tabela simples por ponto não
        setTable(points.slice(0, 80).map(p=>({ano:p.x, mes:p.y, valor:p.v})));

        const colorForValue = (v) => {
          if (!Number.isFinite(v)) return "rgba(255,255,255,.10)";
          const t = (v - vmin) / (vmax - vmin);
          const a = 0.15 + 0.75*t;
          return `rgba(59,208,255,${a})`;
        };

        renderChart({
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
                return colorForValue(v);
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

        chartTitle.textContent = `Mensal por ano (heatmap) — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Var: ${labelOfVar(V1)} • anos úteis: ${yearsAxis[0]}–${yearsAxis[yearsAxis.length-1]}`;
        setKpis([
          {k:"Anos úteis", v:String(yearsAxis.length)},
          {k:"Min", v:fmt(vmin,2)},
          {k:"Max", v:fmt(vmax,2)},
          {k:"Média", v:fmt(meanFinite(points.map(p=>p.v)),2)},
        ]);

        lastCsvName = `heatmap_${code}_${V1}_${yearsAxis[0]}_${yearsAxis[yearsAxis.length-1]}.csv`;
        lastPngName = `heatmap_${code}_${V1}_${yearsAxis[0]}_${yearsAxis[yearsAxis.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

      // ---------- MODE: relation ----------
      if (mode === "rel"){
        const xs = [];
        const ys = [];
        const pts = [];

        for (const p of packs){
          for (const r of (p.months||[])){
            const x = safeNum(r[V1]);
            const y = safeNum(r[V2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            xs.push(x); ys.push(y);
            pts.push({x, y});
          }
        }

        if (pts.length < 5){
          setTable([]);
          destroyChart();
          setKpis([]);
          setMsg("Poucos pontos para relação (variável ausente ou dados insuficientes).", "err");
          return;
        }

        // regressão linear simples
        let reg = null;
        if (showTrend.checked){
          reg = linearRegression(xs, ys);
        }

        // linha trend
        const ds = [{
          type:"scatter",
          label: `${labelOfVar(V1)} × ${labelOfVar(V2)}`,
          data: pts,
          pointRadius: 3,
          pointHoverRadius: 5
        }];

        if (reg){
          const xmin = Math.min(...xs), xmax = Math.max(...xs);
          const line = [
            {x:xmin, y: reg.a + reg.b*xmin},
            {x:xmax, y: reg.a + reg.b*xmax}
          ];
          ds.push({
            type:"line",
            label: `Tendência linear${showR2.checked ? ` (R²=${fmt(reg.r2,3)})` : ""}`,
            data: line,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0
          });
        }

        // tabela resumida (amostra)
        setTable(pts.slice(0, 200).map(p=>({x:p.x, y:p.y})));

        renderChart({
          data:{ datasets: ds },
          options:{
            responsive:true,
            maintainAspectRatio:false,
            plugins:{ legend:{position:"top"} },
            scales:{
              x:{ title:{display:true, text: labelOfVar(V1)}, grid:{color:"rgba(255,255,255,.06)"} },
              y:{ title:{display:true, text: labelOfVar(V2)}, grid:{color:"rgba(255,255,255,.06)"} },
            }
          }
        });

        chartTitle.textContent = `Relação entre variáveis — ${stationLabel(selectedStation)}`;
        chartMeta.textContent = `Pontos: ${pts.length} (meses válidos no intervalo).`;

        setKpis([
          {k:"Pontos", v:String(pts.length)},
          {k:"X min", v:fmt(minFinite(xs),2)},
          {k:"X max", v:fmt(maxFinite(xs),2)},
          {k:"R²", v: reg && showR2.checked ? fmt(reg.r2,3) : "—"},
        ]);

        lastCsvName = `relacao_${code}_${V1}_x_${V2}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.csv`;
        lastPngName = `relacao_${code}_${V1}_x_${V2}_${yearsOk[0]}_${yearsOk[yearsOk.length-1]}.png`;

        setMsg("Pronto.", "ok");
        return;
      }

    } catch(e){
      console.error(e);
      setMsg(`Erro: ${e.message || e}`, "err");
    }
  }

  // ---------- init ----------
  async function init(){
    try{
      setMsg("Iniciando...", "ok");

      // load stations
      const stUrl = new URL("stations.json", ASSETS).toString();
      const st = await fetchJson(stUrl);

      // aceita array direto ou {stations:[...]}
      stations = Array.isArray(st) ? st : (st.stations || []);
      // normaliza campos esperados
      stations = stations.map(s=>({
        code: s.code || s.id || s.estacao || s.station || s.codigo,
        name: s.name || s.nome || s.station_name || s.estacao_nome || s.city || s.municipio || "—",
        uf: (s.uf || s.UF || s.estado || "—").toUpperCase(),
        city: s.city || s.municipio || "",
        lat: Number(s.lat ?? s.latitude),
        lon: Number(s.lon ?? s.lng ?? s.longitude),
      })).filter(s=>!!s.code);

      // UF select
      const ufs = Array.from(new Set(stations.map(s=>s.uf))).sort();
      fillSelect(ufSelect, ["Todas", ...ufs], x=>x, x=>x, false);

      // initial filtered list
      filteredStations = stations.slice();
      fillSelect(stationSelect, filteredStations, s=>`${s.code} · ${s.name} (${s.uf})`, s=>s.code, false);

      // map
      initMap();
      renderMarkers();

      // select first station by default
      if (filteredStations.length){
        stationSelect.value = filteredStations[0].code;
        selectStation(filteredStations[0].code, true);
      }

      // events
      ufSelect.addEventListener("change", ()=>{
        applyFilters();
        renderMarkers();
      });
      searchStation.addEventListener("input", ()=>{
        applyFilters();
        renderMarkers();
      });
      stationSelect.addEventListener("change", ()=>{
        selectStation(stationSelect.value, true);
      });

      btnClim.addEventListener("click", ()=>setMode("clim"));
      btnAnnual.addEventListener("click", ()=>setMode("annual"));
      btnHeatmap.addEventListener("click", ()=>setMode("heatmap"));
      btnRel.addEventListener("click", ()=>setMode("rel"));

      btnRun.addEventListener("click", run);

      btnPng.addEventListener("click", ()=>{
        if (!chart){ setMsg("Nenhum gráfico para baixar.", "err"); return; }
        downloadPngFromChart(chart, lastPngName);
        setMsg("PNG gerado.", "ok");
      });

      btnCsv.addEventListener("click", ()=>{
        if (!lastRows || !lastRows.length){ setMsg("Nenhuma tabela para baixar.", "err"); return; }
        downloadText(lastCsvName, rowsToCsv(lastRows));
        setMsg("CSV gerado.", "ok");
      });

      btnReset.addEventListener("click", ()=>{
        searchStation.value = "";
        ufSelect.value = "Todas";
        applyFilters();
        renderMarkers();
        setMode("clim");
        setMsg("Reset OK.", "ok");
      });

      setMode("clim");
      setMsg("Pronto.", "ok");

    } catch(e){
      console.error(e);
      setMsg(`Erro ao iniciar: ${e.message || e}`, "err");
    }
  }

  init();
})();
