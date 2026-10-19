# 05. API 仕様

mailamb Worker (本番URL: `https://mailamb.<your-subdomain>.workers.dev`)

全エンドポイント `X-API-Key: <API_KEY>` ヘッダ必須（`/health` のみ無認証）。

## GET /health

ヘルスチェック。

```bash
curl https://mailamb.<subdomain>.workers.dev/health
```

```json
{
  "ok": true,
  "service": "mailamb",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
}
```

## POST /api/draft

問い合わせ1件を処理して下書き生成＋KV保存。

### リクエスト

```json
{
  "message_id": "<msgid@example.com>",       // 重複処理ガード用の一意ID（必須）
  "subject": "お問い合わせ件名",
  "from": {
    "name": "田中一郎",
    "email": "tanaka@example.co.jp"
  },
  "body": "問い合わせ本文...",
  "thread_history": [                         // 任意：過去のスレッド
    {"from": "...", "at": "2026-10-10T10:00+09:00", "body": "..."}
  ],
  "attachments": [                            // 任意：添付情報（本文は読まれない）
    {"filename": "見積.pdf", "size": 240000}
  ]
}
```

### レスポンス

```json
{
  "message_id": "<msgid@example.com>",
  "skip": false,
  "intent": "問い合わせの意図サマリー...",
  "retrieved": [
    {
      "doc_id": "case-005",
      "chunk_id": "case-005:0",
      "type": "past_case",
      "score": 0.804,
      "title": "[保守運用] 他社で作ってもらったWordPressサイトですが..."
    }
  ],
  "draft": "[AI下書き]\nお問い合わせありがとうございます...",
  "attachment_warning": "⚠ 添付あり: 見積.pdf (234KB)...",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "elapsed_ms": 11320
}
```

### スキップされるケース

```json
{
  "message_id": "<...>",
  "skip": true,
  "skip_reason": "営業メール（件名フィルタ）"
}
```

skip_reason の種類:
- `処理済み (generated|skip:...)` — 既にmessage_idで処理済み
- `営業メール（件名フィルタ）` — 件名パターン一致
- `営業メール（本文パターン）`
- `NG顧客: <reason>` — ng_senders登録済み
- `skip (<kind>)` — skip_senders登録済み

## GET /api/draft/by-msgid/:msgid

事前に処理済みの下書きをKVから取得（TB拡張用）。

```bash
MID='<msgid@example.com>'
ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MID'))")
curl "https://mailamb.<subdomain>.workers.dev/api/draft/by-msgid/$ENC" \
  -H "X-API-Key: <API_KEY>"
```

レスポンスは `POST /api/draft` と同じ形式。

未処理なら 404:
```json
{"error": "not found", "message_id": "<msgid>"}
```

## POST /api/documents

テンプレ・過去対応・マニュアルを登録（RAG用）。既存 `doc_id` なら上書き+ベクトル再構築。

### リクエスト

```json
{
  "doc_id": "tpl-ec-001",
  "type": "template",             // "template" | "past_case" | "manual"
  "title": "ECサイト新規制作見積",
  "category": "新規見積依頼",
  "tags": ["EC", "新規"],
  "content": "# タイトル\n\n本文...（Markdown可）"
}
```

### レスポンス

```json
{
  "doc_id": "tpl-ec-001",
  "chunks": 3                     // 分割されたチャンク数
}
```

## GET /api/documents

登録済み一覧。

```bash
curl https://mailamb.<subdomain>.workers.dev/api/documents \
  -H "X-API-Key: <API_KEY>"
```

```json
[
  {
    "doc_id": "tpl-005",
    "type": "template",
    "title": "保守運用プランの案内",
    "category": "保守運用",
    "tags": "[\"保守\",\"月額\",\"運用\"]",
    "updated_at": 1760754904,
    "active": 1
  }
]
```

## DELETE /api/documents/:id

ソフトデリート（`active=0`）。RAG検索結果から除外されるが、使用ログや復元用にデータは残る。

```bash
curl -X DELETE https://mailamb.<subdomain>.workers.dev/api/documents/tpl-005 \
  -H "X-API-Key: <API_KEY>"
```

```json
{"ok": true, "doc_id": "tpl-005"}
```

## エラーレスポンス

```json
{"error": "unauthorized"}        // 401 – API Key不足/不正
{"error": "not found"}            // 404 – エンドポイント or リソース未発見
{"error": "message_id and body are required"}  // 400 – リクエスト不足
{"error": "<内部エラーメッセージ>"}   // 500 – 想定外
```

## レート制限

- Workers AI: モデル別。llama-3.3-70b は数十req/min目安
- 母艦スクリプト or 外部クライアント側で p-limit(5) 推奨
- 429 や 5xx 時は指数バックオフでリトライ

## CORS

全エンドポイントが `Access-Control-Allow-Origin: *` を返す（Pages UI 等からの呼び出し用）。本番で絞るなら `src/index.ts` の `json()` ヘルパを修正。
