# mailamb-watcher

Cloudflare Workers で IMAP IDLE 55秒 窓を 1分ごとに開く "サーバーレス母艦"。

## これで何ができる

- ✓ **実質リアルタイム検知** (最大5秒遅延)
- ✓ **完全無料** (Workers Free Plan のみ)
- ✓ **既存ドメイン無影響** (CF Email Routing不要、DNS操作ゼロ)
- ✓ **母艦PC不要** (CF 内で完結)
- ✓ **既存メール鯖 (Xserver等) そのまま**
- ✓ **シンプル実装** (chain/heartbeatなし、cron単体で完結)

## 動作原理

```
cron 毎分 発火
   ↓
scheduled handler
   ↓
IMAP接続 (TLS, port 993)
   ├─ 既存のUNSEEN処理
   └─ 55秒 IDLE で push 待機
       └─ EXISTS push → 新着を即処理
   ↓
切断
   ↓
次の cron (60秒後) で次の窓
```

**ギャップ 最大5秒** (cron 60秒 - IDLE 55秒 = 5秒)。
cronのズレも吸収すると実質 2〜5秒遅延で検知。

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

### 2. デプロイ

```bash
cfauth exec -- pnpm run deploy
```

### 3. 動作確認

```bash
# health
curl https://mailamb-watcher.<subdomain>.workers.dev/health

# tail でログ確認
cfauth exec -- npx wrangler tail --format pretty
```

## 無料枠内の消費想定 (10名規模、日30件問い合わせ)

| 項目 | 消費 | 無料枠 |
|---|---|---|
| Workers 呼出 (cron毎分) | 1,440/day | 100,000/day → 1.5% |
| CPU時間 (処理分のみ) | ~1秒/day合計 | 10ms × 100,000/day → 余裕 |
| Workers AI (生成+embed) | ~60 neurons/day | 10,000/day → 0.6% |
| Vectorize queries | ~150/day | 無料30M/月 → 0.001% |
| KV writes | ~150/day | 1,000/day → 15% |
| cloudflare:sockets 接続 | 24h継続 | 制限なし |

**完全無料枠内**。急な大量着信 (日200件超) で KV writes 到達リスクある場合のみ Paid ($5/月) 検討。

## 実装スペック

- **行数**: 約130行 (index.ts) + 150行 (imap.ts) + 150行 (parser.ts)
- **chain/heartbeat/service binding**: 使わない
- **単一 handler** (scheduled のみ)
- **1接続 1窓**: cron シリアル実行で二重接続リスクなし

### IMAP プロトコル対応

- LOGIN (平文)
- SELECT
- UID SEARCH UNSEEN
- UID FETCH (BODY.PEEK[]) ← 既読立てない
- IDLE / DONE (RFC 2177)
- APPEND
- LOGOUT
- TLS: cloudflare:sockets で port 993 implicit TLS

### 対応鯖

- ✓ Xserver (sv*.xserver.jp)
- ✓ さくら
- ✓ 独自メール鯖 (RFC 3501 準拠)
- ✓ Gmail (アプリパスワード必要、`imap.gmail.com`)
- ✓ M365 (basic auth のみ、OAuth未対応)

### 対応 Drafts フォルダパス

- `Drafts` (デフォルト)
- `INBOX.Drafts` (Xserver等多い)
- `下書き` (日本語ロケール)
- `[Gmail]/Drafts` (Gmail)

→ secret `IMAP_DRAFTS` で指定。

## 障害時の挙動

| シナリオ | 挙動 |
|---|---|
| IMAP接続失敗 | その cron 窓はスキップ、次の cron で再試行 (最大1分遅延) |
| 処理中のクラッシュ | 未処理メールは UNSEEN のまま、次の cron で処理 |
| Workers CF障害 | 既存メール運用は無事、新規下書きだけ止まる |
| Xserver鯖障害 | スタッフ送受信も止まる (mailambの問題ではない) |

**単一障害点は cron のみ** (CF edge 自体)。実運用では年数回の数分障害。

## 既存 mailamb Worker との関係

```
┌─────────────────────┐
│  mailamb-watcher    │ ← このWorker
│  (IMAP IDLE 窓)     │
└──────────┬──────────┘
           │ Service Binding
           ▼
┌─────────────────────┐
│  mailamb            │ ← 既存のまま
│  (AI生成 + KV管理)  │
└─────────────────────┘
```

TB拡張も既存のまま使える。watcher が Drafts に保存したものを TB は普通に IMAP同期で取得。

## 代替案との比較

| 構成 | 遅延 | コスト | 既存影響 | 母艦PC | 実装複雑さ |
|---|---|---|---|---|---|
| **mailamb-watcher (B版)** | 最大5秒 | $0 | ゼロ | 不要 | 低 |
| 母艦スクリプト | ~1秒 | $0 (PC電気代) | ゼロ | **要** | 中 |
| CF Email Routing | ~5秒 | 年$10 or 既存ドメイン | **要ドメイン** | 不要 | 中 |
| chain方式 (旧) | ~0秒 | $0 | ゼロ | 不要 | **高** |

## トラブルシュート

### IMAP接続失敗

- `IMAP_HOST` / `IMAP_PORT` 確認
- Xserver等でIMAP外部接続許可設定を確認
- TLS接続のみ対応 (port 993)、STARTTLS (port 143) は未対応

### LOGIN失敗

- `IMAP_PASSWORD` に特殊文字 (`\`、`"`) 含まれる場合 escape 問題
- Gmail/Workspace は アプリパスワード必要

### Drafts 保存失敗

- `IMAP_DRAFTS` のフォルダ名が実パスと一致してるか確認
- `wrangler tail` で `[imap] > APPEND "..."` のレスポンス確認

### 検知遅延が大きい

- cron 1分間隔が上限。これより短くは不可
- 大きなラグ (5秒超) が続くなら Workers 側 CPU/メモリ枠確認
