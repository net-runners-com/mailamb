# mailamb Thunderbird 拡張 (minimal mode)

## バージョン
v0.18.0 (minimal mode)

## 役割

**本拡張は「送信ガード」専用**。下書き生成と Drafts 保存は [worker-watcher](../worker-watcher/) が担当。

| 機能 | 担当 |
|---|---|
| AI下書き生成 | worker-watcher + mailamb Worker |
| Drafts フォルダへの保存 | worker-watcher (IMAP APPEND) |
| **送信前の二重送信防止 (別窓ポップアップ)** | **TB拡張 (本件)** |
| **送信後の replied 記録** | **TB拡張 (本件)** |
| **本文バナー: 送信済 / 返信中 表示** | **TB拡張 (本件)** |

## 機能詳細

### 1. 送信前チェック (`onBeforeSend`)
送信ボタン押下時に compose の In-Reply-To を取得し、Worker の state を確認:
- `kind: replied` → 「既に <staff> が送信済」別窓ポップアップ → キャンセルで送信中止
- `kind: claimed` by 他スタッフ → 「<staff> が返信中」別窓ポップアップ → キャンセルで送信中止
- `kind: claimed` by 自分 → 何も聞かない
- state 無し → 素通りで送信

### 2. 送信後記録 (`onAfterSend`)
送信成功時に元メール msgid で `/api/draft/state` に `kind: replied` POST。他スタッフの TB で開くと即「送信済」バッジ。

### 3. メール表示バナー (`messageDisplayScripts`)
開いたメールの msgid で state 問い合わせ。
- replied → 🟢緑バナー `✉️ 送信済: XX`
- claimed → 🟡黄バナー `✏️ 返信中: XX`
- state 無し → バナー非表示

## 設定

TB → ツール → アドオンとテーマ → mailamb → 歯車 → オプション:

| 項目 | 内容 |
|---|---|
| Worker URL | `https://mailamb.<subdomain>.workers.dev` |
| API Key | Worker の `X-API-Key` |
| スタッフID | 自分の識別子 (`tanaka` 等) |

## 権限 (必要最小)

- `messagesRead` - 表示中メールの Message-ID 取得
- `compose` - onBeforeSend / onAfterSend / setComposeDetails
- `accountsRead` - identity 一覧 (将来拡張)
- `storage` - 設定保存
- `<all_urls>` - Worker API fetch

v0.17.2 で必要だった以下は **削除**:
- `messagesImport` (watcher が担当)
- `messagesTags` (タグ運用廃止)
- `messagesUpdate`
- `accountsFolders`
- `notifications`

## 配布

`.xpi` を TB プロファイルの `extensions/mailamb@mailamb.local.xpi` に配置。
未署名のため `xpinstall.signatures.required=false` を `user.js` で設定。

## 使う Worker エンドポイント

- `GET /api/draft/state/:msgid` - 状態取得
- `POST /api/draft/state/:msgid` - replied 記録

**たった2つ**。従来の `/api/draft/by-msgid` `/api/draft/view` `/api/draft/imap-saved` `/api/log` 等は全て不要。

## 変更履歴

- **v0.18.0** minimal mode に全面リファクタ。auto-draft, パネル, タグ, 既読トラッキング削除。Worker 側も 4エンドポイントに削減。
- v0.17.x 以前は multi-feature 版 (main ブランチの git履歴参照)。
