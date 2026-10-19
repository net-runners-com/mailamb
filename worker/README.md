# mailamb Worker — Cloudflare本番

母艦スクリプト（または手動UI）から呼ばれる、RAG + 下書き生成の Cloudflare Worker。

## 構成

```
worker/
├── wrangler.toml           # バインディング設定
├── migrations/
│   └── 0001_init.sql      # D1スキーマ
├── src/
│   ├── index.ts           # エントリ（HTTPルーティング）
│   ├── draft.ts           # processDraft: prefilter→intent→embed→Vectorize→LLM
│   ├── ingest.ts          # ingestDocument: R2→chunk→embed→Vectorize upsert→D1
│   └── types.ts           # Env / リクエスト・レスポンス型
└── package.json
```

## API

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/draft` | 問い合わせ1件を処理して下書き生成 |
| POST | `/api/documents` | テンプレ/マニュアル/過去対応を登録（R2+D1+Vectorize） |
| GET | `/api/documents` | 登録済みドキュメント一覧 |
| DELETE | `/api/documents/:id` | ソフトデリート（active=0） |
| GET | `/health` | ヘルスチェック |

## デプロイ手順（初回）

### 1. Cloudflareリソース作成

```bash
cd worker
pnpm install
# wrangler login（または CLOUDFLARE_API_TOKEN をexport）
pnpm wrangler login

# D1
pnpm wrangler d1 create mailamb
# → 出力の database_id を wrangler.toml の REPLACE_WITH_D1_ID に貼る

# KV
pnpm wrangler kv namespace create PROCESSED
# → 出力の id を wrangler.toml の REPLACE_WITH_KV_ID に貼る

# Vectorize (1024次元、cosine)
pnpm wrangler vectorize create mailamb-docs --dimensions=1024 --metric=cosine

# Vectorize metadata index (絞り込み検索したい時)
pnpm wrangler vectorize create-metadata-index mailamb-docs --property-name=type --type=string
pnpm wrangler vectorize create-metadata-index mailamb-docs --property-name=category --type=string

# R2
pnpm wrangler r2 bucket create mailamb-docs

# D1マイグレーション実行
pnpm wrangler d1 migrations apply mailamb --remote
```

### 2. API Key を secrets に

```bash
# ランダム生成
openssl rand -hex 32 | pbcopy
# wranglerで登録（pbpasteで貼る）
pnpm wrangler secret put API_KEY
```

### 3. デプロイ

```bash
pnpm deploy
# → https://mailamb.<your-subdomain>.workers.dev
```

### 4. ドキュメント投入（PoCデータから）

ローカルPoCのテンプレ・過去対応をWorkerに流し込む:

```bash
# worker/ ではなく poc/ 配下から（別途スクリプト追加予定）
cd ../poc
tsx scripts/05-upload-to-worker.ts
```

## ローカル開発

```bash
pnpm dev
# → http://localhost:8787/
# wrangler devはAI/Vectorize/D1/R2バインディングもリモート（または local=true オプション）
```

## 本番運用の注意

- **APIキー保護**: 必ず `wrangler secret put API_KEY` で設定し、クライアント側でヘッダ `X-API-Key` を付与
- **レート制限**: Workers AI はモデル別にレート制限あり。母艦スクリプト側で `p-limit(5)` 推奨
- **重複処理**: `PROCESSED` KVに message_id を90日間保持。朝バッチ再実行時の二重処理を防ぐ
- **コスト観測**: `wrangler tail` でログ監視、observability ダッシュボードで Neurons 消費確認
- **モデル切替**: `wrangler.toml` の `GEN_MODEL` を変更して `pnpm deploy`

## 次のタスク

- [ ] 母艦スクリプト（Node.js・IMAP直結・新着読み→Worker呼び出し→Drafts APPEND）
- [ ] 手動Web下書きUI（Pages + 本WorkerのAPI叩き）
- [ ] テンプレ管理UI（CRUD + /api/documents 使用）
- [ ] 使用ログの可視化（editedフラグ更新バッチ、鮮度ランキング）
