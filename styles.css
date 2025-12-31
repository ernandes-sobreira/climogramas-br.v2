:root{
  --bg: #eef3f6;
  --panel: #ffffff;
  --ink: #0b2230;
  --muted: #4e6b75;
  --brand: #0b6f75;
  --brand2:#0b6f75;
  --border: rgba(11,34,48,.10);
  --shadow: 0 10px 35px rgba(11,34,48,.10);
  --radius: 16px;
}

*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  background: var(--bg);
  color: var(--ink);
  overflow:hidden; /* IMPORTANT: não "cair" infinito */
}

.topbar{
  height: 64px;
  display:flex;
  align-items:center;
  gap:12px;
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(11,111,117,1), rgba(11,111,117,.92));
  color:#fff;
  border-bottom: 1px solid rgba(255,255,255,.12);
}

.brand{
  display:flex; align-items:center; gap:10px;
  min-width: 320px;
}
.dot{
  width:10px; height:10px; border-radius:50%;
  background: #7cf0d8;
  box-shadow: 0 0 0 4px rgba(124,240,216,.15);
}
.brandText .title{ font-weight:800; letter-spacing:.2px; }
.brandText .subtitle{ font-size:12px; opacity:.92; }

.controls{
  display:flex;
  align-items:center;
  gap:10px;
  flex:1;
  justify-content:flex-end;
  min-width: 0;
}

.searchBox{
  display:flex; align-items:center;
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.20);
  border-radius: 999px;
  padding: 6px 10px;
  min-width: 260px;
  max-width: 420px;
  flex: 1;
}
.searchBox input{
  width:100%;
  background: transparent;
  border:0;
  outline:0;
  color:#fff;
  font-size: 13px;
}
.searchBox input::placeholder{ color: rgba(255,255,255,.75); }

.iconBtn{
  width:26px; height:26px;
  border-radius: 999px;
  border: 0;
  cursor: pointer;
  background: rgba(255,255,255,.18);
  color: #fff;
  font-weight: 800;
}

.select{
  height: 34px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.22);
  background: rgba(255,255,255,.14);
  color:#fff;
  padding: 0 10px;
  font-size: 13px;
  outline: none;
}

.btn{
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.22);
  background: rgba(255,255,255,.14);
  color:#fff;
  cursor:pointer;
  font-weight: 700;
  font-size: 13px;
}
.btn:hover{ filter: brightness(1.05); }

.btn.primary{
  background: #1d4ed8;
  border-color: rgba(255,255,255,.25);
}
.btn.ghost{
  background: rgba(255,255,255,.10);
}

.status{
  height: 30px;
  display:flex;
  align-items:center;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.18);
  font-size: 12px;
  white-space: nowrap;
}

.layout{
  height: calc(100% - 64px);
  display:grid;
  grid-template-columns: 330px 1fr 420px;
  gap: 12px;
  padding: 12px;
}

.panel{
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow:hidden;
  display:flex;
  flex-direction:column;
  min-height: 0; /* important */
}

.panelHead{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border);
}

.h{ font-size: 14px; font-weight: 900; }
.h2{ font-size: 13px; font-weight: 900; margin-bottom: 6px; }
.small{ font-size: 12px; color: var(--muted); }

.pill{
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(11,111,117,.25);
  background: rgba(11,111,117,.10);
  color: var(--brand2);
  white-space: nowrap;
}

.left .hint{
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.left .hint ul{ margin:0; padding-left: 16px; }
.left .hint li{ margin: 6px 0; }

.list{
  padding: 10px;
  overflow:auto;
  min-height: 0;
}

.item{
  border: 1px solid rgba(11,34,48,.10);
  border-radius: 14px;
  padding: 10px 10px;
  margin-bottom: 10px;
  cursor:pointer;
  transition: .12s;
  background: #fff;
}
.item:hover{ transform: translateY(-1px); box-shadow: 0 8px 18px rgba(11,34,48,.08); }
.item.active{
  border-color: rgba(29,78,216,.40);
  box-shadow: 0 10px 22px rgba(29,78,216,.12);
}
.item .name{ font-weight: 900; font-size: 13px; }
.item .meta{
  margin-top: 4px;
  display:flex;
  justify-content:space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}

.map{ flex:1; min-height: 0; }

.right{
  overflow:hidden;
}
.right .kpis{
  display:grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 12px;
}
.kpi{
  border: 1px solid rgba(11,34,48,.10);
  border-radius: 14px;
  padding: 10px;
  background: #fff;
}
.kpi .k{
  font-size: 11px;
  color: var(--muted);
}
.kpi .v{
  font-size: 13px;
  font-weight: 900;
  margin-top: 3px;
}

.summaryCard{
  margin: 0 12px 10px;
  border: 1px solid rgba(11,34,48,.10);
  border-radius: 14px;
  padding: 10px;
  background: #fff;
}
.summaryText{
  font-size: 12px;
  color: var(--muted);
  line-height: 1.35;
}

.tabs{
  display:flex;
  gap:8px;
  padding: 0 12px 10px;
}
.tab{
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(11,34,48,.12);
  background: rgba(11,34,48,.04);
  cursor:pointer;
  font-weight: 800;
  font-size: 12px;
}
.tab.active{
  background: rgba(29,78,216,.12);
  border-color: rgba(29,78,216,.30);
  color: #1d4ed8;
}

.chartWrap{
  padding: 0 12px 12px;
  overflow:auto;
  min-height: 0;
}

.tabPane{ display:none; }
.tabPane.active{ display:block; }

.chartBox{
  height: 360px;  /* FIXO — não cai infinito */
  border: 1px solid rgba(11,34,48,.10);
  border-radius: 14px;
  padding: 10px;
  background: #fff;
}
.foot{
  font-size: 12px;
  color: var(--muted);
  padding: 8px 2px 0;
}

/* Mobile */
.mobileOnly{ display:none; }
@media (max-width: 1100px){
  .layout{ grid-template-columns: 1fr; }
  .center{ order: 1; }
  .right{ order: 2; }
  .left{
    position: fixed;
    z-index: 50;
    top: 70px;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display:none;
  }
  .left.open{ display:flex; }
  .mobileOnly{ display:inline-flex; }
  body{ overflow:auto; }
  .layout{ height: auto; }
  .map{ height: 52vh; }
  .right .kpis{ grid-template-columns: repeat(2, 1fr); }
}
