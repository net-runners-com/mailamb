# mailamb — 共有メール AI 自動下書きシステム (minimal)

複数スタッフが共有する問い合わせ用メール (例: `info@yourcompany.com`) に届いた問い合わせに対して、Cloudflare Workers AI が RAG+LLM で返信下書きを自動生成し、各スタッフの Thunderbird に自動配信。

## 特徴

- ✓ 既存メール鯖 (Xserver / さくら / 独自鯖 / Workspace / M365) に **無影響**
- ✓ **MX / DNS 変更なし、新規ドメイン追加なし、母艦PC不要**
- ✓ **完全無料** (Workers Free Plan 内で成立、10名規模想定)
- ✓ 新着検知 **最大5秒遅延** (実質リアルタイム)
- ✓ **二重送信防止** (スタッフ間で送信状態を共有)
- ✓ AIは下書きまで、送信は必ず人間が判断

## 構成 (4コンポーネント)

```
顧客メール → Xserver (既存)
              ├─► 全スタッフ Thunderbird (既存通り)
              │
              └─► IMAP 直接接続 (TLS)
                     │
                     ▼
              [worker-watcher]       ← CF Workers 常駐 (IMAP IDLE)
                     ├─► 新着検知
                     ▼
              [mailamb Worker]       ← CF Workers (AI生成 + state)
                     ├─ RAG + LLM
                     ├─ KV state管理
                     ▼
              IMAP APPEND → 共有Drafts
                     ↓
              全スタッフ TB 同期で見える
                     ↓
              スタッフが編集 → 送信
                     ↓
              [addon] TB拡張         ← 送信前確認 + 送信済み記録

              [addon-admin] TB拡張   ← 管理者ダッシュボード
                                       (ナレッジCRUD + 送信履歴)
```

## クイックスタート (構築手順)

### 1. Cloudflare アカウント準備 (無料)
```bash
# 新規なら https://dash.cloudflare.com/sign-up
git clone https://github.com/net-runners-com/mailamb.git
cd mailamb/worker
npx wrangler login
```

### 2. CF リソース作成
```bash
npx wrangler kv:namespace create "PROCESSED"
npx wrangler d1 create mailamb
npx wrangler r2 bucket create mailamb-docs
npx wrangler vectorize create mailamb-docs --dimensions=1024 --metric=cosine
# → id を wrangler.toml に書く
npx wrangler d1 execute mailamb --file=./migrations/0001_init.sql
```

### 3. API Key + mailamb Worker デプロイ
```bash
API_KEY=$(openssl rand -hex 32)
echo -n "$API_KEY" | npx wrangler secret put API_KEY
npx wrangler deploy
```

### 4. worker-watcher デプロイ
```bash
cd ../worker-watcher
npx wrangler secret put IMAP_HOST       # sv1234.xserver.jp
npx wrangler secret put IMAP_PORT       # 993
npx wrangler secret put IMAP_USER       # info@yourcompany.com
npx wrangler secret put IMAP_PASSWORD
npx wrangler secret put IMAP_DRAFTS     # INBOX.Drafts
npx wrangler secret put MAILAMB_API_KEY # 3の API_KEY と同じ
npx wrangler deploy
```

### 5. 管理者PCに addon-admin インストール
`mailamb-admin-0.1.0.xpi` を TB プロファイルに配置、設定でWorker URL + API Key。
TB内タブでダッシュボードが開く → ナレッジ追加 (ファイルUP or 直接入力)。

### 6. 各スタッフPCに addon 配布
`mailamb-staff-package-0.18.0.zip` を解凍、INSTALL.md に沿って各PC 10分。
3項目設定: Worker URL / API Key / スタッフID。

**所要時間 2〜3時間、月額 $0**。

## ディレクトリ

```
mailamb/
├── README.md
├── 構成図.md                          mermaid 全体図
├── mailamb-{faq,flow,oneshot}.md     顧客向け説明資料
├── mailamb-staff-package-0.18.0.zip  スタッフ配布パッケージ (.xpi + 手順書)
├── mailamb-admin-0.1.0.xpi           管理者用TB拡張
│
├── worker/                           ★ mailamb Worker (AI生成 + state管理)
│   ├── src/
│   ├── migrations/0001_init.sql
│   └── wrangler.toml
├── worker-watcher/                   ★ CF常駐 IMAP IDLE監視
│   ├── src/{index,imap,parser}.ts
│   └── wrangler.toml
├── addon/                            ★ スタッフ用TB拡張 (送信ガード)
│   ├── manifest.json
│   ├── background.js
│   └── ui/
└── addon-admin/                      ★ 管理者用TB拡張 (ダッシュボード)
    ├── manifest.json
    ├── background.js
    └── ui/
```

## 技術スタック

| 層 | 技術 |
|---|---|
| LLM | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI) |
| Embedding | `@cf/baai/bge-m3` (1024次元) |
| ベクトル検索 | Cloudflare Vectorize |
| ナレッジメタ | Cloudflare D1 |
| ナレッジ本文 | Cloudflare R2 |
| 状態管理 | Cloudflare KV |
| IMAP (Watcher) | cloudflare:sockets + Minimal IMAP Client (自前) |
| TB拡張 | Thunderbird 158+ WebExtension (未署名) |

## コスト

**$0 / 月** (10名規模、日30件問い合わせ想定、Workers Free Plan 内)

| サービス | 消費/day | 無料枠 |
|---|---|---|
| Workers requests | ~1,500 | 100,000/day |
| Workers AI (生成+embed) | ~100 neurons | 10,000/day |
| Vectorize queries | ~250 | 無料1,000万/月 |
| KV writes | ~30 (送信時) | 1,000/day |
| cloudflare:sockets | 24h継続 | 無制限 |

## ライセンス

社内配布向けプライベート実装。
