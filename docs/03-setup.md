# 03. セットアップ

初期構築手順。既にデプロイ済みの環境を使う場合はこのドキュメントは参照のみ。

## 前提

- macOS (開発端末)
- Node.js 20+ / pnpm
- Cloudflare アカウント + wrangler
- cfauth CLI (`cua.ai` ではなく、当社内製のCloudflare account切替ツール)
- Thunderbird 158+ (スタッフPCは macOS/Windows いずれでも)

## ステップ 1. Cloudflare 認証

```bash
# CF アカウントを cfauth に登録済みなら
cd worker
cfauth use 当社
cfauth status  # account=当社 / token=あり を確認
```

未登録の場合:
```bash
cfauth accounts     # 一覧
cfauth login --as 当社   # ブラウザでログイン
cfauth use 当社
```

## ステップ 2. Cloudflare リソース作成

```bash
cd worker

# D1
cfauth wrangler d1 create mailamb
# → database_id を wrangler.toml の [[d1_databases]] に貼る

# KV
cfauth wrangler kv namespace create PROCESSED
# → id を wrangler.toml の [[kv_namespaces]] に貼る

# Vectorize
cfauth wrangler vectorize create mailamb-docs --dimensions=1024 --metric=cosine
cfauth wrangler vectorize create-metadata-index mailamb-docs --property-name=type --type=string
cfauth wrangler vectorize create-metadata-index mailamb-docs --property-name=doc_id --type=string

# R2
cfauth wrangler r2 bucket create mailamb-docs

# D1マイグレーション
cfauth wrangler d1 migrations apply mailamb --remote
```

## ステップ 3. mailamb Worker デプロイ

```bash
cd worker

# API Key を secretに
openssl rand -hex 32 | tee /tmp/apikey.txt | cfauth wrangler secret put API_KEY

pnpm install
cfauth wrangler deploy
# → https://mailamb.<subdomain>.workers.dev が払い出される
```

動作確認:
```bash
curl https://mailamb.<subdomain>.workers.dev/health
# {"ok":true, ...}
```

## ステップ 4. ドキュメント投入

PoCの `data/templates.json` + `data/past_cases.json` を本番 Worker に転送：

```bash
cd poc
# .env に本番URLとAPIキー記載
echo "WORKER_URL=https://mailamb.<subdomain>.workers.dev" >> .env
echo "WORKER_API_KEY=<上で生成したAPI Key>" >> .env
pnpm exec tsx scripts/06-upload-to-worker.ts
```

Vectorize は非同期なので、`cfauth wrangler vectorize info mailamb-docs` で `vectorCount` が反映されるまで待つ（通常1〜5分）。

## ステップ 5. mailamb-email Worker デプロイ

```bash
cd worker-email

# mailamb の API Key を secret で登録
cat /tmp/apikey.txt | cfauth wrangler secret put MAILAMB_API_KEY

pnpm install
cfauth wrangler deploy
```

## ステップ 6. Email Routing 設定

```bash
# API経由（zone id を手に入れる）
ZONE_ID=$(curl -sS -H "Authorization: Bearer <token>" \
  "https://api.cloudflare.com/client/v4/zones?name=example.com" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")

# info@ を mailamb-email Worker に向ける
# ダッシュボードから操作するのが楽: Email → Routing → Routes
# https://dash.cloudflare.com/<account>/example.com/email/routing/routes
```

ルール:
- `info@example.com` → `mailamb-email` (type: worker)
- `test@example.com` → `forward@example.com` (開発用)
- 必要に応じて他スタッフ用アドレス追加

**destination addresses** に全スタッフのメアドを verified で登録:
Dashboard → Email → Routing → Destination addresses → Add destination address

## ステップ 7. Thunderbird 拡張インストール

### 7-1. XPI 配布ファイル作成

```bash
cd addon
zip -r /tmp/mailamb-addon.xpi manifest.json background.js icons ui
```

### 7-2. 各スタッフPCで

Thunderbird 設定:
1. `~/Library/Thunderbird/Profiles/*.default-release/user.js` に以下追加（未署名拡張を許可）:
   ```
   user_pref("xpinstall.signatures.required", false);
   user_pref("extensions.autoDisableScopes", 0);
   user_pref("extensions.enabledScopes", 15);
   ```
2. Thunderbird 再起動
3. 設定 → アドオンとテーマ → 右上⚙️ → 「ファイルからアドオンをインストール」→ `mailamb-addon.xpi`
4. 拡張の設定で Worker URL と API Key を入力:
   - Worker URL: `https://mailamb.<subdomain>.workers.dev`
   - API Key: ステップ3で生成した値

もしくはプロファイルに直接配置して自動インストール:
```bash
PROFILE=~/Library/Thunderbird/Profiles/*.default-release
mkdir -p "$PROFILE/extensions"
cp /tmp/mailamb-addon.xpi "$PROFILE/extensions/mailamb@mailamb.local.xpi"
```

## ステップ 8. 動作確認

**サーバ側テスト**:
```bash
curl -X POST https://mailamb.<subdomain>.workers.dev/api/draft \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "<test@local>",
    "subject": "保守運用について",
    "from": {"name":"山田","email":"test@example.com"},
    "body": "WordPressサイトの保守お願いします。月額プラン教えてください。"
  }'
```

→ `retrieved` に `tpl-005` / `case-005` 類がヒット、`draft` に保守運用プランが返ってくれば成功。

**メール経由テスト**:
```bash
# Resend API 経由（代替送信手段）
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer <RESEND_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"from":"test@example.com","to":"info@example.com","subject":"test","text":"保守運用についてお聞きしたいです"}'
```

→ 1分以内に Gmail に転送メールが届き、TBで拡張の🤖アイコンから下書き表示できれば完了。

## 環境変数まとめ

### worker/wrangler.toml

```toml
[vars]
GEN_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
EMBED_MODEL = "@cf/baai/bge-m3"
RAG_THRESHOLD = "0.5"
RAG_TOP_K = "5"
TEMPERATURE = "0.3"
```

Secrets:
- `API_KEY` — Worker 認証用

### worker-email/wrangler.toml

```toml
[vars]
FORWARD_TO = "forward@example.com"   # カンマ区切りで複数指定可（全verified必須）
FAIL_OPEN = "true"                              # 生成失敗時も転送だけは実行
```

Secrets:
- `MAILAMB_API_KEY` — mailamb Worker 呼び出し用（上の API_KEY と同じ値）
