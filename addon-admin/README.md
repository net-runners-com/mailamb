# mailamb — 管理者ダッシュボード (TB拡張)

管理者用の TB 拡張。TB ツールバーボタンから **TB 内タブ** で管理ダッシュボードを開く。

## 対象ユーザー

**管理者 1〜数名のみ**。スタッフ全員には配布不要。
スタッフ側拡張 (`addon/`) とは **別の extension_id** なので同一 TB に両方インストール可。

## 機能

### 📚 ナレッジタブ
- Worker の `/api/documents` から全ナレッジ一覧
- 無効化ボタン
- doc_id / タイプ / タイトル / カテゴリ / 更新日時 / 状態

### ➕ 追加タブ
2通りの方法:

**方法1: ファイルアップロード** (ドラッグ&ドロップ or 選択)
- `.eml` → メール自動パース (Subject→タイトル、本文→content、type=past_case)
- `.md` / `.txt` → 1行目→タイトル、全文→content、type=template
- `.html` → タグ除去、type=reference
- アップロード後、追加フォームが自動入力される → 編集して保存

**方法2: 直接入力**
- doc_id / type / タイトル / カテゴリ / タグ / 本文 を手入力

### ✉️ 送信履歴タブ
- Worker の `/api/admin/activity` から送信済み msgid 一覧
- 日時 / Message-ID / 状態 / スタッフ

### ⚙️ 設定タブ
- Worker URL / API Key (dashboard から変更可)

## インストール

### 1. `.xpi` 作成
```bash
cd addon-admin
zip -r ../mailamb-admin-0.1.0.xpi . -x "*.DS_Store" "README.md"
```

### 2. TB プロファイル に配置
```bash
cp mailamb-admin-0.1.0.xpi "$PROFILE/extensions/mailamb-admin@mailamb.local.xpi"
```

### 3. user.js に (未署名許可)
```
user_pref("xpinstall.signatures.required", false);
```

### 4. TB 再起動 → ツール → アドオン → mailamb-admin 有効化

### 5. 設定
TBツールバーに `mailamb 管理` ボタンが出る。
歯車 → オプションで Worker URL / API Key 入力。

### 6. 使う
ツールバーボタン **mailamb 管理** クリック → TB内に新タブとしてダッシュボードが開く。

## スタッフ拡張との違い

| 項目 | スタッフ拡張 (addon/) | 管理者拡張 (addon-admin/) |
|---|---|---|
| 対象 | 全スタッフ | 管理者のみ (1〜数名) |
| 機能 | 送信ガード + 本文バナー | ナレッジCRUD + 送信履歴 + ダッシュボード |
| 権限 | messagesRead, compose, accountsRead, storage | accountsRead, storage |
| extension_id | mailamb@mailamb.local | mailamb-admin@mailamb.local |
| 配布 | 全スタッフPCに展開 | 管理者PCにのみ |

**同一 TB に両方入れてOK** (別 extension_id なので干渉しない)。

## 権限 (必要最小)

- `accountsRead` - 設定画面でアカウント一覧参照 (将来拡張)
- `storage` - Worker URL / API Key 保存
- `<all_urls>` - Worker API fetch

ファイルアップロードは拡張内の UI でブラウザ FileReader API 使用、追加権限不要。

## Worker 側で使うエンドポイント

- `GET /health`
- `GET /api/documents` - 一覧
- `POST /api/documents` - 新規追加
- `DELETE /api/documents/:id` - 無効化
- `GET /api/admin/activity` - 送信済み一覧

## 技術

- 単一 HTML (dashboard.html) + CSS + JS
- `browser.tabs.create()` で TB 内タブ表示
- `browser.storage.local` で設定保存
- File API でローカルファイル読込・パース

## 変更履歴

- v0.1.0: 初版。ダッシュボード + ナレッジCRUD + 送信履歴 + 設定。
