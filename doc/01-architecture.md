# 01. 構成

## 全体像

```
顧客メール → Xserver 等 (既存メール鯖)
              │
              ├─► 全員のThunderbird (既存 IMAP同期)
              │                                   ↑
              │                       送信/編集/送信ガード
              │                                   │
              │                       [addon] (送信者PC)
              │                       [addon-admin] (管理者PC)
              │                                   ↑
              │                                   │
              └─► IMAP TLS 接続 (993)
                     │
                     ▼
              [worker-watcher]    (CF Workers 常駐)
                     │ 新着検知 (IMAP IDLE 55秒窓)
                     │
                     ▼ service binding
              [mailamb Worker]    (CF Workers)
                     ├─ 意図抽出 (Workers AI)
                     ├─ RAG検索 (Vectorize + D1 + R2)
                     ├─ LLM生成 (Workers AI)
                     ├─ state管理 (KV)
                     ▼
              IMAP APPEND → 共有Drafts
```

## 4コンポーネント

| # | コンポーネント | 場所 | 責務 |
|---|---|---|---|
| 1 | **worker-watcher** | CF Workers | IMAP監視、新着検知、下書き生成要求、Drafts保存 |
| 2 | **mailamb Worker** | CF Workers | AI生成API (RAG + LLM)、状態管理API、ナレッジCRUD |
| 3 | **addon** (送信者) | 各PC Thunderbird | 送信前の二重送信確認、送信後の状態記録、本文バナー |
| 4 | **addon-admin** | 管理者PC Thunderbird | 管理ダッシュボード (ナレッジCRUD、送信履歴) |

## データフロー (新着1件が入って返信するまで)

```
0秒      顧客 info@yourcompany.com に送信
~1-5秒   Xserver 受信、IMAP IDLE イベント発火
~5秒     worker-watcher が EXISTS push 検知
         UID SEARCH UNSEEN → BODY.PEEK[] 取得
~6秒     mailamb Worker に /api/draft POST
~10秒    意図抽出 → embedding生成 → Vectorize検索
~15秒    LLM で返信文生成
~16秒    worker-watcher が RFC5322 構築 → IMAP APPEND
~17-30秒 全員の Thunderbird が IMAP同期で Drafts に新着下書き
手動      送信者が TB で開いて確認、編集、送信
         onBeforeSend: KV state 確認 → 必要なら送信確認ポップアップ
         onAfterSend: KV state (replied) 記録
```

## CF側リソース

| 種類 | 用途 | 無料枠 |
|---|---|---|
| **Workers** × 2 | mailamb + mailamb-watcher | 100,000 req/day |
| **Workers AI** | LLM生成 + embedding | 10,000 neurons/day |
| **Vectorize** | ベクトル検索 (1024次元 cosine) | 30M dimensions query/mo |
| **D1** | ナレッジメタ + chunks | 5GB storage |
| **R2** | ナレッジ本文 (.md) | 10GB storage |
| **KV** | state管理 (replied/claimed) | 1,000 writes/day |
| **cloudflare:sockets** | IMAP TLS接続 | 制限なし |

## 既存メール環境への影響

| | 変更 |
|---|---|
| MX record | ✗ 無変更 |
| SPF / DKIM | ✗ 無変更 |
| DNS 一般 | ✗ 無変更 |
| 既存 Inbox 受信 | ✗ 無変更 |
| 既存 SMTP 送信 | ✗ 無変更 |
| 各PCの Thunderbird IMAP設定 | ✗ 無変更 |
| ドメイン追加 | ✗ 無し |

**壊れるリスクゼロ**。やめたくなったら worker-watcher 削除で元の運用に即戻る。

## 拡張 ID 設計

| 拡張 | ID |
|---|---|
| addon (送信者) | `mailamb@mailamb.local` |
| addon-admin (管理者) | `mailamb-admin@mailamb.local` |

**別IDなので同一TBに両方インストール可能**。管理者ロールの人は両方入れる。

## state ライフサイクル

```
元メール受信
    ↓
worker-watcher が下書き作成 (state無し)
    ↓
送信者Aが「下書きで返信」クリック → compose window open
    ↓ onBeforeSend 時点: state無し
    ↓ 送信ボタン
    ↓ onAfterSend: state=replied (staff=A, at=now) KV書き込み
    ↓
送信者Bが同じメール開く
    ↓ 本文バナー: "✉️ 送信済 by A" (緑)
    ↓ 下書きで返信クリック → compose
    ↓ 送信ボタン
    ↓ onBeforeSend: state=replied by A 発見
    ↓ 「既に A が送信済、本当に送る？」ポップアップ
    ↓ キャンセル or 送信 選択
```

**TTL**: replied = 90日 / claimed = 30分 (claimed は使ってない)
