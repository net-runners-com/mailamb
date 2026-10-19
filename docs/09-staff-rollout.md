# 09. 複数スタッフ本番運用プラン

PoCの1アカウント運用から、10名規模の本番運用へのロードマップ。

## 現状（PoC）

- アカウント: forward@example.com 1個
- 転送: info@ → mailamb-email Worker → forward@example.com
- 誰も担当決まってない状態（全員が同じGmail INBOX見てる想定）

## Phase 2: 複数スタッフGmailへのfan-out

### 前提

- 各スタッフが Gmail アカウントを持つ（組織版 or 個人版）
- 1アドレス=1人（a@gmail.com, b@gmail.com, ...）

### 設定手順

**ステップ 1**: CF Email Routing の Destination addresses に全スタッフを登録

```
Dashboard → Email → Routing → Destination addresses → Add
各スタッフが届いた確認メールのリンクをクリックして verified に
```

**ステップ 2**: `worker-email/wrangler.toml` の `FORWARD_TO` にカンマ区切りで追加

```toml
FORWARD_TO = "a@gmail.com,b@gmail.com,c@gmail.com,d@gmail.com,e@gmail.com,f@gmail.com,g@gmail.com,h@gmail.com,i@gmail.com,j@gmail.com"
```

**ステップ 3**: 再デプロイ

```bash
cd worker-email && cfauth wrangler deploy
```

→ 1件の問い合わせが 10 スタッフ全員の Gmail に届く。全員が **同じ Message-ID** のメールを見る → 全員のTB拡張が同じ下書きを KV から取得して表示する。

### 誰が返信するか問題

全員に届くので、「誰が担当するか」のアサイン運用が必要:

**案1: 時間帯で分担**
- Google Slack で日次ローテーション共有

**案2: カテゴリで分担**
- 「見積系」はAさん、「保守系」はBさん等
- 事前に TB拡張 panel に「推奨担当者」を表示（将来機能）

**案3: 先手必勝**
- 返信した人がSlackで「対応中」宣言
- シンプル、小規模向け

**案4: 共有Draftsフォルダ**
- Google Workspace 導入してチームメールボックス化
- → パターンC（Workspace）への移行

## Phase 3: 送信名義の統一

### 問題

スタッフが TB で返信ボタン押しても、Gmail SMTP は From を `forward@example.com` or `スタッフ本人のGmail` に書き換えてしまう。顧客視点では「色々な宛先から返信が来る」ことになる。

### 解決: Gmail Send As

各スタッフの Gmail Web で:

1. 歯車 → すべての設定を表示 → アカウントとインポート
2. 「他のメールアドレスを追加」で `info@example.com` 追加
3. エイリアスとして扱う ON
4. SMTP サーバー:
   - **Option A** (簡単): Gmail の SMTP (smtp.gmail.com:587) + アプリパスワード
   - **Option B** (きれい): Resend の SMTP (smtp.resend.com:465) + API key
5. 確認メール → コード入力

これで全スタッフが `info@example.com` 名義で送信可能。

TB拡張の Fromセレクタに `info@example.com` を加える:
- `addon/background.js` の `DEFAULT_SETTINGS.fromIdentities` 編集
- 対応する Identity をTBアカウント設定にも追加

## Phase 4: Workspace / M365 への移行（オプション）

10名超えたら Google Workspace を推奨。利点:

- `info@yourdomain.com` が「共有メールボックス」になり、Delegated Access で全員が同じINBOX/Draftsを見られる
- 下書きが自然に共有される（TB拡張不要になる可能性）
- アーカイブ、ラベル、ルールが組織管理
- OAuth2 で認証、refresh_token 1個で全員分の操作可（委任済なら）

移行時のアーキテクチャはパターンC（docs/08-mail-environments.md）。

- CF Email Worker やめて、Workspace の Gmail API Push Notification + Cloud Pub/Sub でリアルタイム処理
- Gmail API `drafts.create` で info@ の Drafts に書き込み
- TB拡張は使わない or 社内Web UIで下書き表示（スタッフ側はブラウザだけで完結）

## コスト対比

| 構成 | 月額 | スケール上限 |
|---|---|---|
| **PoC (1アカウント)** | $0 | 1人 |
| **Phase 2 (CF forward×10)** | $0〜$5 | 10人 |
| **Phase 3 (Send As設定)** | +0 | 10人 |
| **Phase 4 (Workspace)** | $7.5/人/月 (Business Starter) × 10 = $75 | 制限なし |

Phase 2 で十分な間は $0〜$5 で運用。本気で業務化するなら Phase 4 に行くタイミング。

## 推奨ロードマップ

| 時期 | アクション |
|---|---|
| 今 | Phase 1 (PoC完了済み) |
| 来週 | Phase 2 設定（10名分のdest address登録+FORWARD_TO更新） |
| 来月 | スタッフトライアル1〜2名、下書き精度評価 |
| 2ヶ月後 | 全10名ロールアウト、Phase 3（Send As）設定 |
| 3〜6ヶ月後 | 使用頻度が高ければ Phase 4 (Workspace移行) 検討 |

Phase 4 への移行は本番運用で課題が出てから判断で問題ない。
