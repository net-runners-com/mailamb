# サンプルナレッジ

mailamb が RAG 検索に使うナレッジのサンプル。本番導入時は、お客様固有の定型文・過去対応に差し替えて利用する。

## 内容

| ファイル | 件数 | 用途 |
|---|---|---|
| `templates.json` | 9件 | 返信テンプレート（新規見積・LP制作・改修見積・SEO相談・保守運用など） |
| `past_cases.json` | 10件 | 過去対応事例（問い合わせ内容と実際の返信ペア） |
| `inquiries.json` | 15件 | 評価用の擬似問い合わせ（RAG+LLM の精度確認用） |

本リポのサンプルは **Web制作受託会社** を想定した汎用テンプレ。業種に合わせて書き直して使う。

## スキーマ

### templates.json

```json
{
  "id": "tpl-001",
  "title": "新規制作見積依頼への返信（ヒアリング要項送付）",
  "category": "新規見積依頼",
  "tags": ["コーポレート", "LP", "EC", "新規"],
  "body": "お問い合わせいただきありがとうございます。..."
}
```

### past_cases.json

```json
{
  "id": "case-001",
  "category": "新規見積依頼(コーポレート)",
  "inquiry": "弊社コーポレートサイトのリニューアルを検討しています...",
  "reply": "お問い合わせありがとうございます...",
  "outcome": "受注成功",
  "note": "ヒアリング要項を箇条書き・概算レンジ提示の型"
}
```

### inquiries.json

```json
{
  "id": "inq-001",
  "subject": "コーポレートサイトリニューアルの件",
  "from": {"name": "田中", "email": "tanaka@example.com"},
  "body": "お世話になります..."
}
```

## 使い方

### 1. 単発投入（curl）

```bash
curl -X POST https://<worker-url>/api/documents \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @- << 'JSON'
{
  "doc_id": "tpl-001",
  "type": "template",
  "title": "新規制作見積依頼への返信",
  "category": "新規見積依頼",
  "tags": ["新規"],
  "content": "お問い合わせいただきありがとうございます..."
}
JSON
```

### 2. 一括投入（スクリプト）

```bash
cd poc
pnpm run upload-to-worker
```

`06-upload-to-worker.ts` が `poc/data/*.json` を全部読んで Worker の `/api/documents` に投入する。

### 3. 管理画面から

管理画面 → ナレッジ管理 → 新規追加 で1件ずつ追加できる。

## 本番運用時のナレッジ入れ替え手順

1. お客様固有の定型文・過去対応を Markdown or JSON で揃える
2. 顧客情報（氏名・金額・電話番号など）はマスキング or 匿名化
3. 既存サンプル (`templates.json` 等) を全部無効化 or 削除:
   ```bash
   # 管理画面から1件ずつ無効化、または:
   curl -X DELETE https://<worker-url>/api/documents/tpl-001 \
     -H "X-API-Key: $API_KEY"
   ```
4. 新しいナレッジを投入

## RAG 精度を上げるコツ

- **具体的なヒアリング項目を箇条書き**で書くとヒット率上がる
- 1テンプレ 300〜800文字程度が扱いやすい（長すぎると埋め込みが散る）
- カテゴリ・タグは RAG スコアには影響しないが、管理用に設定
- 業種特有の言い回しや固有名詞を含めると精度↑
- **「該当なしフォールバック」**を1件入れておく（マッチしない時の受け皿）
