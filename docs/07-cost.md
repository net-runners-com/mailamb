# 07. コスト

## 現状（PoC、2026-10時点）

実測ベース：

| 項目 | 月額想定 | 根拠 |
|---|---|---|
| Workers 本体 | **$0** | Free Plan 100,000 req/day で足りる（10名×30通×30日=9,000req/月） |
| Workers AI | **$0〜数ドル** | llama-3.3-70b は Free Plan で 10,000 Neurons/day 枠。1件生成で数十Neurons |
| Vectorize | **$0** | 無料枠 500万 queried vector dims/月で足りる |
| D1 | **$0** | 無料枠 5GB storage / 5M rows read/day |
| R2 | **$0** | 無料枠 10GB storage |
| KV | **$0** | 無料枠 1000 writes/day / 100k reads/day |
| Email Routing | **$0** | 送受信ともに無料 |
| **合計** | **$0〜$5/月** | — |

## 将来の課金想定

### 問い合わせ件数が増えた場合

| 1日の件数 | 月総req | 課金プラン必要 | 月額目安 |
|---|---|---|---|
| 〜30件 | ~900 | Free | $0 |
| 30〜300件 | ~9,000 | Free | $0 |
| 300〜3,000件 | ~90,000 | Workers Paid Plan | $5/月 + Workers AI従量 |
| 3,000〜 | ~90,000+ | 要スケーリング設計 | $20〜 |

### Workers AI 従量課金（Paid Plan時）

llama-3.3-70b 概算：
- 入力トークン: ~1,000（意図抽出）+ ~3,000（RAG+プロンプト）= 4,000
- 出力トークン: ~500
- 1件あたり: 約 50 Neurons
- 1 Neuron = $0.000011 → 1件あたり **~$0.00055**（0.08円）
- 月1,000件 → **~$0.5**（約75円）
- 月10,000件 → **~$5**（約750円）

bge-m3 Embedding:
- 1件あたり ~0.3 Neurons（極小）
- 月10,000件 → **~$0.03**

### Vectorize

- 10,000 vector × 1,024 dim = 10M dimensions
- 無料枠: 500M queried vector dims/月 → 問い合わせ月10万件まで余裕

### R2

- 原本テンプレ100件 × 10KB = 1MB → 無料枠10GBの0.01%
- 生成ログ月1,000件 × 2KB = 2MB → 無視できる

## コスト削減策

### 1. 下書き結果キャッシュ

同じメールが複数回届いた時は再生成せず KV から返す（90日キャッシュ）。実装済。

### 2. モデル選択

| モデル | 日本語品質 | コスト | 速度 |
|---|---|---|---|
| llama-3.3-70b-fp8-fast | ○ | 中 | 高速 |
| qwen2.5-72b | ◎ | 中 | 普通 |
| llama-4-scout-17b | △ | **低** | 高速 |

スタッフが編集前提なら軽量モデルで十分。

### 3. 不要なテスト削減

- `pnpm all` でPoC回すと19件 embedding + 15件生成 = 34 Workers AI call
- Prod環境でむやみに走らせない

### 4. ドキュメント再登録を避ける

Embedding モデルを変えない限り、同じテンプレを何度も POST /api/documents しない。更新時だけ送る。

## 他の候補 (運用方針変更)

### Anthropic / OpenAI API 直叩き

Cloudflare Workers AI の代わりに Claude Sonnet や GPT-4o を使う場合：
- 月1,000件で $3〜$10 程度（モデル依存）
- 品質は圧倒的に高い
- 問い合わせ回数少ない内はこちらが安いこともある
- Workers から HTTP で叩くだけなので実装は10行追加

### 完全自前（Ollama等）

社内PCで Ollama 動かす案は：
- 初期費: 開発工数 & サーバ代
- ランニング: 電気代だけ
- 10名規模ならオーバースペック、推奨しない

## 月次モニタリング

管理者が月1回確認：

1. **CF Dashboard → Workers Overview** で今月の req 推移
2. **Workers AI → Analytics** で Neurons 消費
3. **D1 → Metrics** で storage サイズ
4. **R2 → Metrics** で Egress（インターネット転送量、重要）

$5/月を超えそうなら Paid Plan 化検討。

## 請求ダッシュボード

```
https://dash.cloudflare.com/<account>/billing/overview
```

課金アラート設定推奨:
```
Dashboard → Billing → Alerts → +Budget Alert
→ Monthly budget: $10 (警告閾値)
```
