# 02. 必要なツール

## 構築担当者 (ベンダー / 技術者) 側

### 開発環境

| ツール | バージョン | 用途 |
|---|---|---|
| **Node.js** | 20+ | wrangler 実行 |
| **pnpm** or **npm** | 最新 | パッケージ管理 |
| **git** | 任意 | リポクローン |
| **wrangler CLI** | 4.x | Cloudflare デプロイ (`npm i -g wrangler` または `npx wrangler`) |
| **openssl** | 任意 | API Key 生成 (`openssl rand -hex 32`) |
| **curl** | 任意 | 動作確認用 |

### Cloudflare アカウント

- https://dash.cloudflare.com/sign-up で**無料プラン**作成
- クレジットカード不要
- Workers / Workers AI / Vectorize / D1 / R2 / KV が無料枠で使える
- 既存アカウント流用可

### IDE / エディタ

- VSCode / Cursor / 任意 (特別な要件なし)
- TypeScript 対応推奨 (型確認したい場合)

## 顧客 (管理者/送信者) 側

### 送信者 (全員)

| ツール | バージョン | 用途 |
|---|---|---|
| **Thunderbird** | 158+ | メールクライアント (拡張の動作対象) |
| 既存のメールアカウント | - | 共有IMAPでアクセス可能なこと |

### 管理者 (追加で必要)

| ツール | バージョン | 用途 |
|---|---|---|
| **Node.js** | 20+ | wrangler 実行用 |
| **wrangler CLI** | 4.x | mailamb Worker / worker-watcher の再デプロイ、Secret 変更、tail でログ監視 |
| **thunderbird-cli** (任意) | 最新 | CLI/MCP 経由で TB 操作。参考: https://glama.ai/mcp/servers/vitalio-sh/thunderbird-cli |
| **git** (任意) | - | リポ更新を pull する場合 |

管理者が触るのは:
- Worker 側の設定変更 (IMAP パスワード変わった時など)
- ナレッジ投入 (dashboard から)
- 障害時の tail / 再デプロイ

### 既存メール鯖の条件

| 条件 | 確認方法 |
|---|---|
| **IMAP SSL (port 993)** 対応 | 鯖の設定画面で確認 |
| 外部IPからのIMAP接続許可 | Xserver等はデフォルトON |
| IMAP APPEND でDraftsに書き込み可能 | 通常は可能 |

対応鯖:
- Xserver (sv*.xserver.jp)
- さくらのレンタルサーバ
- 独自メール鯖 (RFC 3501 準拠)
- Google Workspace (アプリパスワード必要)
- M365 (basic auth 可能なら)

### 配布物 (ベンダーから受け取る)

| ファイル | 配布先 |
|---|---|
| `mailamb-sender-package-0.18.1.zip` | 全員 (送信者ロール) |
| `mailamb-admin-package-0.1.0.zip` | 管理者ロールのみ |

## 当社内の運用ツール (ベンダー向け、任意)

| ツール | 用途 |
|---|---|
| **cfauth** | Cloudflare アカウント切替 (`cfauth exec -- npx wrangler ...`) |
| **1Password** | API Key / 顧客 IMAPパスワード 保管 |
| **GitHub** | リポ管理、PR レビュー |

## 情報の受け渡し (構築フェーズ)

ベンダー → 管理者:
- `mailamb-admin-package-0.1.0.zip`
- 設定メモ (Worker URL + API Key を記入済)

管理者 → 全送信者:
- `mailamb-sender-package-0.18.1.zip`
- 設定メモ (Worker URL + API Key を記入済、送信者ID は各自記入欄)

**顧客ドメインの DNS / Xserver 管理画面触る権限は不要** (DNS変更しない構成なので)。

## 依存バージョン詳細

- Thunderbird 158+: `messageDisplayScripts`、`compose.onBeforeSend`、`messages.import` 等の API が必要
- Workers compat date: `2026-10-01` 以降 (cloudflare:sockets 対応)
- Workers nodejs_compat フラグ: 有効 (worker-watcher で使用)
