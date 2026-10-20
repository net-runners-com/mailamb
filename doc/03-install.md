# 03. インストール手順

**ベンダー側 (CF構築) 1〜2時間 + 管理者/送信者PC 各10分**

---

## Phase 1: Cloudflare 構築 (ベンダー側)

### 1-1. 事前準備

```bash
git clone https://github.com/net-runners-com/mailamb.git
cd mailamb/worker
npx wrangler login   # ブラウザで CF アカウント連携
```

### 1-2. CF リソース作成

```bash
# KV (state管理用)
npx wrangler kv:namespace create "PROCESSED"
# → 返される id を memo

# D1 (ナレッジメタ)
npx wrangler d1 create mailamb
# → database_id を memo

# R2 (ナレッジ本文)
npx wrangler r2 bucket create mailamb-docs

# Vectorize (RAG検索)
npx wrangler vectorize create mailamb-docs --dimensions=1024 --metric=cosine
```

### 1-3. wrangler.toml 編集

`worker/wrangler.toml` の以下を取得IDに書き換え:

```toml
[[kv_namespaces]]
binding = "PROCESSED"
id = "<1-2のKV id>"

[[d1_databases]]
binding = "DB"
database_name = "mailamb"
database_id = "<1-2のD1 id>"
```

### 1-4. D1 スキーマ初期化

```bash
npx wrangler d1 execute mailamb --file=./migrations/0001_init.sql
```

### 1-5. API Key 生成 + Secret 登録

```bash
API_KEY=$(openssl rand -hex 32)
echo "API_KEY: $API_KEY"   # 1Password 等に保管

echo -n "$API_KEY" | npx wrangler secret put API_KEY
```

### 1-6. mailamb Worker デプロイ

```bash
npx wrangler deploy
# → URL: https://mailamb.<account>.workers.dev   (memo)
```

### 1-7. 動作確認

```bash
curl https://mailamb.<account>.workers.dev/health
# → {"ok":true,"service":"mailamb","model":"..."}
```

---

## Phase 2: worker-watcher 構築

### 2-1. 顧客から IMAP情報取得

Xserver サーバーパネル → メールアカウント設定 → 設定情報:
- IMAPホスト (例: `sv1234.xserver.jp`)
- IMAPポート (993)
- アカウント名 (例: `info@yourcompany.com`)
- パスワード
- Drafts パス (`INBOX.Drafts` が多い、要実機確認)

### 2-2. Secrets 登録

```bash
cd ../worker-watcher
npx wrangler secret put IMAP_HOST
npx wrangler secret put IMAP_PORT         # 993
npx wrangler secret put IMAP_USER
npx wrangler secret put IMAP_PASSWORD
npx wrangler secret put IMAP_DRAFTS       # INBOX.Drafts
npx wrangler secret put MAILAMB_API_KEY   # 1-5の値
```

### 2-3. デプロイ

```bash
npx wrangler deploy
# → cron 毎分発火開始
```

### 2-4. 動作確認

```bash
npx wrangler tail --format pretty
# → [watcher] / [imap] greet / LOGIN / SELECT INBOX / IDLE 開始 等が流れる
```

---

## Phase 3: 管理者PCに admin拡張インストール

### 3-1. 配布物準備

ベンダーが `mailamb-admin-package-0.1.0.zip` の `設定メモ.txt` に:
- Worker URL (Phase 1-6 のURL)
- API Key (Phase 1-5の `$API_KEY`)

を記入して管理者に渡す。

### 3-2. 管理者PC作業 (10分)

ZIP解凍 → `INSTALL.md` に沿って:

1. TB プロファイルフォルダ確認
2. `user.js` に `user_pref("xpinstall.signatures.required", false);` 追加
3. `mailamb-admin-0.1.0.xpi` を `profile/extensions/mailamb-admin@mailamb.local.xpi` に配置
4. TB 完全再起動
5. アドオンマネージャで有効化確認
6. 歯車 → オプション → Worker URL + API Key 入力 → 保存

### 3-3. ダッシュボード起動

TB ツールバーの **mailamb 管理** ボタン → TB内タブでダッシュボードが開く → 右上「接続OK」確認

### 3-4. ナレッジ投入

ダッシュボード「追加」タブで:
- `.eml` / `.md` / `.txt` ファイルを drag&drop (自動パース)
- または直接入力フォーム

目安: **初期10〜30件** (templates + past_cases + 「該当なしフォールバック」1件は必須)

---

## Phase 4: 送信者PCに sender拡張配布

### 4-1. 配布物準備

管理者が `mailamb-sender-package-0.18.1.zip` の `設定メモ.txt` に:
- Worker URL (全員共通)
- API Key (全員共通)

を記入して全送信者に配布。送信者ID はスタッフ本人が記入。

### 4-2. 各送信者PC作業 (10分 × 人数)

ZIP解凍 → `INSTALL.md` に沿って:

1. TB プロファイルフォルダ確認
2. `user.js` に `user_pref("xpinstall.signatures.required", false);` 追加 (未追加なら)
3. `mailamb-0.18.1.xpi` を `profile/extensions/mailamb@mailamb.local.xpi` に配置
4. TB 完全再起動
5. アドオンマネージャで有効化確認
6. 歯車 → オプション → 3項目入力 → 保存
   - Worker URL (全員同じ)
   - API Key (全員同じ)
   - **送信者ID** (**自分で決める**、他と重複しない識別子)

### 4-3. 動作確認

- 送信者PCの SELF_CHECK.md 参照
- 共有メールに届いた問い合わせを開く → Drafts に AI下書きが入ってる
- 下書き編集 → 送信ボタン → 送信

### 4-4. 社長・管理者ロールの人

sender + admin の**両方**インストール。別IDなので同一TBに干渉なし。

---

## Phase 5: E2E動作確認

### 5-1. 疎通テスト

1. 別アドレスから `info@yourcompany.com` に問い合わせっぽいメール送信
2. 1〜2分以内に:
   - 全員のTBに届く (既存通り)
   - **Drafts フォルダに `Re: ...` 自動出現**
3. 下書き本文に AI生成の返信文が入ってる

### 5-2. 二重送信防止テスト

1. 送信者Aが Drafts の下書きを送信
2. 送信者Bが同じ元メールを開く → 本文に 🟢緑バナー `✉️ 送信済 (A)`
3. 送信者Bが「下書きで返信」クリック → compose → 送信ボタン
4. 「⚠️ 既に A が送信済です、本当に送信しますか？」ポップアップ

### 5-3. ナレッジヒット確認

管理者ダッシュボード → ナレッジタブ → 登録済み一覧確認、Worker tail で RAG スコア 0.6以上出てるか。

---

## 所要時間サマリー

| フェーズ | 所要 |
|---|---|
| Phase 1 (mailamb Worker 構築) | 30分 |
| Phase 2 (worker-watcher 構築) | 10分 |
| Phase 3 (管理者PC + ナレッジ投入) | 30分〜1時間 |
| Phase 4 (送信者PC配布 × 5名) | 50分 |
| Phase 5 (E2E確認) | 15分 |
| **合計** | **約2〜3時間** |

## コスト

**$0 / 月** (10名規模、Workers Free Plan 内)
