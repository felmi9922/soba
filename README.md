# SOBA — 相場の見取り図

指標・テーマ（タグ）別パフォーマンス・調査銘柄候補・日経225オプションを1画面に統合したアプリ。
GitHub Actions が平日夕方に `docs/data.json` を作り直し、GitHub Pages で配信する。**URLは固定**なので、ステータス・メモ・★はブラウザの localStorage に残り続ける。

## 構成

| ファイル | 役割 |
|---|---|
| `build.py` | 日次ビルド本体。Notion → 定義・指標・候補、J-Quants → 株価・オプション。`docs/data.json` を書く |
| `app.jsx` | UI本体（React）。`npm run build:app` で `docs/app.js` にバンドル。**DATA を差し替えるだけの設計は不要になった**（fetch で読む） |
| `docs/` | GitHub Pages の公開ディレクトリ。`index.html` `app.js` `data.json` |
| `link.json` | 指標→テーマの連想マップ（キーは指標マスタの指標名） |
| `seed/` | Notion に繋がらないときのフォールバック。`tag_master.txt` `ind.json` `cands.json` `indmeta.json` |
| `cache/` | 株価終値の gzip キャッシュ（月末営業日＋直近40営業日）。コミットして持ち越す |
| `tag_master.json` | 最後のビルドで使ったタグ定義の展開結果（参照用。正本ではない） |
| `scripts/check_render.mjs` | headless Chromium で全タブ・モーダルを開いて JS エラーが無いことを確認する |
| `.github/workflows/daily.yml` | 平日 16:30 / 18:00 JST に実行。当日株価が J-Quants に無ければ何もしない |

## データの正本

| データ | 正本 | 備考 |
|---|---|---|
| タグ定義 | Notion「タグ定義マスタ」のコードブロック | `NOTION_TOKEN` が無い/失敗時は `seed/tag_master.txt` |
| 指標の観測 | Notion「指標観測ログ」DB | 指標名はリレーション先の「指標マスタ」名に正規化 |
| 指標のメタ | Notion「指標マスタ」DB | カテゴリ・頻度・難易度・判定 |
| 候補 | Notion「調査銘柄候補」DB | |
| 株価・オプション | J-Quants V2 | 毎回再計算。キャッシュは終値のみ |
| 候補の判断 | ブラウザの localStorage（`soba_v2`） | SYNC で JSON の持ち出し・取り込みができる |

## 初回セットアップ

1. **Secrets**（Settings → Secrets and variables → Actions）
   - `JQUANTS_API_KEY` … J-Quants V2 の API キー（必須）
   - `NOTION_TOKEN` … Notion の内部インテグレーションのトークン（任意。無いと `seed/` の内容で動く）
     1. https://www.notion.so/my-integrations で内部インテグレーションを作る（Read content があればよい）
     2. 次の4つを「…」→「接続」でそのインテグレーションに共有する: タグ定義マスタ（ページ）、指標観測ログ、指標マスタ、調査銘柄候補（DB）
2. **Pages**（Settings → Pages）: Source = *Deploy from a branch*, Branch = `main`, Folder = `/docs`
3. **Actions**: Settings → Actions → General → Workflow permissions を *Read and write* にする（data.json をコミットするため）
4. Actions タブから **SOBA daily build** を `Run workflow` で手動実行して動作確認

## 手元で回す

```bash
pip install requests
npm ci
JQUANTS_API_KEY=... NOTION_TOKEN=... python build.py      # docs/data.json
npm run build:app                                          # docs/app.js
npm i -D playwright --no-save && npm run check             # 描画検証（要 Chromium）
```

- `SOBA_ASOF=2026-08-28 python build.py` で過去営業日を計算（連続した期間を遡るときはキャッシュが効く）
- `SOBA_FORCE=1` で同じ日を再計算（タグ定義を直した後に使う）

## data.json の形式

```
days    営業日の配列（古い順、最大60日）
latest  最新営業日
link    { 指標名: [テーマ名...] }
tags    { 日付: { bench:{d,w,m}, nk:{px,dpx}, tags:{ テーマ名: {r,pr,mv,d,w,m,md,n,s,kind,st} } } }
          st = [[コード, 社名, 33業種, 日次%, 週間%, 月間%], ...]（直近10営業日のみ保持）
ind     [{d,k,v,pd,w,m,z,p,j,src,memo}]        指標観測ログ全件
cands   [{code,name,status,track,type,catalyst,timing,cdate,found,theme,conf,src,tags}]
hist    { months, tags:{名:{YYYY-MM:{e,md,n,kind}}}, cum, lead, summ, bench }   33か月
indmeta { 指標名: {cat,freq,diff,j0,nat,lag,thr,unit} }
opt     { series:[{d,px,near,oi,vo,pcr_oi,pcr_vo,noi,nvo,iv,doi,dpx}], detail:{日付:{px,cms,strikes}}, days }
          strikes = [行使価格, コール建玉, プット建玉, コール出来高, プット出来高, コール増減, プット増減]
built   生成時刻（JST）
```

## 計算の約束

- ユニバースは `ScaleCat` が空でも `-` でもない銘柄（TOPIX構成）。RULE タグは業種マスタから毎回生成、THEME タグはコード列挙をそのまま使う
- 日次・週間(5営業日)・月間(21営業日)はすべて **対TOPIX の超過リターン**。順位は月間超過の降順、`mv` は前営業日からの順位変動
- ヒストリカルは月末営業日の終値どうし。ベンチマークはユニバース等ウェイト平均。累積は月次超過の**単純合計**
- オプションの PCDiv は `1`=プット `2`=コール。PUT/CALL 建玉レシオは全限月合計なので常に 1 を大きく超える（水準より変化を見る）

## 運用ルール（前セッションからの引き継ぎ）

- **銘柄をタグに入れる前に EDINETDB の `get_segments` でセグメント確認**。該当セグメントが独立開示され売上か営業利益の10%以上。2026-09-03 に8件の誤混入で前工程の符号が反転した
- **社名の部分一致で入れない**（プライズ→エンタープライズ、ラック→ラックス建設 など6回失敗）。`search_ir_sections` は専門語で引く
- **10銘柄未満のタグは符号も信用しない**。平均と中央値が4pt以上離れていたら中央値で見る
- `app.jsx` を触ったら `npm run check` で全タブを描画してから push する（React error #130 の実績あり）
- Notion 側の既知の表記ゆれ: 指標マスタ「欧川TTF天然ガス」→ コードで「欧州」に正規化している。タグ定義マスタの `卵売業` は `卸売業` の誤記（seed では修正済み。Notion も直すこと）

## 未完（優先順）

1. 消えた拡張13テーマの再構築。前アプリのデータから **自動運転・半導体製造装置・電子部品** の3本は復元して seed に入れた。残り10本は名前も不明
2. 5銘柄未満のテーマ 11件の拡充（`build.py` のログに「注意: … 5未満」で出る）
3. 指標の取得失敗 11件（ポケカ日次・JEPX・日経VI・Steam・遊戯王・ワンピース・裁定買残・SCFI・豊洲・中古iPhone・航空貨物）
4. 連想マップ `link.json` の検証（効いていない組み合わせを外す）
5. Slack 通知（順位±10、上位5/下位3、指標と逆行しているタグ）。Actions のステップサマリーには出している
