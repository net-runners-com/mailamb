# 04. 運用手順

日常運用で管理者が行う作業。

## 定型文（テンプレート）の追加・編集

### API 経由（本番）

```bash
curl -X POST https://mailamb.<subdomain>.workers.dev/api/documents \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "doc_id": "tpl-ec-001",
    "type": "template",
    "title": "ECサイト新規制作見積（ヒアリング要項）",
    "category": "新規見積依頼",
    "tags": ["EC", "ECサイト", "新規"],
    "content": "# ECサイト新規制作見積\n\nカテゴリ: 新規見積依頼\n\n---\n\nお問い合わせありがとうございます...（本文）"
  }'
```

既存の `doc_id` を指定して POST すると**上書き更新**。Vectorizeの旧ベクトルは自動削除→再登録。

### 削除（ソフトデリート）

```bash
curl -X DELETE https://mailamb.<subdomain>.workers.dev/api/documents/tpl-ec-001 \
  -H "X-API-Key: <API_KEY>"
```

`active=0` にセット。RAG検索から除外されるがデータは残る。

### 一覧

```bash
curl https://mailamb.<subdomain>.workers.dev/api/documents \
  -H "X-API-Key: <API_KEY>"
```

## 過去対応ログの追加

送信済みの返信を資産化：

```bash
curl -X POST https://mailamb.<subdomain>.workers.dev/api/documents \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "doc_id": "case-$(date +%Y%m%d)-01",
    "type": "past_case",
    "title": "[既存改修] XXX株式会社サイトリニューアル",
    "category": "既存サイト改修",
    "content": "# [カテゴリ] タイトル\n\n## 問い合わせ\n（原文）\n\n## 返信\n（送信した返信）\n\n## 結果\n（受注/キャンセル等）"
  }'
```

**運用のコツ**: 月1回まとめて棚卸し、良い返信例を past_case 化すると、RAG精度が蓄積的に上がる。

## NG顧客の登録

迷惑顧客やクレーム対応中の顧客を自動返信対象から外す：

```bash
# D1 コンソール経由
cfauth wrangler d1 execute mailamb --remote --command \
  "INSERT INTO ng_senders (email, reason, added_at) VALUES ('spam@example.com', '営業過剰', unixepoch())"
```

または sql ファイル経由:
```bash
cat > /tmp/ng.sql <<'SQL'
INSERT INTO ng_senders (email, reason, added_at) VALUES
  ('xxx@example.com', '過去クレーム', unixepoch()),
  ('yyy@example.com', '継続契約交渉中', unixepoch());
SQL
cfauth wrangler d1 execute mailamb --remote --file=/tmp/ng.sql
```

## スタッフ追加（Phase 2 以降）

**前提**: 各スタッフが Gmail (または他プロバイダ) を持っている。

1. Dashboard → Email → Routing → Destination addresses で各スタッフのメアドを verified に登録（各自が受信した確認メールのリンクをクリックして承認）
2. `worker-email/wrangler.toml` の `FORWARD_TO` にカンマ区切りで追加:
   ```
   FORWARD_TO = "a@staff.com,b@staff.com,c@staff.com"
   ```
3. `cfauth wrangler deploy` で再デプロイ
4. 各スタッフPCで Thunderbird + mailamb拡張をセットアップ（[docs/03](./03-setup.md) 参照）

## ログ確認

### リアルタイム Worker ログ

```bash
cd worker-email
cfauth wrangler tail mailamb-email --format=pretty
# 別ターミナルで
cd worker
cfauth wrangler tail mailamb --format=pretty
```

テスト送信してログが流れるか確認。

### 使用テンプレ統計

```bash
cfauth wrangler d1 execute mailamb --remote --command \
  "SELECT doc_id, COUNT(*) as uses FROM template_usage GROUP BY doc_id ORDER BY uses DESC"
```

**鮮度判定**:
- 使用0件のテンプレ → 削除候補
- 使用件数多いが編集率も高いテンプレ → 内容見直し

### 生成失敗の調査

```bash
# KVから最近の処理済みID確認
cfauth wrangler kv key list --namespace-id=<PROCESSED_ID> | head -20

# 特定msgidの状態
cfauth wrangler kv key get --namespace-id=<PROCESSED_ID> "<msgid>"
```

## モデル切替

LLM の性能・コストを変えたい時：

1. `worker/wrangler.toml` の `GEN_MODEL` を変更
   - 現在: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
   - 候補: `@cf/qwen/qwen2.5-72b`, `@cf/meta/llama-4-scout-17b-16e-instruct`
2. `cfauth wrangler deploy`

Embedding 変更時はドキュメント全再登録が必要（次元数が変わるため）。

## バックアップ

### D1

```bash
cfauth wrangler d1 export mailamb --remote --output=/tmp/mailamb-$(date +%Y%m%d).sql
```

### R2

```bash
# bucketの中身をローカルに丸ごとDL
cfauth wrangler r2 object list mailamb-docs
# 個別取得
cfauth wrangler r2 object get mailamb-docs/templates/tpl-001.md > /tmp/tpl-001.md
```

月1でこの2つをバックアップ推奨。

## 緊急時：全停止

パイプラインを一時的に止めたい時：

1. **Email Routingルール無効化**: Dashboard → Email → Routing → `info@` ルール → OFF
2. この間、問い合わせメールは何も処理されず（宛先無しで Rejected or bounceになる）
3. 復旧: ON に戻す

スタッフにはSlackで告知推奨。

## バージョンアップ

```bash
cd worker
# コード編集後
cfauth wrangler deploy

cd ../worker-email
cfauth wrangler deploy

# ロールバック
cfauth wrangler rollback  # 直前バージョンに戻す
```
