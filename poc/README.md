# mailamb PoC — RAG + 生成品質評価

Workers AIを実叩きして「問い合わせ→定型文/過去対応検索→返信下書き生成」の質を評価する最小構成。
本番の Vectorize は使わず、ローカルJSONにベクトルを置いてcos類似で検索する（データが40件未満のため十分）。

## 構成

```
poc/
├── data/
│   ├── inquiries.json      # テスト問い合わせ15件
│   ├── templates.json      # 定型文9件（うち1件はfallback）
│   └── past_cases.json     # 過去対応ペア10件
├── lib/
│   ├── cf-ai.ts           # Workers AI REST API 薄いラッパ
│   ├── cosine.ts          # cos類似 + topK
│   └── types.ts
├── scripts/
│   ├── 01-ingest.ts       # templates + past_cases を embed → out/index.json
│   ├── 02-draft.ts        # inquiries を1件ずつ処理 → out/drafts.json
│   └── 03-eval.ts         # 評価レポート生成 → out/report.md
├── package.json
└── .env.example
```

## 使い方

### 1. Cloudflare 準備

- Cloudflareアカウント ID を取得（ダッシュボード右下）
- API Token作成（Workers AI Read 権限）: https://dash.cloudflare.com/profile/api-tokens
- Workers AI は Free Plan で日次 Neurons があるが、llama-3.3-70b は有料。
  10件程度の試行なら数円〜数十円の範囲。

### 2. セットアップ

```bash
cd poc
cp .env.example .env
# .env に CF_ACCOUNT_ID と CF_API_TOKEN を書く
pnpm install   # or npm install
```

### 3. 実行

```bash
pnpm ingest    # 定型文・過去対応をベクトル化
pnpm draft     # 15件の問い合わせを全部処理
pnpm eval      # out/report.md に評価シートを出力
```

または全部まとめて:

```bash
pnpm all
```

### 4. 評価

`out/report.md` を開く。評価シートの表に ◎○△× を手で埋めていく。

評価軸:
- 意図把握
- テンプレ適合（引っ張ってきた参考が妥当か）
- 文体
- 直し量（◎そのまま送れる / ○微修正 / △半分書き直し / ×使えない）

直し量 ◎+○ の割合が 70% 以上なら、本番Workerへ移植する価値あり。

## 本番構成への移植

PoC検証後、以下を本番Cloudflareに移す:

1. `lib/cf-ai.ts` → Worker内で `env.AI.run(...)`
2. `out/index.json` のベクトル → Vectorize index にupsert
3. ドキュメント原文 → R2
4. メタ → D1
5. エントリポイント → `POST /api/draft` の Worker

PoC スクリプト構造はそのまま Worker handler に写せる形にしてある。

## 注意

- Workers AI の llama-3.3-70b は時々5xxを返す。リトライ戦略を本番では入れる
- bge-m3 の cos閾値 0.5 はPoC初期値。評価結果を見て調整
- 添付警告は PoC では inquiries.json の attachments を見るだけ（実運用ではMIMEから抽出）
