# mailamb-watcher

Cloudflare Workers 単体で IMAP IDLE を保持し、新着メールをリアルタイム検知する"サーバーレス母艦"。

## これで何ができる

- ✓ **サブ秒レベルのリアルタイム検知** (IMAP IDLE push)
- ✓ **完全無料** (Workers Free Plan のみ)
- ✓ **既存ドメイン無影響** (CF Email Routing不要、DNS操作ゼロ)
- ✓ **母艦PC不要** (CF 内で完結)
- ✓ **既存メール鯖 (Xserver等) そのまま**

## 動作原理

```
cron 1分 (保険)
   ↓ (チェーン切れ検知時のみ)
scheduled handler
   ↓
fetch /loop
   ↓
IMAP IDLE 90秒保持 (push待機)
   ├─ EXISTS push → 即処理
   ├─ UID SEARCH UNSEEN → 新着取得
   ├─ BODY.PEEK[] で本文取得 (既読立てない)
   ├─ mailamb Worker 呼出 (AI生成)
   ├─ IMAP APPEND で Drafts に保存
   ↓
90秒後にself-fetch "/loop" でチェーン
   ↓
継続 (ギャップほぼゼロ)
```

## セットアップ

### 1. secrets 登録 (必須)

```bash
cd worker-watcher
cfauth exec -- npx wrangler secret put IMAP_HOST       # 例: sv1234.xserver.jp
cfauth exec -- npx wrangler secret put IMAP_PORT       # 993
cfauth exec -- npx wrangler secret put IMAP_USER       # info@yourcompany.com
cfauth exec -- npx wrangler secret put IMAP_PASSWORD   # 平文パスワード
cfauth exec -- npx wrangler secret put IMAP_DRAFTS     # Drafts / INBOX.Drafts / 下書き
cfauth exec -- npx wrangler secret put MAILAMB_API_KEY # mailamb Worker の X-API-Key
```

### 2. 任意: heartbeat KV (チェーン生存監視用)

```bash
cfauth exec -- npx wrangler kv:namespace create "HEARTBEAT_KV"
# → ID取得して wrangler.toml に追記:
#   [[kv_namespaces]]
#   binding = "HEARTBEAT_KV"
#   id = "<取得したID>"
```

### 3. デプロイ

```bash
cfauth exec -- pnpm run deploy
```

### 4. 動作確認

```bash
# health
curl https://mailamb-watcher.<subdomain>.workers.dev/health

# 手動でループ開始
curl https://mailamb-watcher.<subdomain>.workers.dev/loop

# tail でログ確認
cfauth exec -- npx wrangler tail --format pretty
```

## 無料枠内の消費想定

| 項目 | 消費/day | 無料枠/day |
|---|---|---|
| Workers 呼出 (loop) | ~960 (90s × 960 = 24h) | 100,000 |
| cron | 1,440 | - |
| CPU時間 (新着時のみ) | 新着数 × ~10ms | 10ms × 100,000 req |
| cloudflare:sockets 接続 | 24h 継続 | 制限なし |

全部 Free Plan 内。

## 実装の仕様

### IMAP プロトコル対応

- LOGIN (平文)
- SELECT
- UID SEARCH UNSEEN
- UID FETCH (BODY.PEEK[]) — 既読フラグ立てない
- IDLE / DONE
- APPEND
- LOGOUT
- TLS: cloudflare:sockets で port 993 implicit TLS

### 対応鯖

- ✓ Xserver (sv*.xserver.jp)
- ✓ さくら
- ✓ 独自メール鯖 (RFC 3501 準拠なら動く)
- ✓ Gmail (アプリパスワード必要、`imap.gmail.com`)
- ✓ M365 (OAuth未対応なので basic auth 必要)

### 対応 IMAP パス

- `Drafts` (RFC デフォルト)
- `INBOX.Drafts` (Xserver等)
- `下書き` (日本語ロケール)
- `[Gmail]/Drafts` (Gmail)

→ secret `IMAP_DRAFTS` で指定。

### リミット

- 1ループで最大10件新着処理
- 90秒 IDLE (Workers fetch handler 100s上限より余裕)
- 新着が90秒以内に来ない場合、IDLE終了 → 即チェーン再開

## 既存 mailamb Worker との関係

```
                  ┌─────────────────────────┐
                  │  mailamb-watcher        │
                  │  (IMAP IDLE 常駐)       │
                  └──────────┬──────────────┘
                             │ Service Binding
                             ▼
                  ┌─────────────────────────┐
                  │  mailamb                │
                  │  (AI生成 + KV管理)      │
                  └─────────────────────────┘
```

mailamb-watcher は mailamb Worker を service binding で呼び出す。
mailamb 側は既存のまま変更なし。TB拡張も既存のまま使える。

## 代替案との比較

| 構成 | 遅延 | コスト | 既存影響 | 母艦PC |
|---|---|---|---|---|
| **mailamb-watcher (この構成)** | **~1秒** | **$0** | **ゼロ** | **不要** |
| 母艦スクリプト (05-mother.ts) | ~1秒 | $0 (PC電気代) | ゼロ | 要 |
| CF Email Routing | ~5秒 | $0〜年$10 | 要ドメイン | 不要 |
| CF Cron 1分polling | 60秒 | $0 | ゼロ | 不要 |

## トラブルシュート

### IMAP接続失敗

- `IMAP_HOST` / `IMAP_PORT` secret 設定確認
- Xserver等でIMAP外部接続許可設定確認
- TLS接続のみ対応 (port 993)、STARTTLS (port 143) は現在未対応

### LOGIN失敗

- `IMAP_PASSWORD` に特殊文字 (`\`、`"`) 含まれる場合 escape 問題の可能性
- アプリパスワード必要な鯖 (Gmail、Workspace) は要発行

### Drafts 保存失敗

- `IMAP_DRAFTS` のフォルダ名が実際のパスと一致してるか確認
- `wrangler tail` で `imap > APPEND "Drafts"` のレスポンス確認
- Xserverは `INBOX.Drafts` の場合あり

### チェーン切れ

- `wrangler tail` で `loop エラー` メッセージ確認
- 1分以内に cron が復活起動する
- 連続失敗する場合は IMAP 側の問題
