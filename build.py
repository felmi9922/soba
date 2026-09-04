#!/usr/bin/env python3
"""SOBA 日次ビルド。

定義（タグ定義マスタ）→ Notion（無ければ seed/）
実績（株価）        → J-Quants V2（cache/ に終値を圧縮保存）
指標・候補          → Notion DB（無ければ seed/）

出力: docs/data.json （days / latest / link / tags / ind / cands / hist の7キー）

環境変数:
  JQUANTS_API_KEY  必須
  NOTION_TOKEN     任意。無ければ seed/ を使う
  SOBA_ASOF        任意。YYYY-MM-DD を指定するとその営業日で計算（遡及用）
  SOBA_FORCE=1     data.json の latest と同じ日でも再計算する
"""
import gzip, json, os, re, statistics, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent
SEED, CACHE, DOCS = ROOT / "seed", ROOT / "cache", ROOT / "docs"
CACHE.mkdir(exist_ok=True); DOCS.mkdir(exist_ok=True)

JQ = "https://api.jquants.com/v2/"
JQ_KEY = os.environ.get("JQUANTS_API_KEY", "")
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_TAG_PAGE = "3d00f8dc8e6681d2b689f36a86e91ba1"
NOTION_IND_DB = "5d2544dc-46a4-4e5e-a6d8-870d7171a130"
NOTION_CAND_DB = "3cb0f8dc-8e66-80cb-aeb6-d0535aebf068"
NOTION_INDMASTER_DB = "0c9f4ca4-3f92-438a-9a3e-7dba64d3fb62"
OPT_DAYS = 7          # オプションの明細を保持する営業日数
# 観測ログの記録名 → 指標マスタ名（表記ゆれ）。Notion経由ではリレーションで解決するのでこれは seed 用の保険
IND_ALIAS = {
    "鉄スクラップ(東鉄特A)": "鉄スクラップH2価格", "Drewry WCI": "Drewry WCI(世界コンテナ運賃)",
    "中国不動産(開発投資前年比)": "中国 不動産開発投資", "欧川TTF天然ガス": "欧州TTF天然ガス",
    "クラックスプレッド(3-2-1概算)": "クラックスプレッド(精製マージン)", "SCFI": "SCFI(上海輸出コンテナ運賃)",
    "ナフサ(アジア)": "ナフサ・エチレン(アジア)", "スニーカー二次流通(StockX半期)": "スニーカー二次流通価格",
    "航空貨物運賃": "航空貨物運賃(TAC Index)", "豊洲市場 水産物": "豊洲市場 水産物卸売価格",
    "信用評価損益率(概算)": "信用評価損益率", "都心5区オフィス空室率": "都心5区 オフィス空室率",
    "腕時計中古相場指数": "腕時計 中古相場指数",
}
def ind_name(k):
    k = k.replace("欧川", "欧州").strip()
    return IND_ALIAS.get(k, k)
HIST_MONTHS = 33
KEEP_DAYS = 60        # tags を保持する営業日数
KEEP_ST_DAYS = 10     # 構成銘柄(st)を保持する営業日数
JST = timezone(timedelta(hours=9))

def log(*a): print(*a, file=sys.stderr, flush=True)

# ---------------------------------------------------------------- Notion
def notion(method, path, **kw):
    h = {"Authorization": f"Bearer {NOTION_TOKEN}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    r = requests.request(method, "https://api.notion.com/v1/" + path, headers=h, timeout=60, **kw)
    r.raise_for_status(); return r.json()

def notion_page_code_block(page_id):
    """ページ直下のコードブロックを全部連結して返す"""
    out, cursor = [], None
    while True:
        j = notion("GET", f"blocks/{page_id}/children", params={"page_size": 100, **({"start_cursor": cursor} if cursor else {})})
        for b in j["results"]:
            if b["type"] == "code":
                out.append("".join(t["plain_text"] for t in b["code"]["rich_text"]))
        if not j.get("has_more"): break
        cursor = j["next_cursor"]
    return "\n".join(out)

def notion_db_all(db_id):
    rows, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor: body["start_cursor"] = cursor
        j = notion("POST", f"databases/{db_id}/query", json=body)
        rows += j["results"]
        if not j.get("has_more"): break
        cursor = j["next_cursor"]
    return rows

def prop(p):
    """Notion property → プレーン値"""
    t = p["type"]
    if t in ("title", "rich_text"): return "".join(x["plain_text"] for x in p[t]) or None
    if t == "number": return p["number"]
    if t == "select": return p["select"]["name"] if p["select"] else None
    if t == "multi_select": return [x["name"] for x in p["multi_select"]]
    if t == "date": return p["date"]["start"] if p["date"] else None
    if t == "url": return p["url"]
    return None

# ---------------------------------------------------------------- タグ定義
def parse_tag_master(text):
    rule, theme, excluded, section = {}, {}, [], None
    for raw in text.splitlines():
        line = raw.strip()
        if not line: continue
        if line.startswith("#"):
            u = line.upper()
            section = "RULE" if "RULE" in u else "THEME" if "THEME" in u else "EXCLUDED" if "EXCLUDED" in u else section
            continue
        if "::" not in line: continue
        k, v = [x.strip() for x in line.split("::", 1)]
        if section == "RULE":
            rule[k] = json.loads(v)
        elif section == "THEME":
            codes = [c for c in re.split(r"[\s,、]+", v) if c]
            theme[k] = list(dict.fromkeys(codes))   # 重複除去・順序維持
        elif section == "EXCLUDED":
            m = re.match(r"(\S+)\s+(.*)", k)
            excluded.append({"code": m.group(1) if m else k, "name": m.group(2) if m else "", "reason": v})
    return {"rule": rule, "theme": theme, "excluded": excluded}

def load_tag_master():
    text = None
    if NOTION_TOKEN:
        try:
            text = notion_page_code_block(NOTION_TAG_PAGE); log("tag master: Notion")
        except Exception as e:
            log("tag master: Notion 失敗 →", e)
    if not text:
        text = (SEED / "tag_master.txt").read_text(encoding="utf-8"); log("tag master: seed/tag_master.txt")
    tm = parse_tag_master(text)
    (ROOT / "tag_master.json").write_text(json.dumps(tm, ensure_ascii=False, indent=1), encoding="utf-8")
    ex = {e["code"] for e in tm["excluded"]}
    for name, codes in tm["theme"].items():
        hit = [c for c in codes if c in ex]
        if hit: log(f"  警告: {name} に EXCLUDED 銘柄 {hit} が残っている")
    log(f"  RULE {len(tm['rule'])} / THEME {len(tm['theme'])} / EXCLUDED {len(tm['excluded'])}")
    return tm

# ---------------------------------------------------------------- J-Quants
def jq(path, **params):
    for i in range(5):
        r = requests.get(JQ + path, headers={"x-api-key": JQ_KEY}, params=params, timeout=90)
        if r.status_code == 429: time.sleep(10 * (i + 1)); continue
        r.raise_for_status(); return r.json()
    raise RuntimeError(f"J-Quants 429 が続く: {path}")

def biz_days(start, end):
    """TOPIX(0000)の日付列＝営業日カレンダー。yyyymmdd 文字列を古い順で"""
    days, cursor = {}, None
    while True:
        p = {"code": "0000", "from": start, "to": end}
        if cursor: p["pagination_key"] = cursor
        j = jq("indices/bars/daily", **p)
        for x in j["data"]: days[x["Date"]] = x["C"]
        cursor = j.get("pagination_key")
        if not cursor: break
    return days  # {"YYYY-MM-DD": close}

def closes(ymd):
    """1営業日分の終値 {5桁コード: AdjC}。cache/ に gzip 保存"""
    f = CACHE / f"px_{ymd}.json.gz"
    if f.exists():
        with gzip.open(f, "rt", encoding="utf-8") as fh: return json.load(fh)
    j = jq("equities/bars/daily", date=ymd)
    px = {x["Code"]: x["AdjC"] for x in j.get("data", []) if x.get("AdjC") is not None}
    if not px: return {}
    with gzip.open(f, "wt", encoding="utf-8") as fh: json.dump(px, fh, separators=(",", ":"))
    return px

def norm(s):  # 業種名の中黒・読点ゆれを吸収
    return re.sub(r"[･・､、，,]", "･", s or "")

def to4(code5):  # "72030" → "7203", "278A0" → "278A"
    return code5[:-1] if len(code5) == 5 and code5.endswith("0") else code5
def to5(code4):
    return code4 if len(code4) == 5 else code4 + "0"

# ---------------------------------------------------------------- タグ構成
def rule_members(spec, universe):
    """RULE 仕様 → 5桁コード集合。universe: {code5: master行}"""
    out = set()
    s33 = {norm(x) for x in spec.get("s33", [])}
    codes = {to5(c) for c in spec.get("codes", [])}
    exc = {to5(c) for c in spec.get("exclude_codes", [])}
    inc_n, exc_n = spec.get("include_name", []), spec.get("exclude_name", [])
    for c, m in universe.items():
        if codes:
            if c not in codes: continue
        elif s33:
            if norm(m["S33Nm"]) not in s33: continue
        else:
            continue
        if c in exc: continue
        if inc_n and not any(w in m["CoName"] for w in inc_n): continue
        if exc_n and any(w in m["CoName"] for w in exc_n): continue
        out.add(c)
    return out

def tag_members(tm, universe):
    tags = {}
    for k, spec in tm["rule"].items():
        tags[k] = ("ルール", sorted(rule_members(spec, universe)))
    for k, codes in tm["theme"].items():
        tags[k] = ("テーマ", [to5(c) for c in codes if to5(c) in universe])
    return tags

def pct(a, b):  # b→a の騰落率 %
    return (a / b - 1) * 100 if a and b else None

# ---------------------------------------------------------------- 日次
def daily_block(asof_i, days, topix, universe, tags):
    """days: 営業日リスト(古い順), asof_i: その index"""
    d0, d1, d5, d21 = (days[asof_i - k] for k in (0, 1, 5, 21))
    px = {d: closes(d.replace("-", "")) for d in (d0, d1, d5, d21)}
    if not px[d0]: return None
    bench = {"d": pct(topix[d0], topix[d1]), "w": pct(topix[d0], topix[d5]), "m": pct(topix[d0], topix[d21])}
    out = {}
    for name, (kind, codes) in tags.items():
        rows, ds, ws, ms = [], [], [], []
        for c in codes:
            p0 = px[d0].get(c)
            if not p0: continue
            d = pct(p0, px[d1].get(c)); w = pct(p0, px[d5].get(c)); m = pct(p0, px[d21].get(c))
            if d is not None: ds.append(d - bench["d"])
            if w is not None: ws.append(w - bench["w"])
            if m is not None: ms.append(m - bench["m"])
            mm = universe[c]
            rows.append([to4(c), mm["CoName"], mm["S33Nm"], round(d, 1) if d is not None else None,
                         round(w, 1) if w is not None else None, round(m, 1) if m is not None else None])
        if not rows: continue
        out[name] = {
            "d": round(statistics.fmean(ds), 2) if ds else None,
            "w": round(statistics.fmean(ws), 2) if ws else None,
            "m": round(statistics.fmean(ms), 2) if ms else None,
            "md": round(statistics.median(ms), 2) if ms else None,
            "n": len(rows), "s": len({r[2] for r in rows}), "kind": kind,
            "st": sorted(rows, key=lambda r: -(r[5] if r[5] is not None else -1e9)),   # [コード, 社名, 33業種, 日次, 週間, 月間]
        }
    # 順位（月間超過の降順）
    ranked = sorted((k for k in out if out[k]["m"] is not None), key=lambda k: -out[k]["m"])
    for i, k in enumerate(ranked, 1): out[k]["r"] = i
    return {"bench": {k: round(v, 2) for k, v in bench.items()}, "tags": out}

# ---------------------------------------------------------------- ヒストリカル
def month_ends(days, asof_i, n):
    """asof までの営業日から、各月の最終営業日を新しい順に n+1 個（asof の月は asof 自身）"""
    ends, seen = [], set()
    for d in reversed(days[: asof_i + 1]):
        ym = d[:7]
        if ym not in seen:
            seen.add(ym); ends.append(d)
        if len(ends) == n + 1: break
    return list(reversed(ends))

def hist_block(days, asof_i, universe, tags):
    ends = month_ends(days, asof_i, HIST_MONTHS)
    px = {d: closes(d.replace("-", "")) for d in ends}
    months = [d[:7] for d in ends[1:]]
    # ベンチマーク：ユニバース等ウェイト
    bench, ret = {}, {}   # ret[ym][code] = 月次リターン%
    for prev, cur in zip(ends, ends[1:]):
        ym = cur[:7]; r = {}
        for c in universe:
            v = pct(px[cur].get(c), px[prev].get(c))
            if v is not None: r[c] = v
        ret[ym] = r; bench[ym] = round(statistics.fmean(r.values()), 2) if r else 0.0
    tg, cum, summ, lead = {}, {}, {}, {}
    for name, (kind, codes) in tags.items():
        series, acc, cl = {}, 0.0, []
        for ym in months:
            xs = [ret[ym][c] - bench[ym] for c in codes if c in ret[ym]]
            if xs:
                e = statistics.fmean(xs)
                series[ym] = {"e": round(e, 2), "md": round(statistics.median(xs), 2), "n": len(xs), "kind": kind}
                acc += e          # 累積は月次超過の単純合計（ポイント）
            cl.append(round(acc, 1))
        if not series: continue
        tg[name] = series; cum[name] = cl
        es = [v["e"] for v in series.values()]
        summ[name] = {"n": len(es), "tot": cl[-1], "avg": round(statistics.fmean(es), 2),
                      "sd": round(statistics.stdev(es), 2) if len(es) > 1 else 0.0,
                      "win": round(100 * sum(e > 0 for e in es) / len(es)),
                      "max": round(max(es), 2), "min": round(min(es), 2), "kind": kind, "sz": len(codes)}
    for ym in months:
        rows = sorted(((k, v[ym]["e"], v[ym]["n"]) for k, v in tg.items() if ym in v and v[ym]["n"] >= 5), key=lambda x: -x[1])
        lead[ym] = {"top": [list(x) for x in rows[:5]], "bot": [list(x) for x in rows[-5:][::-1]]}
    return {"months": months, "tags": tg, "cum": cum, "lead": lead, "summ": summ, "bench": bench}

# ---------------------------------------------------------------- 指標・候補
def load_indmeta():
    """指標マスタ → {指標名: {cat,freq,diff,j0,nat,lag,thr,unit}}。ページID→名前の辞書も返す"""
    if NOTION_TOKEN:
        try:
            rows = notion_db_all(NOTION_INDMASTER_DB); meta, ids = {}, {}
            for r in rows:
                p = r["properties"]; k = ind_name(prop(p["指標名"]) or "")
                if not k: continue
                ids[r["id"].replace("-", "")] = k
                meta[k] = {"cat": prop(p["カテゴリ"]), "freq": prop(p["頻度"]), "diff": prop(p["取得難易度"]),
                           "j0": prop(p["判定"]) or "未取得", "nat": prop(p["性質"]), "lag": prop(p["伝播ラグ"]),
                           "thr": prop(p["閾値σ"]), "unit": prop(p["単位"])}
            log(f"indmeta: Notion {len(meta)}件"); return meta, ids
        except Exception as e:
            log("indmeta: Notion 失敗 →", e)
    meta = json.loads((SEED / "indmeta.json").read_text(encoding="utf-8")); log(f"indmeta: seed {len(meta)}件"); return meta, {}

def load_ind(master_ids):
    if NOTION_TOKEN:
        try:
            rows = notion_db_all(NOTION_IND_DB); out = []
            for r in rows:
                p = r["properties"]
                title = prop(p["記録"]) or ""
                k = re.sub(r"^\d{4}-\d{2}(-\d{2})?\s*", "", title).strip()
                k = re.sub(r"[（(](取得失敗|ルートのみ確定)[)）]$", "", k).strip()
                rel = p.get("指標", {}).get("relation") or []
                if rel and rel[0]["id"].replace("-", "") in master_ids: k = master_ids[rel[0]["id"].replace("-", "")]
                else: k = ind_name(k)
                out.append({"d": prop(p["観測日"]), "k": k, "v": prop(p["値"]), "pd": prop(p["前日比%"]),
                            "w": prop(p["1週間%"]), "m": prop(p["1ヶ月%"]), "z": prop(p["zスコア"]),
                            "p": prop(p["パーセンタイル"]), "j": prop(p["判定"]), "src": prop(p["出所"]), "memo": prop(p["メモ"])})
            log(f"ind: Notion {len(out)}件"); return sorted(out, key=lambda x: (x["d"] or "", x["k"]))
        except Exception as e:
            log("ind: Notion 失敗 →", e)
    out = json.loads((SEED / "ind.json").read_text(encoding="utf-8"))
    for r in out: r["k"] = ind_name(r["k"])
    log(f"ind: seed {len(out)}件"); return out

# ---------------------------------------------------------------- 日経225オプション
def options_block(ymd):
    """1営業日分。series 行と strikes 明細（期近＋次限月）を返す。PCDiv: 1=プット 2=コール"""
    rows, cursor = [], None
    while True:
        p = {"date": ymd}
        if cursor: p["pagination_key"] = cursor
        j = jq("derivatives/bars/daily/options/225", **p)
        rows += j.get("data", []); cursor = j.get("pagination_key")
        if not cursor: break
    if not rows: return None
    cms = sorted({r["CM"] for r in rows if r.get("CM")})[:2]
    near = cms[0]
    px = next((r["UnderPx"] for r in rows if r.get("UnderPx")), None)
    tot = {"oi": 0, "vo": 0, "poi": 0, "coi": 0, "pvo": 0, "cvo": 0, "noi": 0, "nvo": 0}
    strikes = {}
    for r in rows:
        oi, vo, put = r.get("OI") or 0, r.get("Vo") or 0, r.get("PCDiv") == "1"
        tot["oi"] += oi; tot["vo"] += vo
        tot["poi" if put else "coi"] += oi; tot["pvo" if put else "cvo"] += vo
        if r["CM"] == near: tot["noi"] += oi; tot["nvo"] += vo
        if r["CM"] in cms:
            s = strikes.setdefault(r["Strike"], [r["Strike"], 0.0, 0.0, 0.0, 0.0])
            if put: s[2] += oi; s[4] += vo
            else: s[1] += oi; s[3] += vo
    # ATM IV: 期近で原資産に近い6本の平均
    ivs = sorted((abs(r["Strike"] - px), r["IV"]) for r in rows if r["CM"] == near and r.get("IV") and px)
    iv = round(statistics.fmean(v for _, v in ivs[:6]), 2) if ivs else None
    series = {"d": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}", "px": px, "near": near, "oi": tot["oi"], "vo": tot["vo"],
              "pcr_oi": round(tot["poi"] / tot["coi"], 3) if tot["coi"] else None,
              "pcr_vo": round(tot["pvo"] / tot["cvo"], 3) if tot["cvo"] else None,
              "noi": tot["noi"], "nvo": tot["nvo"], "iv": iv, "doi": None, "dpx": None}
    detail = {"px": px, "cms": cms, "strikes": [[int(k)] + v[1:] for k, v in sorted(strikes.items())]}
    return series, detail

def build_options(prev_opt, days, asof_i):
    """直近 OPT_DAYS 営業日分。既存分はそのまま使い、無い日だけ取得"""
    want = days[max(0, asof_i - OPT_DAYS + 1): asof_i + 1]
    ser = {s["d"]: s for s in (prev_opt or {}).get("series", [])}
    det = dict((prev_opt or {}).get("detail", {}))
    for d in want:
        if d in ser and d in det: continue
        try:
            r = options_block(d.replace("-", ""))
        except Exception as e:
            log("options 取得失敗", d, e); r = None
        if r: ser[d], det[d] = r
    out_days = [d for d in want if d in ser]
    series = [ser[d] for d in out_days]
    for i, s in enumerate(series):
        if i:
            p = series[i - 1]
            s["doi"] = s["oi"] - p["oi"] if p.get("oi") is not None else None
            s["dpx"] = round(pct(s["px"], p["px"]), 2) if s.get("px") and p.get("px") else None
    # 明細に前日比（dCallOI, dPutOI）を付ける
    for i, d in enumerate(out_days):
        prevd = out_days[i - 1] if i else None
        pm = {r[0]: r for r in det[prevd]["strikes"]} if prevd else {}
        for r in det[d]["strikes"]:
            q = pm.get(r[0]); r[5:] = [r[1] - q[1], r[2] - q[2]] if q else []
    return {"series": series, "detail": {d: det[d] for d in out_days}, "days": out_days}

def load_cands():
    if NOTION_TOKEN:
        try:
            rows = notion_db_all(NOTION_CAND_DB); out = []
            for r in rows:
                p = r["properties"]
                out.append({"code": prop(p["コード"]), "name": prop(p["銘柄"]), "status": prop(p["ステータス"]),
                            "track": prop(p["トラック"]), "type": prop(p["類型"]), "catalyst": prop(p["カタリスト"]),
                            "timing": prop(p["想定時期"]), "cdate": prop(p["カタリスト日"]), "found": prop(p["検出日"]),
                            "theme": prop(p["テーマ"]) or [], "conf": prop(p["確度"]), "src": prop(p["ソース"])})
            log(f"cands: Notion {len(out)}件"); return out
        except Exception as e:
            log("cands: Notion 失敗 →", e)
    out = json.loads((SEED / "cands.json").read_text(encoding="utf-8")); log(f"cands: seed {len(out)}件"); return out

# ---------------------------------------------------------------- main
def main():
    if not JQ_KEY: sys.exit("JQUANTS_API_KEY がありません")
    tm = load_tag_master()
    link = json.loads((ROOT / "link.json").read_text(encoding="utf-8"))

    today = datetime.now(JST).date()
    start = (today - timedelta(days=int(365 * (HIST_MONTHS / 12 + 0.6)))).strftime("%Y%m%d")
    topix = biz_days(start, today.strftime("%Y%m%d"))
    days = sorted(topix)
    asof = os.environ.get("SOBA_ASOF") or days[-1]
    if asof not in topix: sys.exit(f"{asof} は営業日ではありません")
    asof_i = days.index(asof)

    out_path = DOCS / "data.json"
    prev = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else None
    if prev and prev.get("latest") == asof and not os.environ.get("SOBA_FORCE") and not os.environ.get("SOBA_ASOF"):
        log(f"{asof} は計算済み。スキップ（SOBA_FORCE=1 で再計算）"); return

    master = jq("equities/master")["data"]
    universe = {m["Code"]: m for m in master if (m.get("ScaleCat") or "-") != "-"}
    log(f"universe(TOPIX構成) {len(universe)} / 全 {len(master)}")
    tags = tag_members(tm, universe)
    for k, (kind, codes) in tags.items():
        if len(codes) < 5: log(f"  注意: {k} は {len(codes)} 銘柄（5未満）")

    # 当日株価の有無を確認
    if not closes(asof.replace("-", "")):
        sys.exit(f"{asof} の株価がまだ J-Quants に入っていません。推測で埋めず終了します。")

    # 日次（前営業日が未計算なら順位変動のために前日も計算）
    tags_by_day = {} if not prev else {d: v for d, v in prev.get("tags", {}).items() if d != asof}
    prev_day = days[asof_i - 1]
    if prev_day not in tags_by_day:
        b = daily_block(asof_i - 1, days, topix, universe, tags)
        if b: tags_by_day[prev_day] = b
    cur = daily_block(asof_i, days, topix, universe, tags)
    if not cur: sys.exit("当日分の算出に失敗")
    pr_ranks = {k: v.get("r") for k, v in tags_by_day.get(prev_day, {}).get("tags", {}).items()}
    for k, v in cur["tags"].items():
        v["pr"] = pr_ranks.get(k)
        v["mv"] = (v["pr"] - v["r"]) if v.get("pr") and v.get("r") else 0
    tags_by_day[asof] = cur

    day_list = sorted(tags_by_day)[-KEEP_DAYS:]
    tags_by_day = {d: tags_by_day[d] for d in day_list}
    for d in day_list[:-KEEP_ST_DAYS]:
        for v in tags_by_day[d]["tags"].values(): v.pop("st", None)

    hist = hist_block(days, asof_i, universe, tags)

    # 候補にテーマを結線
    cands = load_cands()
    code_tags = {}
    for name, (kind, codes) in tags.items():
        for c in codes: code_tags.setdefault(to4(c), []).append(name)
    for c in cands:
        c["tags"] = code_tags.get(str(c.get("code") or ""), [])
    indmeta, master_ids = load_indmeta()
    ind = load_ind(master_ids)
    link = {ind_name(k): [t for t in v if t in tags] for k, v in link.items()}

    # 日経225オプション（原資産価格 UnderPx を日経225の代理に使う）
    opt = build_options(prev.get("opt") if prev else None, days, asof_i)
    for s in opt["series"]:
        if s["d"] in tags_by_day: tags_by_day[s["d"]]["nk"] = {"px": s["px"], "dpx": s["dpx"]}

    data = {"days": day_list, "latest": asof, "link": link, "tags": tags_by_day, "ind": ind, "cands": cands, "hist": hist,
            "indmeta": indmeta, "opt": opt, "built": datetime.now(JST).isoformat(timespec="seconds")}
    out_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"docs/data.json 書き出し: latest={asof} days={len(day_list)} tags={len(cur['tags'])} size={out_path.stat().st_size//1024}KB")

    # キャッシュ整理：月末営業日以外で 40営業日より古いものは消す
    keep = set(d.replace("-", "") for d in month_ends(days, asof_i, HIST_MONTHS + 2)) | set(d.replace("-", "") for d in days[max(0, asof_i - 40): asof_i + 1])
    for f in CACHE.glob("px_*.json.gz"):
        if f.name[3:11] not in keep: f.unlink()

    # Actions のサマリー用
    top = sorted(cur["tags"].items(), key=lambda kv: kv[1]["r"] or 999)
    movers = [(k, v) for k, v in cur["tags"].items() if abs(v.get("mv") or 0) >= 10]
    summary = [f"## SOBA {asof}", f"TOPIX 日{cur['bench']['d']:+.2f}% 週{cur['bench']['w']:+.2f}% 月{cur['bench']['m']:+.2f}%", ""]
    if movers:
        summary.append("**順位±10以上**"); summary += [f"- {k} {v['pr']}位→{v['r']}位（{v['mv']:+d}）月{v['m']:+.2f}%" for k, v in sorted(movers, key=lambda kv: -abs(kv[1]['mv']))]
    summary.append(""); summary.append("**月間超過 上位5**"); summary += [f"- {k} {v['m']:+.2f}%（中央値{v['md']:+.2f}% n={v['n']}）" for k, v in top[:5]]
    summary.append(""); summary.append("**下位3**"); summary += [f"- {k} {v['m']:+.2f}%（n={v['n']}）" for k, v in top[-3:]]
    text = "\n".join(summary); print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text(text, encoding="utf-8")

if __name__ == "__main__":
    main()
