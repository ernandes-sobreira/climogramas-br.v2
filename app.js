:root{
  --bg:#0b1020;
  --panel:#0f1730;
  --panel2:#121e3d;
  --line:rgba(255,255,255,.08);
  --text:#e9eefc;
  --muted:#aab6d6;
  --accent:#56f2ff;
  --accent2:#a78bfa;
  --good:#34d399;
  --warn:#fbbf24;
  --bad:#fb7185;
  --shadow:0 18px 40px rgba(0,0,0,.35);
  --r:18px;
  --r2:14px;
  --p:18px;
  --p2:14px;
  --max:1280px;
  --font: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,"Noto Sans","Helvetica Neue";
}

*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family:var(--font);
  color:var(--text);
  background:
    radial-gradient(900px 700px at 15% -10%, rgba(86,242,255,.12), transparent 60%),
    radial-gradient(900px 700px at 100% 0%, rgba(167,139,250,.12), transparent 55%),
    var(--bg);
}

.topbar{
  max-width:var(--max);
  margin:18px auto 0;
  padding:0 var(--p);
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:14px;
}

.brand{display:flex;flex-direction:column;gap:6px}
.logo{
  font-weight:900;
  letter-spacing:.2px;
  font-size:28px;
}
.logo span{color:var(--accent)}
.logo small{font-size:12px; color:var(--muted); font-weight:700; margin-left:8px}
.subtitle{max-width:760px; color:var(--muted); font-size:13px; line-height:1.35}

.statusPills{display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end}
.pill{
  padding:10px 12px;
  border-radius:999px;
  background:rgba(15,23,48,.65);
  border:1px solid rgba(86,242,255,.18);
  color:var(--muted);
  font-size:12px;
  white-space:nowrap;
}

.layout{
  max-width:var(--max);
  margin:14px auto 28px;
  padding:0 var(--p);
  display:grid;
  grid-template-columns: 0.95fr 1.35fr;
  gap:16px;
}

.panel{display:flex;flex-direction:column;gap:16px}

.card{
  background: linear-gradient(180deg, rgba(18,30,61,.85), rgba(15,23,48,.85));
  border:1px solid var(--line);
  border-radius:var(--r);
  box-shadow:var(--shadow);
  padding:var(--p);
  overflow:hidden;
}

h2{margin:0 0 14px; font-size:16px; letter-spacing:.2px}
h3{margin:0; font-size:13px; color:var(--muted)}

.grid2{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}
.span2{grid-column:1 / -1}

.field{
  background: rgba(0,0,0,.14);
  border:1px solid rgba(255,255,255,.06);
  border-radius:var(--r2);
  padding:var(--p2);
}
label{display:block; font-size:12px; color:var(--muted); margin-bottom:8px}

input,select,button{font-family:inherit}

input[type="text"], select{
  width:100%;
  padding:10px 10px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.10);
  background:rgba(11,16,32,.85);
  color:var(--text);
  outline:none;
}

.hint{margin-top:8px; font-size:12px; color:var(--muted); line-height:1.35}

.segmented{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.seg{
  padding:9px 10px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.10);
  background:rgba(0,0,0,.12);
  color:var(--text);
  cursor:pointer;
}
.seg.on{
  border-color: rgba(86,242,255,.45);
  background: rgba(86,242,255,.10);
}

.checks{display:flex; flex-direction:column; gap:10px}
.check{display:flex; align-items:center; gap:10px; color:var(--muted); font-size:12px}

.actions{display:flex; gap:10px; flex-wrap:wrap}
.btn{
  padding:10px 12px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.12);
  background: rgba(18,30,61,.75);
  color:var(--text);
  cursor:pointer;
  transition: transform .06s ease, border-color .15s ease;
  white-space:nowrap;
}
.btn:hover{transform: translateY(-1px); border-color: rgba(86,242,255,.25)}
.btn:active{transform: translateY(0)}
.btn.primary{
  border-color: rgba(86,242,255,.45);
  background: rgba(86,242,255,.12);
}
.btn.ghost{background: rgba(0,0,0,.10)}
.btn:disabled{opacity:.55; cursor:not-allowed; transform:none}

.mapCard{padding:0}
.mapHead{
  padding: var(--p);
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
}
.miniHint{color:var(--muted); font-size:12px}
#map{height: 340px; width:100%}

.chartHead{
  display:flex;
  justify-content:space-between;
  gap:12px;
  align-items:flex-start;
  margin-bottom: 10px;
}
.meta{color:var(--muted); font-size:12px; line-height:1.35}
.kpis{display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end}
.kpi{
  padding:10px 12px;
  border-radius:14px;
  background: rgba(0,0,0,.14);
  border: 1px solid rgba(255,255,255,.06);
  min-width: 150px;
}
.kpi .k{font-size:11px; color:var(--muted)}
.kpi .v{font-size:16px; font-weight:900; margin-top:4px}

.chartWrap{
  background: rgba(0,0,0,.14);
  border:1px solid rgba(255,255,255,.06);
  border-radius:var(--r2);
  padding:12px;
  height: 440px;
}
.chartWrap canvas{width:100% !important; height:100% !important}

.subCard{
  margin-top:12px;
  padding:12px;
  border-radius:var(--r2);
  border:1px solid rgba(255,255,255,.06);
  background: rgba(0,0,0,.12);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.tableBlock{margin-top:14px}
.tableHead{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  gap:10px;
  margin-bottom:10px;
}
.tableScroll{
  overflow:auto;
  max-height:260px;
  border-radius:14px;
  border:1px solid rgba(255,255,255,.06);
}
table{width:100%; border-collapse:collapse; font-size:12px}
thead th{
  position:sticky; top:0;
  background: rgba(15,23,48,.95);
  color: var(--muted);
  text-align:left;
  padding:10px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
tbody td{
  padding:10px;
  border-bottom:1px solid rgba(255,255,255,.06);
}
tbody tr:hover td{background: rgba(86,242,255,.05)}

.footer{
  max-width:var(--max);
  margin: 0 auto 28px;
  padding: 0 var(--p);
  display:flex;
  justify-content:space-between;
  gap:12px;
  color: var(--muted);
  font-size:12px;
}
.muted{opacity:.9}

@media (max-width: 1020px){
  .layout{grid-template-columns:1fr}
  #map{height:320px}
  .chartWrap{height:380px}
}
