# mailamb Thunderbird 拡張 セルフチェック手順

拡張がちゃんと動くか手動で確認する手順（10分で完了）。
対象: v0.17.0

## 事前準備

- [ ] Thunderbird 158+ がインストール済み
- [ ] mailamb 拡張 v0.17.0 がインストール済み（設定→アドオンとテーマで有効化）
- [ ] 拡張の設定で:
  - [ ] Worker URL
  - [ ] API Key
  - [ ] **スタッフID**（例: `tanaka`）
  - [ ] 「新着メール受信時に AI下書きを自動で Draftsフォルダに保存する」☑
- [ ] 共有メールアカウントが TB に IMAP接続されている

---

## チェック 1: 新着メール → 自動下書き保存

1. 問い合わせ用アドレスにテストメール送信（Resend / 自分の別アカウント等）
2. 1〜2分待つ
3. **受信トレイ** に新着が届く
4. **下書きフォルダ** に `Re: <元件名>` が**自動で**出現
5. 下書き本文に AI生成の返信内容（挨拶 + ヒアリング要項 + 末尾）

**OK**: 下書きが自動で出る  
**NG**: Worker ログ `GET /api/log` で原因確認（権限・staffId未設定等）

## チェック 2: メール表示 本文バナー

1. 受信トレイで さっきの元メール開く
2. 本文の一番上に **青いバナー `🤖 AI下書き準備済`** または **緑バナー `✉️ 送信済`**
3. 右側に `👁 既読: <staffId>` ピル表示

**OK**: バナー表示  
**NG**: messageDisplayScripts 権限 or Message-ID 不一致

## チェック 3: 🤖パネル表示

1. ツールバーの 🤖 ボタンクリック
2. パネルに:
   - 件名・Message-ID
   - 意図（AI抽出）
   - 参考テンプレート5件（スコア付き、クリックで別窓全文）
   - AI下書き本文（編集可）
   - 差出人セレクタ
   - 「下書きで返信」/「Draftsに保存」/「本文コピー」/「送信済にする」

**OK**: 全セクション表示  
**NG**: Worker URL / API Key 設定確認

## チェック 4: 参考テンプレ別窓

1. パネルの参考テンプレ `[past_case] [新規見積依頼...]` などクリック
2. 820x720 の別窓で全文表示
3. Markdown が整形されて表示（見出し・箇条書き・コード）

**OK**: 全文見える  
**NG**: ポップアップブロック or `/api/documents/:id` エラー

## チェック 5: 送信フロー（二重送信防止）

**事前**: 既に `送信済み` 記録がある下書きを用意する（なければ下記ステップで作る）

1. 下書きを開く → compose窓
2. 窓が開いた瞬間、macOS右上に **通知 `⚠️ 二重返信注意`** が出る（state=repliedの時）
3. 送信ボタン クリック
4. **別窓ポップアップ `⚠️ 送信確認`** 出現
   > このメールは既に XX が YY に送信済です。もう一度送信しますか？
5. **キャンセル** → 送信中止、Compose窓はそのまま
6. **それでも送信** → 送信実行、`onAfterSend` で `replied` 更新

**OK**: ポップアップが止める  
**NG**: バックグラウンドコンソールで onBeforeSend エラー確認

## チェック 6: 他スタッフ視点（1台で擬似）

1. mailamb オプション → スタッフID を `yamada` に変更 → 保存
2. さっき `tanaka` で送信済みにしたメールを開く
3. 本文バナーに `✉️ 送信済: tanaka` が **他人**として表示
4. 下書きで返信しようとすると macOS通知 + 送信確認ポップアップで止められる

**OK**: 他スタッフの送信履歴を正しく共有  
**NG**: state永続化 or staffId 設定確認

## 開発者ツールでデバッグ

TB拡張のログを見る:

1. TBで `ツール → 開発者ツール → ブラウザコンソール`（Mac: ⇧ + ⌘ + J）
2. `[mailamb]` 付きログが流れる

リモートログ:

```bash
curl -s "$WORKER_URL/api/log" -H "X-API-Key: $API_KEY" | jq
```

## よくある失敗

| 症状 | 原因 | 対処 |
|---|---|---|
| 自動下書きが出ない | staffId未設定 | 拡張オプションで設定 |
| 下書きの Message-ID が合わない | Resend 等が SES経由で再採番 | 本番 CF Email Routing では問題なし |
| compose窓を開いた瞬間に通知出ない | 通知権限未許可 | macOS 設定で TB の通知許可 |
| 送信確認ポップアップが出ない | state 未記録 | KV に `state:<msgid>` あるか確認 |
| 送信済バッジが見えない | KV のキー不一致 | `/api/draft/by-msgid/:msgid` で確認 |
| 件名に [AI下書き] 残ってる | 旧版の下書き | 新規着信から正常化、既存は手動削除 |

## 自動チェックスクリプト

```bash
# health
curl $WORKER_URL/health

# 任意のmessage-idで取得
MID='<message-id@...>'
ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$MID")
curl "$WORKER_URL/api/draft/by-msgid/$ENC" -H "X-API-Key: $API_KEY" | jq

# 送信済み全件
curl "$WORKER_URL/api/draft/replied-ids" -H "X-API-Key: $API_KEY" | jq

# 最近のログ (過去1時間)
curl "$WORKER_URL/api/log" -H "X-API-Key: $API_KEY" | jq '.entries | .[-10:]'
```
