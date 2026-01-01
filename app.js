/* clima cac — app.js
   - Lê CSV via URL / arquivo local
   - Detecta colunas
   - Agrega (dia/mês/ano)
   - Climograma: precipitação (barras) + temperatura (linha)
   - Opções: min/max e faixa de desvio padrão
   - Download PNG e CSV agregado
*/

let RAW = [];
let HEADERS = [];
let chart = null;
let aggregatedRows = [];

const el = (id) => document.getElementById(id);

const statusHint = el("statusHint");
const dataRangePill = el("dataRangePill");

const csvUrl = el("csvUrl");
const csvFile = el("csvFile");

const dateCol = el("dateCol");
const tempCol = el("tempCol");
const rainCol = el("rainCol");
const agg = el("agg");

const startDate = el("startDate");
const endDate = el("endDate");
const showStd = el("showStd");
const showMinMax = el("showMinMax");

const renderBtn = el("renderBtn");
const downloadPngBtn = el("downloadPngBtn");
const downloadCsvBtn = el("downloadCsvBtn");

const metaLine = el("metaLine");
const previewTable = el("previewTable");
const previewHead = previewTable.querySelector("thead");
const previewBody = previewTable.querySelector("tbody");

function setStatus(msg, type="ok"){
  statusHint.textContent = msg;
  statusHint.style.color =
    type === "bad" ? "rgb(251,113,133)" :
    type === "warn" ? "rgb(251,191,36)" :
    "rgba(169,182,214,1)";
}

function normalizeHeader(h){
  return String(h || "").trim();
}

function guessDateHeader(headers){
  const candidates = headers.filter(h => /data|date|dia/i.test(h));
  return candidates[0] || headers[0] || "";
}

function guessTempHeader(headers){
  // Você citou: "Temperatura (oC)" (sem °)
  const prefs = [
    "Temperatura (oC)",
    "Temperatura (°C)",
    "Temperatura",
    "temp",
    "temperature"
  ];
  for (const p of prefs){
    const found = headers.find(h => h.toLowerCase() === p.toLowerCase());
    if (found) return found;
  }
  return headers.find(h => /temp|temper/i.test(h)) || "";
}

function guessRainHeader(headers){
  const prefs = ["Precipitação (mm)", "Precipitacao (mm)", "Precipitação", "chuva", "rain", "precip"];
  for (const p of prefs){
    const found = headers.find(h => h.toLowerCase() === p.toLowerCase());
    if (found) return found;
  }
  return headers.find(h => /precip|chuva|rain/i.test(h)) || "";
}

function fillSelect(selectEl, headers, preferred=""){
  selectEl.innerHTML = "";
  headers.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = h;
    selectEl.appendChild(opt);
  });
  if (preferred && headers.includes(preferred)) selectEl.value = preferred;
}

function parseNumber(v){
  if (v === null || v === undefined) return NaN;
  // aceita "12,3"
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseDateSmart(v){
  if (!v) return null;
  const s = String(v).trim();

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m){
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }

  // DD/MM/YYYY or DD/MM/YY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m){
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    return isNaN(d) ? null : d;
  }

  // fallback
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function keyForAgg(d, mode){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  if (mode === "year") return `${y}`;
  if (mode === "month") return `${y}-${m}`;
  return `${y}-${m}-${day}`;
}

function labelForAgg(key, mode){
  if (mode === "year") return key;
  if (mode === "month") return key; // YYYY-MM
  return key; // YYYY-MM-DD
}

function computeStats(values){
  const arr = values.filter(v => Number.isFinite(v));
  const n = arr.length;
  if (!n) return { n:0, mean:NaN, min:NaN, max:NaN, sd:NaN };
  let sum = 0;
  let min = arr[0], max = arr[0];
  for (const v of arr){
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let ss = 0;
  for (const v of arr){
    const dx = v - mean;
    ss += dx * dx;
  }
  const sd = Math.sqrt(ss / n); // sd populacional (ok pra faixa visual)
  return { n, mean, min, max, sd };
}

function dateRangeFromRows(rows, dateKey){
  let min = null, max = null;
  for (const r of rows){
    const d = parseDateSmart(r[dateKey]);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { min, max };
}

function buildAggregated(){
  const dKey = dateCol.value;
  const tKey = tempCol.value;
  const rKey = rainCol.value;
  const mode = agg.value;

  const d0 = startDate.value ? new Date(startDate.value + "T00:00:00") : null;
  const d1 = endDate.value ? new Date(endDate.value + "T23:59:59") : null;

  const buckets = new Map();

  for (const row of RAW){
    const d = parseDateSmart(row[dKey]);
    if (!d) continue;
    if (d0 && d < d0) continue;
    if (d1 && d > d1) continue;

    const k = keyForAgg(d, mode);
    if (!buckets.has(k)){
      buckets.set(k, { temp:[], rain:[] });
    }
    const b = buckets.get(k);
    b.temp.push(parseNumber(row[tKey]));
    b.rain.push(parseNumber(row[rKey]));
  }

  const keys = Array.from(buckets.keys()).sort(); // YYYY-MM sort ok
  const out = [];

  for (const k of keys){
    const b = buckets.get(k);
    const ts = computeStats(b.temp);
    const rs = computeStats(b.rain);

    // Precipitação em climograma geralmente é soma no período
    // Temperatura geralmente é média
    // Min/Max e SD fazem sentido pra ambos.
    const rainSum = b.rain.filter(Number.isFinite).reduce((a,v)=>a+v, 0);

    out.push({
      period: labelForAgg(k, mode),
      temp_mean: ts.mean,
      temp_min: ts.min,
      temp_max: ts.max,
      temp_sd: ts.sd,
      rain_sum: rainSum,
      rain_mean: rs.mean,
      rain_min: rs.min,
      rain_max: rs.max,
      rain_sd: rs.sd,
      n_temp: ts.n,
      n_rain: rs.n
    });
  }

  return out;
}

function setPreviewTable(rows){
  previewHead.innerHTML = "";
  previewBody.innerHTML = "";
  if (!rows.length) return;

  const cols = Object.keys(rows[0]);

  const trh = document.createElement("tr");
  cols.forEach(c=>{
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  });
  previewHead.appendChild(trh);

  const preview = rows.slice(0, 25);
  preview.forEach(r=>{
    const tr = document.createElement("tr");
    cols.forEach(c=>{
      const td = document.createElement("td");
      const v = r[c];
      td.textContent = (typeof v === "number" && Number.isFinite(v)) ? (Math.round(v*100)/100).toString() : String(v);
      tr.appendChild(td);
    });
    previewBody.appendChild(tr);
  });
}

function destroyChart(){
  if (chart){
    chart.destroy();
    chart = null;
  }
}

function renderChart(rows){
  destroyChart();

  const labels = rows.map(r => r.period);

  const tempMean = rows.map(r => r.temp_mean);
  const tempMin  = rows.map(r => r.temp_min);
  const tempMax  = rows.map(r => r.temp_max);
  const tempPlus = rows.map(r => (Number.isFinite(r.temp_mean) && Number.isFinite(r.temp_sd)) ? (r.temp_mean + r.temp_sd) : NaN);
  const tempMinus= rows.map(r => (Number.isFinite(r.temp_mean) && Number.isFinite(r.temp_sd)) ? (r.temp_mean - r.temp_sd) : NaN);

  const rainSum  = rows.map(r => r.rain_sum);

  const ctx = el("climoChart").getContext("2d");

  // datasets:
  // - rain (bar) no eixo y2
  // - temp mean (line) no eixo y
  // - temp min/max (line) se marcado
  // - temp sd band (fill between) se marcado (usando dois datasets com fill)
  const datasets = [];

  // precipitação (barras)
  datasets.push({
    type: "bar",
    label: "Precipitação (mm) — soma",
    data: rainSum,
    yAxisID: "y2",
    borderWidth: 0,
    // sem cor fixa (Chart.js dá default), mas vamos manter legível:
    // se você quiser cores, eu ajusto depois.
  });

  // sd band (primeiro: inferior, depois superior preenchendo)
  if (showStd.checked){
    datasets.push({
      type: "line",
      label: "Temp − 1σ",
      data: tempMinus,
      yAxisID: "y",
      pointRadius: 0,
      borderWidth: 0,
      tension: 0.25
    });
    datasets.push({
      type: "line",
      label: "Faixa ±1σ",
      data: tempPlus,
      yAxisID: "y",
      pointRadius: 0,
      borderWidth: 0,
      fill: "-1",
      tension: 0.25
    });
  }

  // min/max
  if (showMinMax.checked){
    datasets.push({
      type: "line",
      label: "Temperatura mín (°C)",
      data: tempMin,
      yAxisID: "y",
      pointRadius: 2,
      borderWidth: 2,
      tension: 0.25
    });
    datasets.push({
      type: "line",
      label: "Temperatura máx (°C)",
      data: tempMax,
      yAxisID: "y",
      pointRadius: 2,
      borderWidth: 2,
      tension: 0.25
    });
  }

  // mean
  datasets.push({
    type: "line",
    label: "Temperatura média (°C)",
    data: tempMean,
    yAxisID: "y",
    pointRadius: 3,
    borderWidth: 3,
    tension: 0.25
  });

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
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (!Number.isFinite(v)) return `${ctx.dataset.label}: —`;
              return `${ctx.dataset.label}: ${Math.round(v*100)/100}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,.06)" },
          ticks: { maxRotation: 0, autoSkip: true }
        },
        y: {
          position: "left",
          title: { display: true, text: "Temperatura (°C)" },
          grid: { color: "rgba(255,255,255,.06)" }
        },
        y2: {
          position: "right",
          title: { display: true, text: "Precipitação (mm)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
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

function downloadAggregatedCSV(){
  if (!aggregatedRows.length) return;
  const cols = Object.keys(aggregatedRows[0]);
  const lines = [];
  lines.push(cols.join(","));
  for (const r of aggregatedRows){
    const line = cols.map(c=>{
      const v = r[c];
      if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v*10000)/10000);
      // escape simples
      const s = String(v ?? "");
      return (s.includes(",") || s.includes('"') || s.includes("\n"))
        ? `"${s.replace(/"/g,'""')}"`
        : s;
    }).join(",");
    lines.push(line);
  }
  const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8" });
  downloadBlob(`climacac_agregado_${agg.value}.csv`, blob);
}

function downloadPNG(){
  if (!chart) return;
  const a = document.createElement("a");
  a.href = chart.toBase64Image("image/png", 1);
  a.download = `climacac_climograma_${agg.value}.png`;
  a.click();
}

function setDateInputsFromRange(minD, maxD){
  if (!minD || !maxD) return;
  startDate.value = toISODate(minD);
  endDate.value = toISODate(maxD);
}

function afterLoad(){
  // preencher selects
  fillSelect(dateCol, HEADERS, guessDateHeader(HEADERS));
  fillSelect(tempCol, HEADERS, guessTempHeader(HEADERS));
  fillSelect(rainCol, HEADERS, guessRainHeader(HEADERS));

  // definir range
  const r = dateRangeFromRows(RAW, dateCol.value);
  if (r.min && r.max){
    dataRangePill.textContent = `Período disponível: ${toISODate(r.min)} → ${toISODate(r.max)}`;
    setDateInputsFromRange(r.min, r.max);
  } else {
    dataRangePill.textContent = `Período: não detectado (verifique a coluna de data)`;
  }

  setStatus(`CSV carregado: ${RAW.length} linhas. Agora clique em "Gerar climograma".`);
  metaLine.textContent = `Linhas: ${RAW.length} • colunas: ${HEADERS.length}`;
}

function loadCSVFromText(text){
  Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (res) => {
      if (res.errors && res.errors.length){
        console.warn(res.errors);
        setStatus(`Falha ao ler CSV: ${res.errors[0].message}`, "bad");
        return;
      }
      RAW = res.data || [];
      // headers (Papa às vezes não dá fields)
      HEADERS = res.meta && res.meta.fields
        ? res.meta.fields.map(normalizeHeader).filter(Boolean)
        : (RAW[0] ? Object.keys(RAW[0]).map(normalizeHeader) : []);

      if (!RAW.length || !HEADERS.length){
        setStatus("CSV vazio ou sem cabeçalho. Confirme se a 1ª linha tem nomes das colunas.", "bad");
        return;
      }
      afterLoad();
    }
  });
}

async function loadFromURL(url){
  try{
    setStatus("Baixando CSV…", "warn");
    const r = await fetch(url, { cache:"no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    loadCSVFromText(text);
  }catch(err){
    console.error(err);
    setStatus(`Erro ao carregar URL: ${err.message}`, "bad");
  }
}

function loadFromFile(file){
  const fr = new FileReader();
  fr.onload = () => loadCSVFromText(fr.result);
  fr.onerror = () => setStatus("Erro lendo arquivo local.", "bad");
  fr.readAsText(file, "utf-8");
}

/* Events */
el("loadUrlBtn").addEventListener("click", ()=>{
  const url = csvUrl.value.trim();
  if (!url) return setStatus("Cole uma URL de CSV primeiro.", "warn");
  loadFromURL(url);
});

el("loadFileBtn").addEventListener("click", ()=>{
  const f = csvFile.files && csvFile.files[0];
  if (!f) return setStatus("Selecione um arquivo CSV.", "warn");
  loadFromFile(f);
});

el("loadLocalBtn").addEventListener("click", ()=>{
  loadFromURL("assets/data/climacac-1.csv");
});

el("resetBtn").addEventListener("click", ()=>{
  RAW = [];
  HEADERS = [];
  aggregatedRows = [];
  destroyChart();
  dateCol.innerHTML = "";
  tempCol.innerHTML = "";
  rainCol.innerHTML = "";
  previewHead.innerHTML = "";
  previewBody.innerHTML = "";
  dataRangePill.textContent = "Carregue um CSV para ver o período disponível";
  metaLine.textContent = "—";
  downloadPngBtn.disabled = true;
  downloadCsvBtn.disabled = true;
  setStatus("Reset feito. Carregue um CSV novamente.");
});

renderBtn.addEventListener("click", ()=>{
  if (!RAW.length) return setStatus("Carregue um CSV primeiro.", "warn");
  if (!dateCol.value || !tempCol.value || !rainCol.value){
    return setStatus("Selecione as colunas (data, temperatura, precipitação).", "warn");
  }
  aggregatedRows = buildAggregated();
  if (!aggregatedRows.length){
    destroyChart();
    setPreviewTable([]);
    metaLine.textContent = "Sem dados no período selecionado.";
    downloadPngBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    return setStatus("Sem dados para o período. Ajuste as datas.", "warn");
  }

  renderChart(aggregatedRows);
  setPreviewTable(aggregatedRows);

  const s = startDate.value || "—";
  const e = endDate.value || "—";
  metaLine.textContent = `Agregação: ${agg.options[agg.selectedIndex].text} • Período: ${s} → ${e}`;

  downloadPngBtn.disabled = false;
  downloadCsvBtn.disabled = false;

  setStatus("Climograma gerado.");
});

downloadPngBtn.addEventListener("click", downloadPNG);
downloadCsvBtn.addEventListener("click", downloadAggregatedCSV);

// Re-render rápido quando trocar toggles (se já existir chart)
showStd.addEventListener("change", ()=>{ if (aggregatedRows.length) renderChart(aggregatedRows); });
showMinMax.addEventListener("change", ()=>{ if (aggregatedRows.length) renderChart(aggregatedRows); });

/* Auto-load opcional: se você quiser já abrir com o CSV local, descomente:
loadFromURL("assets/data/climacac-1.csv");
*/
