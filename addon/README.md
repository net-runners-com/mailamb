# mailamb Thunderbird 拡張

共有IMAPメール運用でAI下書きを扱う Thunderbird 拡張。

## バージョン
v0.17.0 (2026-10-19)

## 機能

### 新着メール自動処理
- `onNewMailReceived` で新着検知 → KV照会
- KV未存在ならその場で `/api/draft` を叩き生成
- `messages.import` で compose窓を開かずに Drafts に直接注入
- 複数TB同時発火でも `/api/draft/imap-saved/:msgid` claim で重複保存を防止
- 15秒間隔の retry queue で生成API失敗や遅延に備える
- 問い合わせ宛先リスト設定で対象を限定可能（空欄なら全着信対象）

### メール表示時の状態共有
- `messageDisplayScripts` で本文先頭にバナー注入:
  - `🤖 AI下書き準備済` (青)
  - `✏️ 返信中: <staff>` (黄)
  - `✉️ 送信済: <staff>` (緑)
- 👁 既読: パネル or バナー open 時にスタッフID自動POST
- 他スタッフが開いた履歴がピル表示

### 下書きパネル
- 🤖ボタンで表示
- AI抽出意図・RAGヒット5件・下書き本文・差出人セレクタ・既読者
- RAGヒットをクリックで別窓に全文表示（Markdownレンダ付き）
- 「下書きで返信」/「Draftsに保存」/「本文コピー」/「送信済にする」ボタン

### 二重送信防止 (4段構え)
1. 元メール開く → 本文先頭バナー
2. 🤖パネル → 上部バッジ
3. compose窓開く → macOS 通知 `⚠️ 二重返信注意`
4. **送信ボタン → 別窓ポップアップ確認**（唯一の送信ブロック点）
   - 「それでも送信」/「キャンセル」
   - 60秒応答なしで自動キャンセル

### 送信前後の自動処理
- `onBeforeSend` で件名の `[AI下書き]` プレフィックス自動削除（旧版残骸対策）
- `onBeforeSend` で元メールstate確認 → replied/他スタッフclaimedなら送信確認ポップアップ
- `onAfterSend` で元メールのmsgidを `replied` 記録

## 設定

TB → ツール → アドオンとテーマ → mailamb → オプション:

| 項目 | 内容 |
|---|---|
| Worker URL | `https://mailamb.<subdomain>.workers.dev` |
| API Key | Worker の `X-API-Key` |
| スタッフID | 共有メール運用の識別子（`tanaka`、`SK` 等） |
| 新着自動保存 | ON (デフォルト) / OFF でパネルの手動保存のみ |
| 問い合わせ宛先 | カンマ区切り、空なら全着信対象 |

## 必要権限

- `messagesRead` / `messagesImport` / `messagesTags` / `messagesUpdate` / `compose` / `accountsRead` / `accountsFolders` / `notifications` / `storage` / `<all_urls>`

## 依存するWorker エンドポイント

- `GET /health`
- `POST /api/draft` - 下書き生成要求（body=inquiry）
- `GET /api/draft/by-msgid/:msgid` - 下書き取得（state/views同梱）
- `POST /api/draft/state/:msgid` - 返信中/送信済 記録
- `GET /api/draft/state/:msgid` - 状態取得
- `POST /api/draft/view/:msgid` - 既読記録
- `POST /api/draft/imap-saved/:msgid` - IMAP保存claim（重複防止）
- `GET /api/draft/replied-ids` - 送信済みmsgid一覧（母艦スクリプト用）
- `GET /api/documents/:id` - 参考テンプレ全文
- `POST /api/log` - 拡張のデバッグログ収集

## 配布

`.xpi` ファイルを各スタッフPCの Thunderbird プロファイルの `extensions/` ディレクトリに配置。
未署名のため `xpinstall.signatures.required=false` を `user.js` で設定する必要あり。

```bash
# profile/user.js に以下を追加
user_pref("xpinstall.signatures.required", false);
```

## デバッグ

- TB の **ツール → 開発者ツール → ブラウザコンソール** でリアルタイムログ
- もしくは Worker 側 `GET /api/log` で過去1時間分のログ収集
- 管理画面（admin/）でも「問い合わせ活動」から state/views を確認可能

## ビルドと配布

```bash
cd addon
zip -r mailamb-$(jq -r .version manifest.json).xpi . \
  -x "*.DS_Store" "SELF_CHECK.md" "README.md"
```

## 変更履歴

- **v0.17.0** 送信前確認ポップアップ別窓方式復活（confirm誤発火対策）
- v0.16.x compose窓開いた瞬間に macOS通知で警告 / 件名プレフィックス廃止
- v0.15.0 件名プレフィックス `[AI下書き]` 導入（後に v0.16.3 で廃止）
- v0.14.x タグ `AI下書き` 自動作成（TB UIで見えづらく実質プレフィックス方式に移行）
- v0.13.x 問い合わせ宛先allowlistフィルタ
- v0.12.0 KV未存在時に拡張から即生成要求
- v0.11.0 retry queue で CF Email Routing遅延に備える
- v0.10.0 messages.importで compose窓なしでDraftsに注入
- v0.9.x compose.beginReply + saveMessage（plainTextBody必須問題を修正）
- v0.8.0 onNewMailReceived 自動下書き・imap-saved claim
- v0.7.0 Draftsに手動保存ボタン
- v0.6.x 参考テンプレ別窓表示・軽量Markdownレンダ
- v0.5.x メール本文先頭バナー注入 (messageDisplayScripts)
- v0.4.0 onBeforeSend / onAfterSend hook
- v0.3.0 既読管理・返信中/送信済 state 共有
- v0.2.0 スタッフID設定・共有メール運用対応
- v0.1.0 下書きパネル初版
