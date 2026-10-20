# 05. 運用・トラブルシュート

## 日常運用 (基本放置)

| 頻度 | 作業 | 担当 |
|---|---|---|
| 毎日 | なし (完全放置) | - |
| 月1 | ダッシュボードで送信履歴ざっと確認 | 管理者 |
| 必要時 | ナレッジ追加 (新 FAQ / 新案件パターン) | 管理者 |
| 年1 | IMAP パスワード変更時 Secret 更新 | 管理者 |

## ナレッジ追加のタイミング

- 新サービス/料金表が追加された
- 問い合わせパターンで対応ズレた返信が出た (元メール + 理想返信を past_cases で登録)
- 社長/担当交代で署名変わった

目安: 月数件追加 → RAG 精度が時間と共に上がる。

## トラブル対応

### ① Drafts に下書きが入らない

```bash
cd worker-watcher
npx wrangler tail --format pretty
```

パターン別:

| ログ | 原因 | 対処 |
|---|---|---|
| `LOGIN failed` | IMAP パスワード | 鯖側で確認 → `wrangler secret put IMAP_PASSWORD` 再登録 |
| `SELECT INBOX NO` | Mailbox 名違い | 鯖で `INBOX` の実名確認 |
| `connect ETIMEDOUT` | 鯖側 IP制限 | Xserver サーバーパネルで外部IP許可 |
| cron 発火しない | デプロイ失敗 | `wrangler deploy` 再実行 |
| 発火してるが新着拾わない | IDLE 来ない | 鯖の IMAP IDLE 対応確認 (Xserver は対応) |

### ② 下書きの内容が変

```bash
cd worker
npx wrangler tail --format pretty
```

- RAG スコア <0.5 ばかり → ナレッジ不足 (管理者がダッシュボードで追加)
- 社名が間違ってる → fallback ナレッジ or system prompt の社名変数確認
- 文体が変 → templates カテゴリで理想サンプル追加

### ③ 送信者ロールで送信ガードが出ない

| 症状 | 原因 | 対処 |
|---|---|---|
| 本文バナーが出ない | 設定未入力 | 歯車 → オプション → 3項目 (URL/Key/送信者ID) 入力 |
| state 問い合わせエラー | API Key 違い | `wrangler secret put API_KEY` で確認、拡張側オプションに同値設定 |
| 送信確認ポップアップが出ない | 他人送信前 → この挙動が正常 | 2人で同一メール送信テストで確認 |

### ④ ダッシュボードで「接続NG」

- Worker URL のタイプミス
- API Key 不一致
- ブラウザコンソール (TB は `Ctrl+Shift+I`) で CORS/認証エラー確認

### ⑤ 二重送信事故

事故後の確認:

```bash
cd worker
npx wrangler kv:key list --binding=PROCESSED | grep replied
```

該当 msgid の履歴確認、ダッシュボード「送信履歴」でも同じ情報。

### ⑥ KV 書き込み枠超過 (1,000/day)

ほぼ無い想定だが、万一枠超えたら:
- CF ダッシュボードで Workers Paid Plan ($5/月) に上げる → 枠10倍以上
- または Workers KV 専用の Paid add-on

## ログ・監視

### リアルタイム tail

```bash
# 2 ターミナル開いて並行監視
cd worker && npx wrangler tail --format pretty
cd worker-watcher && npx wrangler tail --format pretty
```

### 送信履歴 UI

TB ツールバー → mailamb 管理 → 送信履歴タブ

### CF ダッシュボード

- Workers > mailamb / mailamb-watcher > ログ
- Workers AI > 使用量
- Vectorize > クエリ数

## バックアップ

### ナレッジ

```bash
cd worker
npx wrangler d1 export mailamb --output=knowledge-backup-$(date +%Y%m%d).sql
```

R2 の .md ファイルも別途バックアップ推奨:

```bash
npx wrangler r2 object list mailamb-docs
# 必要なら one-shot で全DL
```

### state (KV)

replied 情報は 90 日 TTL なのでバックアップ不要 (消えても次回から再記録)。

## 停止・アンインストール

### 一時停止 (worker-watcher だけ止める)

```bash
cd worker-watcher
npx wrangler deployments list
# cron 無効化は wrangler.toml から [[triggers]] 削除 → deploy
```

→ Drafts に下書き入らなくなるだけ、既存メール運用は無影響。

### 完全削除

```bash
# 1. CF 側
cd worker-watcher && npx wrangler delete
cd ../worker && npx wrangler delete
npx wrangler kv:namespace delete --namespace-id=<id>
npx wrangler d1 delete mailamb
npx wrangler r2 bucket delete mailamb-docs
npx wrangler vectorize delete mailamb-docs

# 2. 各PC
# TB アドオンマネージャ → mailamb — 送信者 削除
# TB アドオンマネージャ → mailamb — 管理者ダッシュボード 削除
```

→ 既存メール環境に何も残らない (DNS無変更、MX無変更なので当然)。

## 障害時の優先順位

1. 既存メールが届いているか (= Xserver 等が生きてるか) 確認
2. 届いてるなら mailamb の問題なので worker-watcher 止める判断
3. 下書き未生成でも手動で返信可能 (元運用に戻るだけ)

**mailamb が壊れても業務は止まらない設計**。あくまで「下書きまで自動化」の補助ツール。

## 更新 (リポのアップデート取り込み)

```bash
cd mailamb
git pull origin main

# Worker 更新
cd worker && npx wrangler deploy
cd ../worker-watcher && npx wrangler deploy

# 拡張更新
# addon/, addon-admin/ のパッケージ再生成 (手順はリポの scripts/ 参照)
# 配布 → 各PCで .xpi 差し替え → TB再起動
```
