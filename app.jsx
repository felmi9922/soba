// SOBA — 相場の見取り図
// DATA は docs/data.json を fetch して差し込む（build.py が毎営業日書き出す）。
// UI 本体はここ。DATA の形式は README を参照。
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
let DATA = null;
const SEV = { "強アラート": 3, "アラート": 2, "注意": 1, "正常": 0, "取得失敗": -1, "未取得": -1 };
const FLOW = ["未精査", "精査中", "監視中", "エントリー", "見送り"];
const NEXT = { "未精査": "精査中", "精査中": "監視中", "監視中": "エントリー" };
const C = {
  bg: "#0a0b0d", panel: "#141619", panel2: "#1a1d22", rule: "#242730", rule2: "#2f333c",
  ink: "#e8e6e3", mut: "#7d8590", dim: "#565d68",
  up: "#00d68f", dn: "#ff4d5e", hot: "#ff6b35", warm: "#ffb020", cool: "#4d9fff",
};
const MONO = "'JetBrains Mono','SF Mono',ui-monospace,monospace";
const SANS = "'Zen Kaku Gothic New',-apple-system,sans-serif";
const pct = (v, d = 2) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
const col = v => v == null ? C.dim : v > 0 ? C.up : v < 0 ? C.dn : C.mut;
const HUE = v => v == null ? "transparent"
  : v > 0 ? `rgba(0,214,143,${.1 + Math.min(1, v / 15) * .72})`
  : `rgba(255,77,94,${.1 + Math.min(1, -v / 15) * .72})`;
// 判断（ステータス・メモ・★）は localStorage に保存。URL が固定なので毎日引き継がれる。SYNC はバックアップ用。
const KEY = "soba_v2";
const load = async () => { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : {}; } catch { return {}; } };
const save = async s => { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } };
// ── パーツ ──
const Tag = ({ j, onClick, children }) => {
  const s = SEV[j] ?? 0;
  const st = s >= 3 ? { background: C.hot, color: "#0a0b0d", fontWeight: 700 }
    : s === 2 ? { background: "rgba(255,107,53,.14)", color: C.hot, boxShadow: `inset 0 0 0 1px rgba(255,107,53,.3)` }
    : s === 1 ? { background: "rgba(255,176,32,.1)", color: C.warm, boxShadow: `inset 0 0 0 1px rgba(255,176,32,.24)` }
    : s < 0 ? { background: "rgba(125,133,144,.1)", color: C.dim, textDecoration: "line-through" }
    : { background: "rgba(125,133,144,.1)", color: C.mut };
  return <span onClick={onClick} style={{ ...st, padding: "3px 9px", fontSize: 11, letterSpacing: ".02em",
    cursor: onClick ? "pointer" : "default", display: "inline-block", whiteSpace: "nowrap" }}>{children ?? j}</span>;
};
const Mv = ({ v }) => v == null ? <span style={{ color: C.dim }}>—</span>
  : v === 0 ? <span style={{ color: C.dim }}>0</span>
  : <span style={{ fontFamily: MONO, fontSize: 11, padding: "2px 6px", background: v > 0 ? "rgba(0,214,143,.12)" : "rgba(255,77,94,.12)",
      color: v > 0 ? C.up : C.dn }}>{v > 0 ? "▲" : "▼"}{Math.abs(v)}</span>;
const Dot = ({ k }) => <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%",
  marginRight: 8, verticalAlign: "middle", background: k === "テーマ" ? C.hot : C.dim }} />;
const H = ({ children, note }) => <div style={{ margin: "34px 0 14px" }}>
  <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingBottom: 8, borderBottom: `1px solid ${C.rule}` }}>
    <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".14em", color: C.ink }}>{children}</h2>
    <div style={{ flex: 1, height: 1, background: C.rule }} />
  </div>
  {note && <p style={{ fontSize: 11.5, color: C.mut, marginTop: 9, lineHeight: 1.75, maxWidth: "72ch" }}>{note}</p>}
</div>;
const Th = ({ l, children }) => <th style={{ padding: "9px 11px", fontSize: 10, fontWeight: 500, letterSpacing: ".1em",
  color: C.dim, textAlign: l ? "left" : "right", borderBottom: `1px solid ${C.rule}`, whiteSpace: "nowrap" }}>{children}</th>;
const Td = ({ v, d = 2 }) => <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO,
  fontSize: 12.5, color: col(v) }}>{pct(v, d)}</td>;
const TR = ({ children, onClick }) => <tr onClick={onClick}
  style={{ borderBottom: `1px solid ${C.rule}`, cursor: onClick ? "pointer" : "default" }}
  onMouseEnter={e => e.currentTarget.style.background = C.panel2}
  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{children}</tr>;
const Table = ({ head, children }) => <div style={{ border: `1px solid ${C.rule}`, background: C.panel, overflowX: "auto" }}>
  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
    <thead><tr>{head}</tr></thead><tbody>{children}</tbody></table></div>;
const Sheet = ({ open, onClose, title, sub, children }) => {
  useEffect(() => { const h = e => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h); }, [open, onClose]);
  if (!open) return null;
  return <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex",
    alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)", backdropFilter: "blur(3px)", padding: 16 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: C.panel, border: `1px solid ${C.rule2}`,
      width: 880, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "17px 22px", borderBottom: `1px solid ${C.rule}`, display: "flex",
        justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexShrink: 0 }}>
        <div><h3 style={{ fontSize: 16, fontWeight: 700, color: C.ink, letterSpacing: ".03em" }}>{title}</h3>
          {sub && <div style={{ fontSize: 11.5, color: C.mut, marginTop: 4, fontFamily: MONO }}>{sub}</div>}</div>
        <button onClick={onClose} style={{ width: 27, height: 27, border: `1px solid ${C.rule2}`, background: "none",
          color: C.mut, cursor: "pointer", fontSize: 14, flexShrink: 0 }}>×</button></div>
      <div style={{ padding: "16px 22px 22px", overflow: "auto" }}>{children}</div></div></div>;
};
const Spark = ({ obs }) => {
  const v = obs.filter(x => x.v != null);
  if (v.length < 2) return null;
  const ys = v.map(x => x.v), mn = Math.min(...ys), mx = Math.max(...ys), W = 820, Hh = 66;
  const p = v.map((x, i) => [10 + i * (W - 20) / (v.length - 1), Hh - 10 - ((x.v - mn) / ((mx - mn) || 1)) * (Hh - 22)]);
  const area = `M${p[0][0]},${Hh - 1} ` + p.map(q => `L${q[0]},${q[1]}`).join(" ") + ` L${p.at(-1)[0]},${Hh - 1}Z`;
  const rising = v.at(-1).v >= v[0].v;
  return <div style={{ marginBottom: 16, background: C.panel2, border: `1px solid ${C.rule}`, padding: "8px 0 0" }}>
    <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", height: Hh, display: "block" }}>
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={rising ? C.up : C.dn} stopOpacity=".18" />
        <stop offset="100%" stopColor={rising ? C.up : C.dn} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#g)" />
      <polyline points={p.map(q => q.join(",")).join(" ")} fill="none" stroke={rising ? C.up : C.dn} strokeWidth="1.4" />
      {p.map((q, i) => SEV[v[i].j] >= 2 && <circle key={i} cx={q[0]} cy={q[1]} r="3.2" fill={C.hot} />)}
    </svg>
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px 7px", fontSize: 10,
      color: C.dim, fontFamily: MONO }}>
      <span>{v[0].d}　{v[0].v.toLocaleString()}</span><span>{v.at(-1).d}　{v.at(-1).v.toLocaleString()}</span></div></div>;
};
const Btn = ({ on, onClick, children, accent }) => <button onClick={onClick}
  style={{ padding: "6px 13px", fontSize: 11.5, fontFamily: SANS, cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${on ? (accent || C.ink) : C.rule2}`, background: on ? (accent || C.ink) : "transparent",
    color: on ? C.bg : C.mut, transition: "all .12s" }}>{children}</button>;
const Seg = ({ opts, val, set }) => <div style={{ display: "flex", border: `1px solid ${C.rule2}` }}>
  {opts.map(([k, l], i) => <button key={k} onClick={() => set(k)}
    style={{ padding: "6px 13px", fontSize: 11.5, fontFamily: SANS, cursor: "pointer", whiteSpace: "nowrap",
      border: "none", borderLeft: i ? `1px solid ${C.rule2}` : "none",
      background: val === k ? C.ink : "transparent", color: val === k ? C.bg : C.mut }}>{l}</button>)}</div>;
const Input = props => <input {...props} style={{ padding: "6px 10px", fontSize: 12.5, fontFamily: SANS,
  background: C.panel2, border: `1px solid ${C.rule2}`, color: C.ink, minWidth: 190, outline: "none" }} />;
function App() {
  const [day, setDay] = useState(DATA.latest);
  const [view, setView] = useState("now");
  const [st, setSt] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { load().then(s => setSt(s || {})); }, []);
  const patch = useCallback((code, o) => {
    setSt(p => { const n = { ...p, [code]: { ...(p[code] || {}), ...o, at: new Date().toISOString().slice(0, 16).replace("T", " ") } };
      setMsg("SAVING"); save(n).then(ok => { setMsg(ok ? "SAVED" : "FAILED"); setTimeout(() => setMsg(""), 1600); });
      return n; });
  }, []);
  const T = DATA.tags[day].tags, bench = DATA.tags[day].bench;
  const byInd = useMemo(() => { const m = {};
    DATA.ind.forEach(r => (m[r.k] = m[r.k] || []).push(r));
    Object.values(m).forEach(g => g.sort((a, b) => (a.d || "").localeCompare(b.d || ""))); return m; }, []);
  const iL = useMemo(() => Object.fromEntries(Object.entries(byInd).map(([k, g]) => [k, g.at(-1)])), [byInd]);
  const cands = useMemo(() => DATA.cands.map(c => { const o = (st || {})[c.code] || {};
    return { ...c, status: o.status || c.status, memo: o.memo || "", flag: !!o.flag, at: o.at }; }), [st]);
  const alerts = useMemo(() => Object.entries(iL).filter(([, v]) => SEV[v.j] >= 1)
    .sort((a, b) => SEV[b[1].j] - SEV[a[1].j]), [iL]);
  const link = k => (DATA.link[k] || []).filter(x => T[x]).map(x => [x, T[x]]).sort((a, b) => b[1].m - a[1].m);
  if (!st) return <div style={{ background: C.bg, minHeight: "100vh", color: C.dim, padding: 40,
    fontFamily: MONO, fontSize: 12 }}>LOADING…</div>;
  const rank = Object.entries(T).filter(x => x[1].r).sort((a, b) => a[1].r - b[1].r);
  const moved = Object.entries(T).filter(x => x[1].mv != null && Math.abs(x[1].mv) >= 8)
    .sort((a, b) => Math.abs(b[1].mv) - Math.abs(a[1].mv));
  const nw = cands.filter(c => c.status === "未精査").length;
  const watch = cands.filter(c => c.status === "監視中" || c.flag);
  return <div style={{ background: C.bg, minHeight: "100vh", color: C.ink, fontFamily: SANS, fontSize: 14 }}>
    <div style={{ maxWidth: 1340, margin: "0 auto", padding: "0 20px 70px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20,
        flexWrap: "wrap", padding: "20px 0 14px", borderBottom: `1px solid ${C.rule2}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, letterSpacing: ".2em", color: C.ink }}>SOBA</span>
          <span style={{ fontSize: 11, color: C.dim, letterSpacing: ".1em" }}>相場の見取り図</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, fontFamily: MONO, color: C.mut }}>
          {msg && <span style={{ color: msg === "SAVED" ? C.up : msg === "FAILED" ? C.dn : C.warm, letterSpacing: ".1em" }}>{msg}</span>}
          {DATA.built && <span style={{ color: C.dim, fontSize: 10 }} title="data.json の生成時刻">built {DATA.built.slice(0, 16).replace("T", " ")}</span>}
          <button onClick={() => setSheet({ t: "sync" })} title="判断の持ち出しと取り込み"
            style={{ background: "none", border: `1px solid ${C.rule2}`, color: C.mut, padding: "3px 9px",
              fontSize: 10, fontFamily: MONO, letterSpacing: ".1em", cursor: "pointer" }}>SYNC</button>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.up, boxShadow: `0 0 7px ${C.up}` }} />
            <select value={day} onChange={e => setDay(e.target.value)} style={{ background: C.panel2, color: C.ink,
              border: `1px solid ${C.rule2}`, padding: "3px 7px", fontSize: 11, fontFamily: MONO, outline: "none" }}>
              {[...DATA.days].reverse().map(d => <option key={d} style={{ background: C.panel }}>{d}</option>)}</select></span>
        </div>
      </header>
      <nav style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.rule}`, marginBottom: 8, overflowX: "auto" }}>
        {[["now", "OVERVIEW", "きょう"], ["ind", "SIGNALS", "指標"], ["tag", "THEMES", "テーマ"],
          ["rot", "ROTATION", "資金の流れ"], ["opt", "OPTIONS", "オプション"], ["cand", "PIPELINE", `候補 ${nw}`],
          ["watch", "WATCH", `監視 ${watch.length}`]].map(([v, en, ja]) =>
          <button key={v} onClick={() => setView(v)} style={{ padding: "13px 18px", background: "none", border: "none",
            borderBottom: `2px solid ${view === v ? C.hot : "transparent"}`, marginBottom: -1, cursor: "pointer",
            color: view === v ? C.ink : C.dim, whiteSpace: "nowrap", transition: "color .12s" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".18em", opacity: .65 }}>{en}</div>
            <div style={{ fontSize: 13, fontWeight: view === v ? 700 : 400, marginTop: 2 }}>{ja}</div></button>)}
      </nav>
      {view === "now" && <Now {...{ bench, rank, moved, alerts, link, T, cands, day,
        oi: k => setSheet({ t: "i", k }), ot: k => setSheet({ t: "t", k }), oc: c => setSheet({ t: "c", k: c.code }) }} />}
      {view === "ind" && <Signals iL={iL} byInd={byInd} oi={k => setSheet({ t: "i", k })} />}
      {view === "tag" && <Themes T={T} ot={k => setSheet({ t: "t", k })} />}
      {view === "rot" && <Rotation ot={k => setSheet({ t: "t", k })} />}
      {view === "opt" && <Options />}
      {view === "cand" && <Pipe {...{ cands, T, patch, oc: c => setSheet({ t: "c", k: c.code }), mode: "all" }} />}
      {view === "watch" && <Pipe {...{ cands: watch, T, patch, oc: c => setSheet({ t: "c", k: c.code }), mode: "watch" }} />}
    </div>
    <Sheet open={!!sheet} onClose={() => setSheet(null)}
      title={sheet?.t === "sync" ? "判断の持ち出しと取り込み" : sheet?.t === "c" ? cands.find(x => x.code === sheet.k)?.name : sheet?.k}
      sub={sheet?.t === "sync" ? `${Object.keys(st).length} 件の判断を保存中`
        : sheet?.t === "i" ? `${byInd[sheet.k].length} OBS · LAST ${iL[sheet.k].d}`
        : sheet?.t === "t" ? `${T[sheet.k]?.n} STOCKS · ${T[sheet.k]?.s} SECTORS · RANK ${T[sheet.k]?.r}`
        : sheet?.t === "c" ? cands.find(x => x.code === sheet.k)?.code : ""}>
      {sheet?.t === "i" && <IDetail obs={byInd[sheet.k]} lk={link(sheet.k)} ot={k => setSheet({ t: "t", k })} />}
      {sheet?.t === "t" && <TDetail k={sheet.k} v={T[sheet.k]} cands={cands} oc={c => setSheet({ t: "c", k: c.code })} />}
      {sheet?.t === "c" && <CDetail c={cands.find(x => x.code === sheet.k)} T={T} patch={patch} ot={k => setSheet({ t: "t", k })} />}
      {sheet?.t === "sync" && <Sync st={st} setSt={setSt} setMsg={setMsg} />}
    </Sheet>
  </div>;
}
function Now({ bench, rank, moved, alerts, link, T, cands, day, oi, ot, oc }) {
  const fresh = cands.filter(c => c.found === day);
  const rows = [];
  alerts.forEach(([k, v]) => { const ts = link(k); if (!ts.length) return;
    ts.forEach(([n, d], i) => rows.push({ k, v, n, d, first: i === 0, span: ts.length })); });
  const KPI = ({ label, val, unit, sub, accent }) => <div style={{ flex: "1 1 220px", padding: "17px 19px",
    borderLeft: `1px solid ${C.rule}` }}>
    <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".16em", color: C.dim, marginBottom: 9 }}>{label}</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
      <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: accent || C.ink, lineHeight: 1 }}>{val}</span>
      {unit && <span style={{ fontSize: 11, color: C.mut }}>{unit}</span>}</div>
    {sub && <div style={{ fontSize: 11.5, color: C.mut, marginTop: 9, lineHeight: 1.7 }}>{sub}</div>}</div>;
  const nk = DATA.tags[day].nk;
  return <>
    <div style={{ display: "flex", flexWrap: "wrap", background: C.panel, border: `1px solid ${C.rule}`,
      borderLeft: "none", margin: "18px 0 6px" }}>
      {nk && nk.px && <KPI label="NIKKEI 225" val={nk.px.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        accent={col(nk.dpx)} sub={<>前日比 <span style={{ color: col(nk.dpx), fontFamily: MONO }}>{pct(nk.dpx)}</span></>} />}
      <KPI label="TOPIX MONTH" val={pct(bench.m)} accent={col(bench.m)}
        sub={<>週 <span style={{ color: col(bench.w), fontFamily: MONO }}>{pct(bench.w)}</span>　日 <span style={{ color: col(bench.d), fontFamily: MONO }}>{pct(bench.d)}</span></>} />
      <KPI label="INFLOW" val={pct(rank[0][1].m)} accent={C.up}
        sub={<span onClick={() => ot(rank[0][0])} style={{ cursor: "pointer", borderBottom: `1px dotted ${C.mut}` }}>{rank[0][0]}</span>} />
      <KPI label="OUTFLOW" val={pct(rank.at(-1)[1].m)} accent={C.dn}
        sub={<span onClick={() => ot(rank.at(-1)[0])} style={{ cursor: "pointer", borderBottom: `1px dotted ${C.mut}` }}>{rank.at(-1)[0]}</span>} />
      <KPI label="ALERTS" val={alerts.length} unit="本" accent={alerts.length > 12 ? C.hot : C.ink}
        sub={`未精査 ${cands.filter(c => c.status === "未精査").length} 件${fresh.length ? `　本日 ${fresh.length} 件` : ""}`} />
    </div>
    <H note="クリックで全観測とメモ。値動きの理由を追うときの起点。">SIGNALS ／ いま鳴っている</H>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {alerts.map(([k, v]) => <Tag key={k} j={v.j} onClick={() => oi(k)}>
        {k} <span style={{ fontFamily: MONO, fontWeight: 700 }}>{v.v == null ? "—" : v.v.toLocaleString()}</span></Tag>)}
    </div>
    <H note="指標が動いたとき、連なるテーマがもう動いているか、まだか。まだのものが仕込みどころの候補になる。">
      LINKAGE ／ 指標とテーマのつながり</H>
    <Table head={<><Th l>指標</Th><Th l>連なるテーマ</Th><Th>月間</Th><Th>中央値</Th><Th>順位</Th><Th l>規模</Th></>}>
      {rows.map((r, i) => <TR key={i}>
        {r.first && <td rowSpan={r.span} style={{ padding: "9px 11px", verticalAlign: "top",
          borderRight: `1px solid ${C.rule}` }}><Tag j={r.v.j} onClick={() => oi(r.k)}>{r.k}</Tag></td>}
        <td onClick={() => ot(r.n)} style={{ padding: "9px 11px", cursor: "pointer" }}>{r.n}</td>
        <Td v={r.d.m} /><Td v={r.d.md} />
        <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{r.d.r}</td>
        <td style={{ padding: "9px 11px", fontSize: 11.5, color: C.dim, fontFamily: MONO }}>{r.d.n}</td></TR>)}
    </Table>
    {moved.length > 0 && <>
      <H note="前営業日からの順位変動が8位以上。強いものが強いままでは出てこない。">ROTATION ／ 資金が動いた</H>
      <Table head={<><Th l>テーマ</Th><Th>変動</Th><Th>順位</Th><Th>月間</Th><Th>中央値</Th><Th l>主な銘柄</Th></>}>
        {moved.map(([k, v]) => <TR key={k} onClick={() => ot(k)}>
          <td style={{ padding: "9px 11px" }}><Dot k={v.kind} />{k}</td>
          <td style={{ padding: "9px 11px", textAlign: "right" }}><Mv v={v.mv} /></td>
          <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{v.pr}→{v.r}</td>
          <Td v={v.m} /><Td v={v.md} />
          <td style={{ padding: "9px 11px", fontSize: 11.5, color: C.dim }}>{(v.st || []).slice(0, 2).map(b => b[1]).join("、")}</td></TR>)}
      </Table></>}
    {fresh.length > 0 && <>
      <H>NEW ／ 本日みつけた候補</H>
      <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))" }}>
        {fresh.map((c, i) => <Card key={c.code + "-" + i} c={c} T={T} onClick={() => oc(c)} />)}</div></>}
  </>;
}
function Signals({ iL, byInd, oi }) {
  const [sub, setSub] = useState("list");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const META = DATA.indmeta || {};
  const CATS = ["all", ...Array.from(new Set(Object.values(META).map(m => m.cat)))];
  // マスタ全件を行にする（観測がないものは未取得として出す）
  const all = Object.keys(META).map(k => {
    const o = iL[k];
    return { k, ...META[k], ...(o || { j: META[k].j0, v: null, d: null }) };
  }).filter(r => (cat === "all" || r.cat === cat) && (!q || r.k.includes(q)));
  const rows = all.sort((a, b) => (SEV[b.j] ?? 0) - (SEV[a.j] ?? 0) || (a.cat || "").localeCompare(b.cat || ""));
  const nObs = Object.keys(iL).length;
  const Bar = () => <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
    <Seg opts={CATS.map(c => [c, c === "all" ? "すべて" : c])} val={cat} set={setCat} />
    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="指標名で絞る" type="search" />
    <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginLeft: "auto" }}>
      {rows.length} / {Object.keys(META).length}　観測あり {nObs}</span></div>;
  return <>
    <div style={{ display: "flex", borderBottom: `1px solid ${C.rule}`, margin: "18px 0 16px" }}>
      {[["list", "LIST", "一覧"], ["heat", "HEATMAP", "ヒートマップ"]].map(([v, en, ja]) =>
        <button key={v} onClick={() => setSub(v)} style={{ padding: "9px 16px", background: "none",
          border: "none", cursor: "pointer", borderBottom: `2px solid ${sub === v ? C.ink : "transparent"}`,
          marginBottom: -1, color: sub === v ? C.ink : C.dim }}>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: ".18em", opacity: .6 }}>{en}</div>
          <div style={{ fontSize: 12.5, fontWeight: sub === v ? 700 : 400, marginTop: 1 }}>{ja}</div></button>)}
    </div>
    {sub === "list" ? <>
      <H note="一度取り逃すと復元できない一次データ。zは変化率を過去分布で標準化した値で閾値は既定2.5。未取得はまだ取得ルートを組んでいないもの。">
        SIGNALS ／ 指標</H>
      <Bar />
      <Table head={<><Th l>指標</Th><Th l>状態</Th><Th l>カテゴリ</Th><Th l>頻度</Th><Th>値</Th>
        <Th>前日比</Th><Th>週間</Th><Th>月間</Th><Th>Z</Th><Th>水準</Th><Th l>観測日</Th></>}>
        {rows.map(r => <TR key={r.k} onClick={() => byInd[r.k] && oi(r.k)}>
          <td style={{ padding: "9px 11px", fontWeight: 500, color: byInd[r.k] ? C.ink : C.mut }}>{r.k}</td>
          <td style={{ padding: "9px 11px" }}><Tag j={r.j} /></td>
          <td style={{ padding: "9px 11px", fontSize: 11, color: C.dim }}>{r.cat}</td>
          <td style={{ padding: "9px 11px", fontSize: 11, color: C.dim }}>{r.freq}</td>
          <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5 }}>
            {r.v == null ? <span style={{ color: C.dim }}>—</span> : r.v.toLocaleString()}</td>
          <Td v={r.pd} /><Td v={r.w} /><Td v={r.m} />
          <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5,
            color: r.z != null && Math.abs(r.z) >= 2.5 ? C.hot : C.mut, fontWeight: r.z != null && Math.abs(r.z) >= 2.5 ? 700 : 400 }}>
            {r.z == null ? "—" : (r.z > 0 ? "+" : "") + r.z}</td>
          <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{r.p ?? "—"}</td>
          <td style={{ padding: "9px 11px", fontSize: 11, color: C.dim, fontFamily: MONO }}>{r.d || "—"}</td></TR>)}
      </Table></>
    : (() => {
      const days = Array.from(new Set(DATA.ind.map(r => r.d).filter(Boolean))).sort();
      const obs = {};
      DATA.ind.forEach(r => { (obs[r.k] = obs[r.k] || {})[r.d] = r; });
      return <>
        <H note="観測日ごとの前日比。緑が上げ、赤が下げ、枠だけの日は観測なし。朱の枠はアラート発火。指標名をクリックで全観測とメモ。">
          HEATMAP ／ 観測の履歴</H>
        <Bar />
        <div style={{ overflowX: "auto", border: `1px solid ${C.rule}`, background: C.panel }}>
          <table style={{ borderCollapse: "collapse", minWidth: 700 }}>
            <thead><tr>
              <th style={{ position: "sticky", left: 0, background: C.panel, zIndex: 3, textAlign: "left",
                minWidth: 210, padding: "7px 11px", fontFamily: MONO, fontSize: 9.5, color: C.dim,
                borderBottom: `1px solid ${C.rule}` }}>指標</th>
              {days.map(d => <th key={d} style={{ padding: "7px 3px", fontFamily: MONO, fontSize: 8.5,
                color: C.dim, textAlign: "center", borderBottom: `1px solid ${C.rule}` }}>{d.slice(5)}</th>)}
              <th style={{ padding: "7px 11px", fontFamily: MONO, fontSize: 9.5, color: C.dim,
                textAlign: "left", borderBottom: `1px solid ${C.rule}` }}>状態</th>
            </tr></thead>
            <tbody>{rows.map(r => <tr key={r.k}>
              <td onClick={() => byInd[r.k] && oi(r.k)} style={{ position: "sticky", left: 0, background: C.panel,
                zIndex: 1, padding: "5px 11px", fontSize: 12, cursor: byInd[r.k] ? "pointer" : "default",
                whiteSpace: "nowrap", color: byInd[r.k] ? C.ink : C.dim,
                borderRight: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}` }}>{r.k}</td>
              {days.map(d => { const o = obs[r.k]?.[d];
                const e = o ? o.pd : null, alert = o && SEV[o.j] >= 2;
                return <td key={d} style={{ padding: 0, borderBottom: `1px solid ${C.rule}` }}
                  title={o ? `${d}  ${o.v == null ? "取得失敗" : o.v.toLocaleString()}${e != null ? `  ${e > 0 ? "+" : ""}${e}%` : ""}  ${o.j}` : `${d}  観測なし`}>
                  <div style={{ width: 26, height: 21, margin: "1px auto",
                    background: o == null ? "transparent" : o.v == null ? "rgba(125,133,144,.14)" : HUE(e == null ? 0 : e * 2.5),
                    border: alert ? `1px solid ${C.hot}` : o == null ? `1px solid ${C.rule}` : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: MONO, fontSize: 8, color: C.dim }}>{o && o.v == null ? "×" : ""}</div></td>; })}
              <td style={{ padding: "5px 11px", borderBottom: `1px solid ${C.rule}` }}><Tag j={r.j} /></td>
            </tr>)}</tbody></table></div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: C.dim, marginTop: 12, alignItems: "center" }}>
          <span><span style={{ display: "inline-block", width: 20, height: 11, marginRight: 5,
            verticalAlign: "middle", background: HUE(-8) }} />下げ</span>
          <span><span style={{ display: "inline-block", width: 20, height: 11, marginRight: 5,
            verticalAlign: "middle", background: HUE(8) }} />上げ</span>
          <span><span style={{ display: "inline-block", width: 20, height: 11, marginRight: 5,
            verticalAlign: "middle", background: "rgba(125,133,144,.14)" }} />取得失敗</span>
          <span><span style={{ display: "inline-block", width: 20, height: 11, marginRight: 5,
            verticalAlign: "middle", border: `1px solid ${C.rule}` }} />観測なし</span>
          <span><span style={{ display: "inline-block", width: 20, height: 11, marginRight: 5,
            verticalAlign: "middle", border: `1px solid ${C.hot}` }} />アラート発火</span>
          <span style={{ marginLeft: "auto" }}>横が詰まっていない行は取得が途切れている</span></div>
      </>; })()}
  </>;
}
function IDetail({ obs, lk, ot }) {
  return <>
    <Spark obs={obs} />
    {lk.length > 0 && <div style={{ marginBottom: 16 }}>
      <Table head={<><Th l>連なるテーマ</Th><Th>月間</Th><Th>中央値</Th><Th>順位</Th></>}>
        {lk.map(([n, d]) => <TR key={n} onClick={() => ot(n)}>
          <td style={{ padding: "8px 11px" }}>{n}</td><Td v={d.m} /><Td v={d.md} />
          <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{d.r}</td></TR>)}
      </Table></div>}
    {[...obs].reverse().map((r, i) => {
      const nums = [["前日", r.pd], ["週", r.w], ["月", r.m]].filter(x => x[1] != null)
        .map(x => `${x[0]} ${x[1] > 0 ? "+" : ""}${x[1]}%`).join("  ");
      return <div key={i} style={{ borderLeft: `1px solid ${C.rule}`, paddingLeft: 15, paddingBottom: 15,
        marginLeft: 3, position: "relative" }}>
        <span style={{ position: "absolute", left: -4, top: 6, width: 7, height: 7, borderRadius: "50%",
          background: SEV[r.j] >= 2 ? C.hot : C.rule2 }} />
        <div style={{ fontSize: 11, color: C.dim, fontFamily: MONO }}>
          {r.d}　{r.j}{r.z != null && `　z=${r.z}`}{r.p != null && `　${r.p}%ile`}</div>
        <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, margin: "3px 0 5px", color: C.ink }}>
          {r.v == null ? "—" : r.v.toLocaleString()}
          <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 400, color: C.mut }}>{nums}</span></div>
        <div style={{ fontSize: 12, lineHeight: 1.8, color: C.mut, whiteSpace: "pre-wrap" }}>{r.memo}</div>
        {r.src && <a href={r.src} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: C.dim, fontFamily: MONO }}>{r.src}</a>}</div>;
    })}</>;
}
function Themes({ T, ot }) {
  const [kind, setKind] = useState("all"), [q, setQ] = useState(""), [thin, setThin] = useState(false);
  const [srt, setSrt] = useState({ k: "r", asc: true });
  const rows = Object.entries(T)
    .filter(([n, v]) => (kind === "all" || v.kind === kind) && (!q || n.includes(q)) && (!thin || v.n >= 5))
    .sort((a, b) => { const x = srt.k === "name" ? a[0] : a[1][srt.k], y = srt.k === "name" ? b[0] : b[1][srt.k];
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * (srt.asc ? 1 : -1); });
  const S = ({ k, l, children }) => <Th l={l}><span onClick={() => setSrt(s => ({ k, asc: s.k === k ? !s.asc : k === "r" }))}
    style={{ cursor: "pointer", color: srt.k === k ? C.ink : "inherit" }}>{children}{srt.k === k && (srt.asc ? " ↑" : " ↓")}</span></Th>;
  return <>
    <H note="対TOPIXの超過リターン。銘柄が10未満のテーマは符号すら当てにならない。平均と中央値が離れていたら中央値で見る。">
      THEMES ／ テーマ</H>
    <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginBottom: 13 }}>
      <Seg opts={[["all", "すべて"], ["テーマ", "横断テーマ"], ["ルール", "業種ベース"]]} val={kind} set={setKind} />
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="テーマ名で絞る" type="search" />
      <label style={{ fontSize: 11.5, color: C.mut, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={thin} onChange={e => setThin(e.target.checked)} />5銘柄未満を隠す</label>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginLeft: "auto" }}>{rows.length} / {Object.keys(T).length}</span>
    </div>
    <Table head={<><S k="r">#</S><S k="name" l>テーマ</S><S k="d">日次</S><S k="w">週間</S>
      <S k="m">月間</S><S k="md">中央値</S><S k="mv">変動</S><S k="n">銘柄</S><S k="s">業種</S></>}>
      {rows.map(([n, v]) => <TR key={n} onClick={() => ot(n)}>
        <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11, color: C.dim }}>{v.r}</td>
        <td style={{ padding: "9px 11px", fontWeight: 500 }}><Dot k={v.kind} />{n}</td>
        <Td v={v.d} /><Td v={v.w} /><Td v={v.m} /><Td v={v.md} />
        <td style={{ padding: "9px 11px", textAlign: "right" }}><Mv v={v.mv} /></td>
        <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{v.n}</td>
        <td style={{ padding: "9px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{v.s}</td></TR>)}
    </Table></>;
}
function TDetail({ k, v, cands, oc }) {
  if (!v) return null;
  const gap = Math.abs(v.m - v.md);
  const rel = cands.filter(c => (c.tags || []).includes(k));
  const HIST = DATA.hist, hs = HIST.summ[k], cu = HIST.cum[k], M = HIST.months;
  const Note = ({ color, children }) => <div style={{ background: `${color}14`, borderLeft: `2px solid ${color}`,
    padding: "10px 13px", fontSize: 11.5, lineHeight: 1.75, color: C.mut, marginBottom: 14 }}>{children}</div>;
  const st = v.st || [];
  const up = st.filter(b => b[3] > 0).length, dn = st.filter(b => b[3] < 0).length;
  return <>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 0, border: `1px solid ${C.rule}`,
      background: C.panel2, marginBottom: 16 }}>
      {[["日次", v.d], ["週間", v.w], ["月間", v.m], ["月間中央値", v.md]].map(([l, x], i) =>
        <div key={l} style={{ flex: "1 1 100px", padding: "12px 15px",
          borderLeft: i ? `1px solid ${C.rule}` : "none" }}>
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".14em", color: C.dim, marginBottom: 5 }}>{l}</div>
          <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 700, color: col(x) }}>{pct(x)}</div></div>)}
      {st.length > 0 && <div style={{ flex: "1 1 100px", padding: "12px 15px", borderLeft: `1px solid ${C.rule}` }}>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".14em", color: C.dim, marginBottom: 5 }}>本日の内訳</div>
        <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700 }}>
          <span style={{ color: C.up }}>{up}</span>
          <span style={{ color: C.dim, fontSize: 12 }}> 上 / </span>
          <span style={{ color: C.dn }}>{dn}</span>
          <span style={{ color: C.dim, fontSize: 12 }}> 下</span></div></div>}
    </div>
    {gap > 4 && <Note color={C.warm}>平均 <b style={{ color: col(v.m) }}>{pct(v.m)}</b> と中央値 <b style={{ color: col(v.md) }}>{pct(v.md)}</b> が {gap.toFixed(1)} ポイント離れている。少数の銘柄が平均を動かしているので中央値で見ること。</Note>}
    {rel.length > 0 && <Note color={C.cool}>このテーマの候補 {rel.length} 件：
      {rel.map(c => <span key={c.code} onClick={() => oc(c)}
        style={{ cursor: "pointer", borderBottom: `1px solid ${C.cool}`, marginRight: 10, color: C.cool }}>{c.name}</span>)}</Note>}
    {hs && cu && (() => {
      const W = 820, Hh = 128, pad = 42;
      const mn = Math.min(...cu, 0), mx = Math.max(...cu);
      const x = i => pad + i * (W - pad - 8) / (M.length - 1);
      const y = q => Hh - 20 - ((q - mn) / ((mx - mn) || 1)) * (Hh - 36);
      const last = cu.at(-1);
      return <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
          marginBottom: 7, flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".14em", color: C.dim }}>
            {M.length}か月の累積超過</span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.mut }}>
            通算 <b style={{ color: col(hs.tot) }}>{hs.tot > 0 ? "+" : ""}{hs.tot}%</b>
            勝率 <b style={{ color: hs.win >= 60 ? C.up : hs.win <= 40 ? C.dn : C.mut }}>{hs.win}%</b>
            σ {hs.sd}　最高 <span style={{ color: C.up }}>+{hs.max}</span>　最低 <span style={{ color: C.dn }}>{hs.min}</span></span>
        </div>
        <div style={{ background: C.panel2, border: `1px solid ${C.rule}`, padding: "8px 0 4px" }}>
          <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", height: Hh, display: "block" }}>
            <defs><linearGradient id={`hg${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={last >= 0 ? C.up : C.dn} stopOpacity=".2" />
              <stop offset="100%" stopColor={last >= 0 ? C.up : C.dn} stopOpacity="0" /></linearGradient></defs>
            <line x1={pad} y1={y(0)} x2={W - 8} y2={y(0)} stroke={C.rule2} strokeWidth="1" strokeDasharray="2 3" />
            <text x="4" y={y(0) + 3} fill={C.dim} fontSize="9" fontFamily={MONO}>0%</text>
            <path d={`M${x(0)},${y(0)} ` + cu.map((q, i) => `L${x(i)},${y(q)}`).join(" ") + ` L${x(cu.length - 1)},${y(0)}Z`}
              fill={`url(#hg${k})`} />
            <polyline points={cu.map((q, i) => `${x(i)},${y(q)}`).join(" ")} fill="none"
              stroke={last >= 0 ? C.up : C.dn} strokeWidth="1.6" />
            {M.map((m, i) => i % 6 === 0 && <text key={m} x={x(i)} y={Hh - 5} fill={C.dim} fontSize="8.5"
              fontFamily={MONO} textAnchor="middle">{m}</text>)}
          </svg></div>
        <div style={{ display: "flex", gap: 1, marginTop: 6 }}>
          {M.map(m => { const e = HIST.tags[k]?.[m]?.e;
            return <div key={m} title={`${m}  ${e == null ? "—" : (e > 0 ? "+" : "") + e + "%"}`}
              style={{ flex: 1, height: 11, background: HUE(e) }} />; })}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 9,
          color: C.dim, marginTop: 3 }}><span>{M[0]}</span><span>{M.at(-1)}</span></div>
      </div>; })()}
    {st.length > 0 ? <StockTable st={st} />
      : <p style={{ fontSize: 11.5, color: C.dim }}>この日付の構成銘柄は保持していない（直近10営業日のみ）。</p>}
  </>;
}
function Card({ c, T, onClick }) {
  const tags = (c.tags || []).filter(x => T[x]);
  const sc = c.status === "エントリー" ? C.up : c.status === "見送り" ? C.dim
    : c.status === "監視中" ? C.cool : c.status === "精査中" ? C.warm : C.mut;
  return <div onClick={onClick} style={{ background: C.panel, border: `1px solid ${C.rule}`, padding: "14px 16px",
    cursor: "pointer", borderLeft: `2px solid ${sc}`, transition: "border-color .12s" }}
    onMouseEnter={e => e.currentTarget.style.borderColor = C.rule2}
    onMouseLeave={e => { e.currentTarget.style.borderColor = C.rule; e.currentTarget.style.borderLeftColor = sc; }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 9, marginBottom: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 14.5 }}>{c.name}{c.flag && <span style={{ color: C.warm, marginLeft: 6 }}>★</span>}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{c.code}</span></div>
    <div style={{ fontSize: 10.5, color: sc, fontFamily: MONO, letterSpacing: ".08em", marginBottom: 7 }}>
      {c.status}{c.track && ` · ${c.track}`}{c.cdate && ` · ${c.cdate}`}</div>
    <div style={{ fontSize: 12.5, lineHeight: 1.75, color: C.mut }}>{c.catalyst}</div>
    {c.memo && <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.rule}`, fontSize: 11.5,
      lineHeight: 1.75, color: C.ink, whiteSpace: "pre-wrap" }}>{c.memo}</div>}
    {tags.length > 0 && <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.rule}`,
      display: "flex", gap: 5, flexWrap: "wrap" }}>
      {tags.map(x => { const m = T[x].m;
        return <span key={x} style={{ fontSize: 10.5, padding: "2px 7px", fontFamily: MONO,
          background: m > 2 ? "rgba(0,214,143,.12)" : m < -2 ? "rgba(255,77,94,.12)" : "rgba(125,133,144,.1)",
          color: m > 2 ? C.up : m < -2 ? C.dn : C.mut }}>{x} {pct(m, 1)}</span>; })}</div>}</div>;
}
function Pipe({ cands, T, patch, oc, mode }) {
  const [s, setS] = useState(mode === "watch" ? "all" : "未精査"), [q, setQ] = useState("");
  const r = cands.filter(c => (s === "all" || c.status === s) &&
    (!q || (c.name || "").includes(q) || (c.catalyst || "").includes(q) || (c.code || "").includes(q)));
  return <>
    <H note={mode === "watch" ? "監視中と★を付けたもの。カタリスト日が近いものから片付ける。"
      : "スイープが拾ったカタリスト候補。カードを開くとステータスを進められる。"}>
      {mode === "watch" ? "WATCH ／ 監視中" : "PIPELINE ／ 候補"}</H>
    <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginBottom: 15 }}>
      <Seg opts={[["all", "すべて"], ...FLOW.map(f => [f, `${f} ${cands.filter(c => c.status === f).length}`])]} val={s} set={setS} />
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="銘柄・カタリストで絞る" type="search" />
    </div>
    {r.length === 0 ? <p style={{ color: C.dim, fontSize: 12.5, padding: "30px 0" }}>該当なし。</p> :
      <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))" }}>
        {r.map((c, i) => <Card key={c.code + "-" + i} c={c} T={T} onClick={() => oc(c)} />)}</div>}</>;
}
function CDetail({ c, T, patch, ot }) {
  const [memo, setMemo] = useState(c.memo || "");
  const tags = (c.tags || []).filter(x => T[x]);
  const nx = NEXT[c.status];
  return <>
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 16,
      paddingBottom: 16, borderBottom: `1px solid ${C.rule}` }}>
      {FLOW.map(f => <Btn key={f} on={c.status === f} onClick={() => patch(c.code, { status: f })}
        accent={f === "エントリー" ? C.up : f === "見送り" ? C.dim : undefined}>{f}</Btn>)}
      <div style={{ marginLeft: "auto" }}>
        <Btn on={c.flag} accent={C.warm} onClick={() => patch(c.code, { flag: !c.flag })}>★ {c.flag ? "外す" : "付ける"}</Btn></div>
    </div>
    {nx && <div style={{ background: C.panel2, border: `1px solid ${C.rule2}`, padding: "13px 16px", marginBottom: 16,
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: C.mut }}>次は <b style={{ color: C.ink }}>{nx}</b> へ</span>
      <button onClick={() => patch(c.code, { status: nx })} style={{ padding: "7px 17px", fontSize: 11.5,
        background: C.hot, color: C.bg, border: "none", cursor: "pointer", fontWeight: 700, fontFamily: SANS }}>
        {nx}に進める</button></div>}
    <div style={{ marginBottom: 16, fontSize: 12.5 }}>
      {[["カタリスト", c.catalyst], ["想定時期", c.timing], ["カタリスト日", c.cdate],
        ["経路", c.track ? `${c.track}${c.type ? ` · ${c.type}` : ""}` : null],
        ["ソース", c.src ? <a href={c.src} target="_blank" rel="noreferrer" style={{ color: C.cool }}>{c.src}</a> : null],
        ["最終更新", c.at]]
        .filter(x => x[1]).map(([k, v]) => <div key={k} style={{ display: "flex", gap: 14, padding: "6px 0" }}>
          <span style={{ width: 86, flexShrink: 0, fontSize: 10.5, color: C.dim, fontFamily: MONO,
            letterSpacing: ".06em", paddingTop: 2 }}>{k}</span>
          <span style={{ lineHeight: 1.75, color: C.mut, wordBreak: "break-all" }}>{v}</span></div>)}
    </div>
    {tags.length > 0 && <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".14em", color: C.dim, marginBottom: 8 }}>THEME CONTEXT</div>
      <Table head={<><Th l>所属テーマ</Th><Th>月間</Th><Th>中央値</Th><Th>順位</Th></>}>
        {tags.map(x => <TR key={x} onClick={() => ot(x)}>
          <td style={{ padding: "8px 11px" }}>{x}</td><Td v={T[x].m} /><Td v={T[x].md} />
          <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{T[x].r}</td></TR>)}
      </Table>
      <p style={{ fontSize: 11, color: C.dim, marginTop: 7, lineHeight: 1.7 }}>
        テーマごと強いなら流れに乗っている。テーマが弱いのに単独で拾われたなら理由を確かめる。</p></div>}
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".14em", color: C.dim, marginBottom: 8 }}>MEMO</div>
      <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={5}
        placeholder="なぜ進めるのか、なぜ見送るのか。次に見返したときに判断の根拠がわかるように。"
        style={{ width: "100%", background: C.panel2, border: `1px solid ${C.rule2}`, color: C.ink,
          padding: 12, fontSize: 12.5, lineHeight: 1.8, fontFamily: SANS, resize: "vertical", outline: "none" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        <button onClick={() => patch(c.code, { memo })} style={{ padding: "7px 17px", fontSize: 11.5,
          background: C.ink, color: C.bg, border: "none", cursor: "pointer", fontFamily: SANS }}>メモを保存</button>
        {c.memo && memo !== c.memo && <Btn onClick={() => setMemo(c.memo)}>元に戻す</Btn>}</div></div>
  </>;
}
function StockTable({ st }) {
  const [srt, setSrt] = useState({ i: 5, asc: false });
  const rows = [...st].sort((a, b) => {
    const x = a[srt.i], y = b[srt.i];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * (srt.asc ? 1 : -1);
  });
  const S = ({ i, l, children }) => <Th l={l}>
    <span onClick={() => setSrt(s => ({ i, asc: s.i === i ? !s.asc : false }))}
      style={{ cursor: "pointer", color: srt.i === i ? C.ink : "inherit" }}>
      {children}{srt.i === i && (srt.asc ? " ↑" : " ↓")}</span></Th>;
  return <Table head={<><S i={0} l>コード</S><S i={1} l>銘柄</S><S i={2} l>33業種</S>
    <S i={3}>日次</S><S i={4}>週間</S><S i={5}>月間</S></>}>
    {rows.map(b => <TR key={b[0]}>
      <td style={{ padding: "8px 11px", fontFamily: MONO, fontSize: 11.5, color: C.dim }}>{b[0]}</td>
      <td style={{ padding: "8px 11px" }}>{b[1]}</td>
      <td style={{ padding: "8px 11px", fontSize: 11, color: C.dim }}>{b[2]}</td>
      <Td v={b[3]} d={1} /><Td v={b[4]} d={1} /><Td v={b[5]} d={1} /></TR>)}
  </Table>;
}
// ═══════ ROTATION ═══════
function Rotation({ ot }) {
  const HIST = DATA.hist, M = HIST.months;
  const [sub, setSub] = useState("heat");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState(24);
  const [srt, setSrt] = useState({ k: "tot", asc: false });
  const rows = Object.entries(HIST.summ)
    .filter(([t, v]) => (kind === "all" || v.kind === kind) && (!q || t.includes(q)));
  const ms = M.slice(-range);
  const Bar = () => <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
    <Seg opts={[["all", "すべて"], ["テーマ", "横断テーマ"], ["ルール", "業種ベース"]]} val={kind} set={setKind} />
    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="テーマ名で絞る" type="search" />
    <Seg opts={[[12, "1年"], [24, "2年"], [99, "全期間"]]} val={range} set={setRange} />
    <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginLeft: "auto" }}>
      {M[0]} — {M.at(-1)} · {M.length}か月</span>
  </div>;
  const SUBS = [["heat", "HEATMAP", "ヒートマップ"], ["lead", "LEADERS", "月ごとの主役"],
    ["cum", "CUMULATIVE", "累積"], ["rank", "RANKING", "通算成績"]];
  return <>
    <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.rule}`, margin: "18px 0 16px", overflowX: "auto" }}>
      {SUBS.map(([v, en, ja]) => <button key={v} onClick={() => setSub(v)}
        style={{ padding: "9px 16px", background: "none", border: "none", cursor: "pointer",
          borderBottom: `2px solid ${sub === v ? C.ink : "transparent"}`, marginBottom: -1,
          color: sub === v ? C.ink : C.dim, whiteSpace: "nowrap" }}>
        <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: ".18em", opacity: .6 }}>{en}</div>
        <div style={{ fontSize: 12.5, fontWeight: sub === v ? 700 : 400, marginTop: 1 }}>{ja}</div></button>)}
    </div>
    {sub === "heat" && <>
      <H note="緑が強い月、赤が弱い月。濃さは対ユニバース平均の超過リターン。テーマ名をクリックで推移。">
        HEATMAP ／ 月ごとの超過リターン</H>
      <Bar />
      <div style={{ overflowX: "auto", border: `1px solid ${C.rule}`, background: C.panel }}>
        <table style={{ borderCollapse: "collapse", minWidth: 1080 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, background: C.panel, zIndex: 3, textAlign: "left",
              minWidth: 174, padding: "7px 11px", fontFamily: MONO, fontSize: 9.5, color: C.dim,
              borderBottom: `1px solid ${C.rule}` }}>テーマ</th>
            {ms.map(m => <th key={m} style={{ padding: "7px 2px", fontFamily: MONO, fontSize: 8.5,
              color: C.dim, textAlign: "center", borderBottom: `1px solid ${C.rule}` }}>
              {m.slice(5, 7) === "01" ? m.slice(2, 4) + "'" : ""}{m.slice(5)}</th>)}
          </tr></thead>
          <tbody>{rows.sort((a, b) => b[1].tot - a[1].tot).map(([t, v]) => <tr key={t}>
            <td onClick={() => ot(t)} style={{ position: "sticky", left: 0, background: C.panel, zIndex: 1,
              padding: "5px 11px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
              borderRight: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}` }}>
              <Dot k={v.kind} />{t}</td>
            {ms.map(m => { const d = HIST.tags[t]?.[m], e = d ? d.e : null;
              return <td key={m} style={{ padding: 0, borderBottom: `1px solid ${C.rule}` }}
                title={`${m}  ${e == null ? "—" : (e > 0 ? "+" : "") + e + "%"}`}>
                <div style={{ width: 30, height: 23, margin: "1px auto", background: HUE(e), display: "flex",
                  alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 9, fontWeight: 500,
                  color: Math.abs(e || 0) > 9 ? "#0a0b0d" : C.mut }}>
                  {e != null && Math.abs(e) >= 10 ? e.toFixed(0) : ""}</div></td>; })}
          </tr>)}</tbody></table></div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: C.dim, marginTop: 12, alignItems: "center" }}>
        {[[-15, "-15%以下"], [-6, "-6%"], [0, "0"], [6, "+6%"], [15, "+15%以上"]].map(([v, l]) =>
          <span key={l}><span style={{ display: "inline-block", width: 22, height: 11, marginRight: 5,
            verticalAlign: "middle", background: HUE(v), border: v === 0 ? `1px solid ${C.rule2}` : "none" }} />{l}</span>)}
        <span style={{ marginLeft: "auto" }}>数字は絶対値10%以上の月のみ</span></div>
    </>}
    {sub === "lead" && <>
      <H note="各月で最も買われた5テーマと売られた3テーマ。同じテーマが何か月も左に居続けるなら本物のトレンド。">
        LEADERS ／ 月ごとの主役</H>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {[...ms].reverse().map(m => { const L = HIST.lead[m]; if (!L) return null;
          return <div key={m} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 58, fontFamily: MONO, fontSize: 10.5, color: C.dim, flexShrink: 0 }}>{m}</span>
            <div style={{ flex: 1, display: "flex", gap: 2, overflow: "hidden" }}>
              {L.top.slice(0, 5).map(([t, e]) => <span key={t} onClick={() => ot(t)}
                style={{ padding: "4px 9px", fontSize: 11, whiteSpace: "nowrap", cursor: "pointer",
                  background: HUE(e), color: e > 6 ? "#0a0b0d" : C.ink, flexShrink: 0 }}>
                {t} {e > 0 ? "+" : ""}{e.toFixed(0)}</span>)}
              <span style={{ flex: 1 }} />
              {L.bot.slice(0, 3).reverse().map(([t, e]) => <span key={t} onClick={() => ot(t)}
                style={{ padding: "4px 9px", fontSize: 11, whiteSpace: "nowrap", cursor: "pointer",
                  background: HUE(e), color: e < -6 ? "#0a0b0d" : C.ink, flexShrink: 0 }}>
                {t} {e.toFixed(0)}</span>)}
            </div></div>; })}
      </div></>}
    {sub === "cum" && (() => {
      const rs = rows.sort((a, b) => b[1].tot - a[1].tot).slice(0, 14);
      const W = 1000, Hh = 380, pad = 46;
      const all = rs.flatMap(([t]) => HIST.cum[t]);
      const mn = Math.min(...all, 0), mx = Math.max(...all);
      const x = i => pad + i * (W - pad - 8) / (M.length - 1);
      const y = v => Hh - 24 - ((v - mn) / ((mx - mn) || 1)) * (Hh - 46);
      const cols = ["#00d68f", "#ff6b35", "#4d9fff", "#ffb020", "#ff4d5e", "#a78bfa", "#22d3ee",
        "#f472b6", "#84cc16", "#fb923c", "#60a5fa", "#e879f9", "#2dd4bf", "#facc15"];
      return <>
        <H note="月次超過を積み上げたもの。傾きが立っている期間がそのテーマに資金が入っていた時期。">
          CUMULATIVE ／ 累積の超過リターン</H>
        <Bar />
        <div style={{ background: C.panel, border: `1px solid ${C.rule}`, padding: 12 }}>
          <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", height: Hh }}>
            {[0, .25, .5, .75, 1].map(p => { const v = mn + (mx - mn) * p;
              return <g key={p}><line x1={pad} y1={y(v)} x2={W - 8} y2={y(v)} stroke={C.rule} strokeWidth="1" />
                <text x="4" y={y(v) + 3} fill={C.dim} fontSize="9" fontFamily={MONO}>
                  {v > 0 ? "+" : ""}{v.toFixed(0)}%</text></g>; })}
            {M.map((m, i) => i % 6 === 0 && <text key={m} x={x(i)} y={Hh - 8} fill={C.dim} fontSize="8.5"
              fontFamily={MONO} textAnchor="middle">{m}</text>)}
            {rs.map(([t], j) => <polyline key={t} points={HIST.cum[t].map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none" stroke={cols[j % cols.length]} strokeWidth="1.6" opacity=".92" />)}
          </svg></div>
        <div style={{ display: "flex", gap: 13, flexWrap: "wrap", marginTop: 12, fontSize: 11.5 }}>
          {rs.map(([t, v], j) => <span key={t} onClick={() => ot(t)}
            style={{ color: cols[j % cols.length], cursor: "pointer" }}>
            ■ {t} <span style={{ fontFamily: MONO }}>{v.tot > 0 ? "+" : ""}{v.tot.toFixed(0)}%</span></span>)}</div>
      </>; })()}
    {sub === "rank" && (() => {
      const rs = rows.sort((a, b) => { const x = srt.k === "name" ? a[0] : a[1][srt.k],
        y = srt.k === "name" ? b[0] : b[1][srt.k];
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * (srt.asc ? 1 : -1); });
      const S = ({ k, l, children }) => <Th l={l}><span onClick={() => setSrt(s => ({ k, asc: s.k === k ? !s.asc : false }))}
        style={{ cursor: "pointer", color: srt.k === k ? C.ink : "inherit" }}>{children}{srt.k === k && (srt.asc ? " ↑" : " ↓")}</span></Th>;
      return <>
        <H note={`${M.length}か月の通算。勝率は超過がプラスだった月の割合。σは月次超過のばらつきで、大きいほど乱高下している。`}>
          RANKING ／ 通算成績</H>
        <Bar />
        <Table head={<><S k="name" l>テーマ</S><S k="tot">通算</S><S k="avg">月平均</S><S k="win">勝率</S>
          <S k="sd">σ</S><S k="max">最高月</S><S k="min">最低月</S><S k="sz">銘柄</S></>}>
          {rs.map(([t, v]) => <TR key={t} onClick={() => ot(t)}>
            <td style={{ padding: "8px 11px" }}><Dot k={v.kind} />{t}</td>
            <Td v={v.tot} d={0} /><Td v={v.avg} />
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5,
              color: v.win >= 60 ? C.up : v.win <= 40 ? C.dn : C.mut }}>{v.win}%</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>{v.sd.toFixed(1)}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.up }}>+{v.max.toFixed(0)}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.dn }}>{v.min.toFixed(0)}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.dim }}>{v.sz}</td></TR>)}
        </Table></>; })()}
    <p style={{ marginTop: 26, paddingTop: 14, borderTop: `1px solid ${C.rule}`, fontSize: 11.5,
      color: C.dim, lineHeight: 1.85, maxWidth: "80ch" }}>
      対ユニバース平均（TOPIX構成の等ウェイト）の超過リターン。月末営業日の終値どうしで月次を計算し、累積は月次超過の単純合計。<b style={{ color: C.mut }}>テーマの構成銘柄は現在の定義</b>で、過去にさかのぼって同じ銘柄で計算している。当時上場していなかった銘柄は自動的に除外されるが、今そのテーマに属している企業だけを見ているという偏りは残る。バックテストではなく観察用。</p>
  </>;
}
// ═══════ 判断の持ち出しと取り込み ═══════
function Sync({ st, setSt, setMsg }) {
  const [txt, setTxt] = useState("");
  const [tab, setTab] = useState("out");
  const json = JSON.stringify(st, null, 1);
  const n = Object.keys(st).length;
  const copy = () => {
    const done = ok => { setMsg(ok ? "COPIED" : "FAILED"); setTimeout(() => setMsg(""), 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(json).then(() => done(true), () => done(false));
    else { const ta = document.createElement("textarea"); ta.value = json; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(true); } catch { done(false); } document.body.removeChild(ta); }
  };
  const imp = () => {
    try {
      const o = JSON.parse(txt);
      if (typeof o !== "object" || Array.isArray(o)) throw new Error();
      const merged = { ...st, ...o };
      setSt(merged); save(merged).then(ok => { setMsg(ok ? "IMPORTED" : "FAILED"); setTimeout(() => setMsg(""), 1800); });
      setTxt("");
    } catch { setMsg("BAD JSON"); setTimeout(() => setMsg(""), 2200); }
  };
  return <>
    <div style={{ background: `${C.cool}14`, borderLeft: `2px solid ${C.cool}`, padding: "11px 14px",
      fontSize: 12, lineHeight: 1.8, color: C.mut, marginBottom: 16 }}>
      ステータス・メモ・★はこのブラウザに保存され、URLが同じなので毎日の更新後も引き継がれる。
      <b style={{ color: C.ink }}>別のブラウザや端末に移すとき、またはバックアップを取るときにここを使う。</b>
    </div>
    <div style={{ display: "flex", gap: 0, marginBottom: 14 }}>
      <Seg opts={[["out", "持ち出す"], ["in", "取り込む"]]} val={tab} set={setTab} />
    </div>
    {tab === "out" ? <>
      <p style={{ fontSize: 12, color: C.mut, marginBottom: 10, lineHeight: 1.75 }}>
        いま保存されている <b style={{ color: C.ink }}>{n} 件</b> の判断。コピーして別の端末に貼る。</p>
      <textarea readOnly value={json} rows={12} onClick={e => e.target.select()}
        style={{ width: "100%", background: C.panel2, border: `1px solid ${C.rule2}`, color: C.mut,
          padding: 12, fontSize: 11, lineHeight: 1.6, fontFamily: MONO, resize: "vertical", outline: "none" }} />
      <button onClick={copy} disabled={!n} style={{ marginTop: 10, padding: "8px 18px", fontSize: 12,
        background: n ? C.hot : C.rule, color: n ? C.bg : C.dim, border: "none",
        cursor: n ? "pointer" : "default", fontWeight: 700, fontFamily: SANS }}>
        {n ? "コピーする" : "保存された判断がない"}</button>
    </> : <>
      <p style={{ fontSize: 12, color: C.mut, marginBottom: 10, lineHeight: 1.75 }}>
        持ち出したJSONを貼る。<b style={{ color: C.ink }}>同じ銘柄は貼ったほうで上書き</b>、それ以外は残る。</p>
      <textarea value={txt} onChange={e => setTxt(e.target.value)} rows={12}
        placeholder='{"8035":{"status":"精査中","memo":"…","flag":true,"at":"2026-09-03 16:20"}}'
        style={{ width: "100%", background: C.panel2, border: `1px solid ${C.rule2}`, color: C.ink,
          padding: 12, fontSize: 11, lineHeight: 1.6, fontFamily: MONO, resize: "vertical", outline: "none" }} />
      <button onClick={imp} disabled={!txt.trim()} style={{ marginTop: 10, padding: "8px 18px", fontSize: 12,
        background: txt.trim() ? C.ink : C.rule, color: txt.trim() ? C.bg : C.dim, border: "none",
        cursor: txt.trim() ? "pointer" : "default", fontWeight: 700, fontFamily: SANS }}>取り込む</button>
    </>}
  </>;
}
// ═══════ OPTIONS ═══════
function Options() {
  const O = DATA.opt; if (!O || !O.series.length) return <p style={{ color: C.dim, padding: 30 }}>オプションデータなし。</p>;
  const S = O.series, last = S.at(-1);
  const [day, setDay] = useState(O.days.at(-1));
  const det = O.detail[day];
  const cur = S.find(x => x.d === day) || last;
  const KPI2 = ({ l, v, sub, accent, i }) => <div style={{ flex: "1 1 180px", padding: "15px 18px",
    borderLeft: i ? `1px solid ${C.rule}` : "none" }}>
    <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".15em", color: C.dim, marginBottom: 7 }}>{l}</div>
    <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: accent || C.ink, lineHeight: 1 }}>{v}</div>
    {sub && <div style={{ fontSize: 11, color: C.mut, marginTop: 7, lineHeight: 1.6 }}>{sub}</div>}</div>;
  // 建玉の壁（行使価格別）: strikes = [行使価格, コール建玉, プット建玉, コール出来高, プット出来高, コール増減, プット増減]
  const mx = Math.max(...det.strikes.map(r => Math.max(r[1], r[2])), 1);
  const near = det.strikes.filter(r => Math.abs(r[0] - det.px) < 9000).sort((a, b) => b[0] - a[0]);
  // 建玉増減の大きい行使価格
  const moved = det.strikes.filter(r => r.length > 5).map(r => ({ k: r[0], dc: r[5], dp: r[6], c: r[1], p: r[2] }))
    .filter(r => Math.abs(r.dc) + Math.abs(r.dp) >= 100)
    .sort((a, b) => (Math.abs(b.dc) + Math.abs(b.dp)) - (Math.abs(a.dc) + Math.abs(a.dp))).slice(0, 14);
  const W = 900, Hh = 150, pad = 44;
  const ois = S.map(x => x.oi), omn = Math.min(...ois), omx = Math.max(...ois);
  const x = i => pad + i * (W - pad - 10) / Math.max(1, S.length - 1);
  const y = v => Hh - 24 - ((v - omn) / ((omx - omn) || 1)) * (Hh - 44);
  return <>
    <div style={{ display: "flex", flexWrap: "wrap", background: C.panel, border: `1px solid ${C.rule}`,
      borderLeft: "none", margin: "18px 0 6px" }}>
      <KPI2 l="NIKKEI 225" v={cur.px ? cur.px.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
        accent={col(cur.dpx)} sub={<>前日比 <span style={{ color: col(cur.dpx), fontFamily: MONO }}>{pct(cur.dpx)}</span></>} />
      <KPI2 i l="建玉合計" v={cur.oi.toLocaleString()} accent={cur.doi > 0 ? C.up : cur.doi < 0 ? C.dn : C.ink}
        sub={cur.doi != null ? <>前日比 <span style={{ color: cur.doi > 0 ? C.up : C.dn, fontFamily: MONO }}>
          {cur.doi > 0 ? "+" : ""}{cur.doi.toLocaleString()}</span></> : null} />
      <KPI2 i l="出来高" v={cur.vo.toLocaleString()} sub={`期近 ${cur.nvo.toLocaleString()}`} />
      <KPI2 i l="PUT/CALL 建玉" v={cur.pcr_oi ?? "—"}
        accent={cur.pcr_oi > 2.2 ? C.dn : cur.pcr_oi < 1.5 ? C.up : C.ink}
        sub={<>出来高ベース <span style={{ fontFamily: MONO }}>{cur.pcr_vo ?? "—"}</span></>} />
      <KPI2 i l="ATM IV" v={cur.iv != null ? cur.iv + "%" : "—"}
        accent={cur.iv > 30 ? C.hot : C.ink} sub={`期近 ${cur.near}`} />
    </div>
    <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", margin: "16px 0 4px" }}>
      <Seg opts={O.days.map(d => [d, d.slice(5)])} val={day} set={setDay} />
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginLeft: "auto" }}>
        期近 {det.cms[0]}{det.cms[1] ? ` + 次限月 ${det.cms[1]}` : ""}</span></div>
    <H note="建玉が積み上がっている行使価格は、そこで需給が厚いことを意味する。上に厚ければ上値の重し、下に厚ければ下値の支え。">
      OPEN INTEREST ／ 建玉の壁</H>
    <div style={{ border: `1px solid ${C.rule}`, background: C.panel, padding: "12px 14px" }}>
      {near.map(r => { const atm = Math.abs(r[0] - det.px) < 500;
        return <div key={r[0]} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2,
          background: atm ? "rgba(255,107,53,.08)" : "transparent", padding: "1px 0" }}>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: `${r[2] / mx * 100}%`, height: 13, background: C.dn, opacity: .78 }} />
          </div>
          <span style={{ width: 62, textAlign: "center", fontFamily: MONO, fontSize: 11,
            color: atm ? C.hot : C.mut, fontWeight: atm ? 700 : 400 }}>{r[0].toLocaleString()}</span>
          <div style={{ flex: 1, display: "flex" }}>
            <div style={{ width: `${r[1] / mx * 100}%`, height: 13, background: C.up, opacity: .78 }} /></div>
        </div>; })}
      <div style={{ display: "flex", gap: 8, marginTop: 10, fontFamily: MONO, fontSize: 10, color: C.dim }}>
        <span style={{ flex: 1, textAlign: "right", color: C.dn }}>◀ PUT 建玉</span>
        <span style={{ width: 62, textAlign: "center" }}>行使価格</span>
        <span style={{ flex: 1, color: C.up }}>CALL 建玉 ▶</span></div>
    </div>
    {moved.length > 0 && <>
      <H note="前日からの建玉増減。増えた行使価格に新しいポジションが立っている。">
        FLOW ／ 建玉が動いた行使価格</H>
      <Table head={<><Th l>行使価格</Th><Th>コール建玉</Th><Th>増減</Th><Th>プット建玉</Th><Th>増減</Th><Th l>原資産との差</Th></>}>
        {moved.map(r => { const gap = r.k - det.px;
          return <TR key={r.k}>
            <td style={{ padding: "8px 11px", fontFamily: MONO, fontSize: 12.5,
              color: Math.abs(gap) < 500 ? C.hot : C.ink }}>{r.k.toLocaleString()}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>
              {r.c.toLocaleString()}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5,
              color: r.dc > 0 ? C.up : r.dc < 0 ? C.dn : C.dim }}>{r.dc > 0 ? "+" : ""}{r.dc.toLocaleString()}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>
              {r.p.toLocaleString()}</td>
            <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5,
              color: r.dp > 0 ? C.up : r.dp < 0 ? C.dn : C.dim }}>{r.dp > 0 ? "+" : ""}{r.dp.toLocaleString()}</td>
            <td style={{ padding: "8px 11px", fontFamily: MONO, fontSize: 11.5,
              color: gap > 0 ? C.mut : C.dim }}>{gap > 0 ? "+" : ""}{Math.round(gap).toLocaleString()}</td></TR>; })}
      </Table></>}
    <H note="建玉が増え続けているならポジションが積み上がっている。SQに向けて減るのが通常なので、増えているのは新規の建ち。">
      TREND ／ 建玉と日経の推移</H>
    <div style={{ background: C.panel, border: `1px solid ${C.rule}`, padding: 12 }}>
      <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", height: Hh }}>
        <defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.cool} stopOpacity=".22" />
          <stop offset="100%" stopColor={C.cool} stopOpacity="0" /></linearGradient></defs>
        <path d={`M${x(0)},${Hh - 24} ` + S.map((s, i) => `L${x(i)},${y(s.oi)}`).join(" ") + ` L${x(S.length - 1)},${Hh - 24}Z`}
          fill="url(#og)" />
        <polyline points={S.map((s, i) => `${x(i)},${y(s.oi)}`).join(" ")} fill="none" stroke={C.cool} strokeWidth="1.7" />
        {S.map((s, i) => <g key={s.d}>
          <circle cx={x(i)} cy={y(s.oi)} r="3" fill={s.d === day ? C.hot : C.cool} />
          <text x={x(i)} y={Hh - 8} fill={s.d === day ? C.ink : C.dim} fontSize="9" fontFamily={MONO}
            textAnchor="middle">{s.d.slice(5)}</text></g>)}
        <text x="4" y={y(omx) + 3} fill={C.dim} fontSize="9" fontFamily={MONO}>{(omx / 1000).toFixed(0)}k</text>
        <text x="4" y={y(omn) + 3} fill={C.dim} fontSize="9" fontFamily={MONO}>{(omn / 1000).toFixed(0)}k</text>
      </svg></div>
    <Table head={<><Th l>日付</Th><Th>日経225</Th><Th>前日比</Th><Th>建玉</Th><Th>増減</Th><Th>出来高</Th>
      <Th>P/C建玉</Th><Th>P/C出来高</Th><Th>ATM IV</Th></>}>
      {[...S].reverse().map(s => <TR key={s.d}>
        <td style={{ padding: "8px 11px", fontFamily: MONO, fontSize: 12, color: s.d === day ? C.hot : C.ink }}>{s.d}</td>
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5 }}>
          {s.px ? s.px.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</td>
        <Td v={s.dpx} />
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>
          {s.oi.toLocaleString()}</td>
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5,
          color: s.doi > 0 ? C.up : s.doi < 0 ? C.dn : C.dim }}>
          {s.doi == null ? "—" : (s.doi > 0 ? "+" : "") + s.doi.toLocaleString()}</td>
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>
          {s.vo.toLocaleString()}</td>
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>{s.pcr_oi ?? "—"}</td>
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5, color: C.mut }}>{s.pcr_vo ?? "—"}</td>
        <td style={{ padding: "8px 11px", textAlign: "right", fontFamily: MONO, fontSize: 12.5,
          color: s.iv > 30 ? C.hot : C.mut }}>{s.iv != null ? s.iv + "%" : "—"}</td></TR>)}
    </Table>
    <p style={{ marginTop: 26, paddingTop: 14, borderTop: `1px solid ${C.rule}`, fontSize: 11.5,
      color: C.dim, lineHeight: 1.85, maxWidth: "80ch" }}>
      日経225オプション（J-Quants derivatives/bars/daily/options/225）。日経平均はオプションの原資産価格（UnderPx）から取っている。
      <b style={{ color: C.mut }}>J-Quantsは日経225指数そのものを配信していない</b>ため、この経路を使っている。<br />
      PUT/CALL建玉レシオは全限月の合計。日経225オプションは深いOTMのプットに建玉が積み上がる構造なので常に1を大きく超える。水準そのものより変化を見ること。ATM IVは期近で原資産に近い6本の平均。
    </p></>;
}
// ═══════ 起動 ═══════
(async () => {
  const root = document.getElementById("root");
  try {
    const r = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("data.json " + r.status);
    DATA = await r.json();
    createRoot(root).render(<App />);
  } catch (e) {
    root.innerHTML = `<div style="padding:40px;font-family:${MONO};color:${C.dn}">data.json を読めません: ${e.message}</div>`;
  }
})();
