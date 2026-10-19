# mailamb 管理画面

管理者用の Web UI。問い合わせ活動の閲覧、ナレッジ（定型文・過去対応）の追加・無効化、二重返信防止状態の確認ができる。

## 起動方法

**ローカルで開く**（最も簡単）:
```bash
# このディレクトリで静的サーバを起動
cd admin && python3 -m http.server 8787
# ブラウザで http://localhost:8787 を開く
```

または index.html をブラウザに直接ドラッグ&ドロップ。CORS は Worker 側で `*` 許可済み。

**Cloudflare Pages にデプロイ**（本番配布用）:
```bash
cd admin
cfauth exec -- npx wrangler pages deploy . --project-name mailamb-admin
```

## 初回設定

1. 画面右上の「設定」タブ
2. **Worker URL**: `https://mailamb.<your-subdomain>.workers.dev`
3. **API Key**: Worker にセット済みの `API_KEY` と同じ値
4. 保存 → 接続OKと出たら完了

設定はブラウザのローカルストレージに保存。PCごとに再入力が必要（意図的: キーの共有を避けるため）。

## タブ

### 問い合わせ活動
過去90日に生成された下書き一覧（受信日時降順、最大200件）:

| 列 | 内容 |
|---|---|
| 受信日時 | 問い合わせ受信時刻 |
| 件名 | 元メールの件名 |
| 送信元 | 問い合わせ者 |
| 意図 | AI が抽出した意図（先頭60文字） |
| 状態 | 未着手 / ✏返信中 (XX) / ✉送信済 (XX) |
| 既読 | 中身を開いたスタッフIDのピル |
| 操作 | 詳細（下書き本文、RAGヒット、JSON状態すべて表示） |

### ナレッジ管理
RAG検索対象の定型文・過去対応を管理:
- **新規追加**: doc_id・タイプ・タイトル・本文を入力して保存。Workers AI の embedding (bge-m3) で自動ベクトル化され、以降の問い合わせで RAG ヒット候補になる
- **無効化**: active=0 にして検索対象から外す（データは残る）

## セキュリティ

- API Key を知らないと一切操作できない
- 全エンドポイントで `X-API-Key` 必須
- 管理画面を外部にホストする場合は Cloudflare Access を前段に置くことを推奨
