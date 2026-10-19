# 06. トラブルシュート

## メール到着しない

### 症状: info@ に送っても TB に届かない

**チェック**:
1. CF Email Routing ルールが有効か:
   `https://dash.cloudflare.com/<account>/example.com/email/routing/routes`
2. `wrangler tail mailamb-email` でログ流れているか
3. Resend / 送信元のステータス確認（spam扱いの可能性）

**よくある原因**:
- `info@` ルールが OFF or 削除された
- destination address (forward@example.com) が verified 外れた
- Email Routing全体が無効化（Zoneの設定）

## 下書きが生成されない

### 症状: メールは届くが TB拡張のパネルが「このメール用のAI下書きはまだ生成されていません」

**チェック順**:
1. `wrangler tail mailamb-email` で `draft OK` が出てるか
2. 出てなければ `mailamb` 側のエラーログ: `wrangler tail mailamb`
3. KV に実際に保存されているか:
   ```bash
   cfauth wrangler kv key get --namespace-id=<ID> "draft:<msgid>"
   ```

**よくある原因**:
- Workers AI がレート制限（429）→ 時間おいて再送 or モデル切替
- Vectorize index の `vectorCount: 0` → ingest やり直し
- `MAILAMB_API_KEY` secret 未設定 or 値ズレ → `draft API 401` ログで分かる
- prefilter が skip 判定（件名「【営業】」等が入ってると落ちる）

### 症状: `prefilter` が本来返信すべきメールを skip している

- `worker/src/draft.ts` の `prefilter` 関数の判定ロジックを確認
- 件名パターンや本文パターンが過剰にマッチしていないか
- `D1 ng_senders` / `skip_senders` に誤登録ないか:
  ```bash
  cfauth wrangler d1 execute mailamb --remote --command "SELECT * FROM ng_senders"
  cfauth wrangler d1 execute mailamb --remote --command "SELECT * FROM skip_senders"
  ```

## RAG の精度が悪い

### 症状: 全然違うテンプレが top-1 に来る

- Vectorize 検索の `score` が全て 0.6 未満 → 該当テンプレ無し。新規追加検討
- 意図抽出プロンプトが曖昧 → `worker/src/draft.ts` の `extractIntent` 調整
- Embedding モデル不整合 → ingest 時と検索時のモデルが一致しているか確認（両方 `bge-m3`）

### 症状: 同じ内容でも毎回違うテンプレが選ばれる

- temperature が高い（0.3→0.1 に下げる）
- RAG の top-k を増やして複数候補出す（5→8）

## TB 拡張が動かない

### 症状: 🤖アイコンが表示されない

- 拡張が無効化されている:
  TB → 設定 → アドオンとテーマ → mailamb が有効か確認
- 署名未許可:
  `user.js` に `xpinstall.signatures.required = false` が入っているか
- TB再起動していない

### 症状: アイコン押すとエラー「401 unauthorized」

- 拡張の設定で Worker URL / API Key が正しくセットされているか
- API Key が本番の `wrangler secret put API_KEY` で設定したものと一致しているか

### 症状: 「このメールは対応していません」的な表示

- Message-ID ヘッダが取れていない:
  - 転送時にヘッダが壊れた可能性。raw source を見て確認
  - Gmail 独自の `X-Google-...` ヘッダに書き換えられていないか

## デプロイ失敗

### 症状: `wrangler deploy` が通らない

- `cfauth status` でアカウント確認（別アカウントになってない？）
- Secrets が未設定: `wrangler secret put API_KEY` 等
- D1/KV の ID が wrangler.toml に貼られてない

### 症状: D1 migration 失敗

```bash
cfauth wrangler d1 migrations list mailamb --remote
# 適用済みを確認
cfauth wrangler d1 execute mailamb --remote --command "SELECT * FROM d1_migrations"
```

## コスト超過

### 症状: Workers 無料枠（100k req/day）に近づいている

- `https://dash.cloudflare.com/<account>/workers/overview` で各Worker使用量確認
- `line-lake` 等の無関係 Worker が消費している可能性
- 一時的に Paid Plan（$5/mo）にアップグレードが安全

### 症状: Workers AI の Neurons 使用が多い

- Dashboard → Workers AI → Usage
- 対策:
  - `temperature=0` で決定的動作にする
  - 一度 draft 生成したら KV で 90日キャッシュ（実装済）
  - 短いモデルに切替（llama-3.3-70b → scout-17b）

## tail が切れる

### 症状: `wrangler tail` が 3分で `Tail disconnected`

- wrangler の仕様。再接続すれば続行可能
- 長期監視なら:
  - CF Dashboard の Logs エクスプローラー
  - Logpush 設定（R2 や外部に流す）

## 動画キャプチャが取れない

### 症状: `screencapture -v` で動画作成できない

- `-v -V N` に `-m -k -C` 等のフラグを足すと失敗する可能性
- 最小フラグで試す: `screencapture -v -V 60 /tmp/x.mov`
- 別Space上のWindowを撮りたいときは `-l <CGWindowID>` 指定
  - CGWindowID取得: Quartz APIか `cua-driver call list_windows` のwindow_id
