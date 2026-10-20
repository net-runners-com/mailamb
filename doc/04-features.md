# 04. 機能一覧

## 1. worker-watcher (CF Workers)

| 機能 | 詳細 |
|---|---|
| IMAP TLS 常時接続 | cloudflare:sockets で port 993 に接続 |
| cron 発火 | 毎分 (CF Free Plan 最短) |
| IDLE 窓 55秒 | 1 回の起動で ~55秒 IDLE 保持 |
| 新着検知 | IMAP IDLE の `EXISTS` push 受信 |
| UID SEARCH UNSEEN | 未処理メッセージ検索 |
| BODY.PEEK[] | 既読フラグ変えずに本文取得 |
| 下書き生成要求 | mailamb Worker /api/draft に POST |
| IMAP APPEND | 返信文を Drafts に書き込み |

## 2. mailamb Worker (CF Workers)

### REST API

| エンドポイント | 用途 |
|---|---|
| `GET /health` | 疎通確認 |
| `POST /api/draft` | 下書き生成 (RAG + LLM) |
| `GET /api/draft/state?msgid=...` | state確認 (replied/claimed) |
| `POST /api/draft/state` | state書き込み |
| `GET POST DELETE /api/documents` | ナレッジCRUD |
| `GET /api/admin/activity` | 送信履歴 (state=replied 一覧) |

### 内部処理

| 機能 | 技術 |
|---|---|
| 意図抽出 | Workers AI (llama-3.3-70b) |
| embedding | @cf/baai/bge-m3 (1024次元) |
| ベクトル検索 | Vectorize cosine 類似度 |
| ナレッジ本文取得 | R2 |
| ナレッジメタ検索 | D1 (SQLite) |
| LLM生成 | llama-3.3-70b-instruct-fp8-fast |
| state管理 | KV (replied TTL 90日) |
| API認証 | Bearer token (API_KEY secret) |

## 3. addon (送信者拡張)

### 送信ガード

| 機能 | 挙動 |
|---|---|
| 本文バナー | メール開いた瞬間に state 問い合わせ、送信済なら 🟢緑バナー |
| onBeforeSend | 送信直前に state再確認、他人送信済なら確認ポップアップ |
| onAfterSend | 送信成功時 state=replied を KV に記録 (送信者ID付き) |
| 件名プレフィックス削除 | 不要 (件名いじらない方針) |

### 設定項目

| 項目 | 保存先 |
|---|---|
| Worker URL | browser.storage.local |
| API Key | browser.storage.local |
| 送信者ID | browser.storage.local (**個人ごと**) |

### 権限

`messagesRead` / `compose` / `accountsRead` / `storage` / `<all_urls>`

## 4. addon-admin (管理者拡張)

### ダッシュボード (TB内タブ)

4 タブ構成:

| タブ | 機能 |
|---|---|
| **ナレッジ** | 登録済み一覧、検索、削除 |
| **追加** | ファイル drag&drop (.eml/.md/.txt/.html)、手動入力 |
| **送信履歴** | state=replied の一覧 (誰が/いつ/どのメールに返信したか) |
| **設定** | Worker URL / API Key / 疎通テスト |

### ファイルパース (追加タブ)

| 形式 | 処理 |
|---|---|
| `.eml` | RFC 5322 パース、ヘッダ+本文抽出、MIME encoded-word デコード |
| `.md` / `.txt` | そのまま本文 |
| `.html` | タグ除去して本文 |

ドロップしたファイル名から title 自動生成、本文プレビュー表示、カテゴリ (templates/past_cases/products/policies/misc) 選択後 /api/documents POST。

### ツールバー起動

TB ツールバーに「mailamb 管理」ボタン追加 → クリックで TB内タブ (not別窓) 開く。

## 5. 既存メール環境との共存

| 項目 | 挙動 |
|---|---|
| 既存 IMAP同期 | 無影響、各 TB が通常通り受信 |
| 既存 SMTP送信 | 無影響、各 TB が通常通り送信 |
| 既存 Drafts | 共有、addon-watcher が追加書き込みのみ |
| 既読/未読 | BODY.PEEK[] なので勝手に既読化しない |
| 既存 TB拡張 | 無影響 (別ID名前空間) |

## 6. 二重送信防止ロジック

```
state=replied by X が KV に居る時:
  同じ元メールを他人Y が開く → 本文バナー 🟢緑 "✉️ 送信済 (X)"
  Y が「下書きで返信」クリック → compose
  Y が送信ボタン → onBeforeSend で確認ポップアップ
    "⚠️ 既に X が送信済です。本当に送信しますか？"
    - キャンセル (推奨)
    - 送信する (重複送信を承知)
```

同じ Message-ID (元メール) に対して複数 state を保持しない (replied が最新で上書き)。

## 7. ナレッジRAG仕組み

```
ユーザメール本文
    ↓ 意図抽出プロンプト
"顧客が XX の見積もりを依頼"
    ↓ embedding (bge-m3)
[0.12, -0.34, ..., 0.56]  (1024次元)
    ↓ Vectorize 類似度検索 top-5
scores = [0.78, 0.65, 0.62, 0.51, 0.42]
    ↓ 閾値 0.5 以上の chunk を抽出
    ↓ R2 から該当文書本文取得
    ↓ LLM に投げる (元メール + ナレッジ + 社名 + 署名)
AI生成の返信文
```

## 8. 無料枠内の運用

10名、1日 50件問い合わせ想定:

| リソース | 使用量 | 枠 |
|---|---|---|
| worker-watcher cron | 1,440 req/day | 100,000/day |
| mailamb /api/draft | ~50 req/day | 100,000/day |
| mailamb /api/draft/state | ~500 req/day (全員が本文開く毎) | 100,000/day |
| KV writes (replied) | ~50 writes/day | 1,000/day |
| Workers AI neurons | ~500/day | 10,000/day |
| Vectorize query | ~50/day | ~100,000/day |
| D1 reads | ~500/day | 5,000,000/day |
| R2 storage | <100MB | 10GB |

**全項目で枠の 10% 以下**。
