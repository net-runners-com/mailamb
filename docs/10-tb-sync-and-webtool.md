# 10. TB同期構成 + 手動Webツールの配置

> **お客様のご質問**
> 「Thunderbirdは各スタッフPCに入っていて同期して使っている。母艦PCでタスクスケジューラ毎朝バッチ、問い合わせを読んで下書き保存を想定。手動でも下書き作れるWebツールは、どこに何を置けばよいか分からない。」

への回答。

---

## 1. 既存のTB同期運用はそのまま活かせます

```mermaid
flowchart TB
    MAIL[("既存のメール環境<br/>レンタルサーバ or Gmail")]
    MAIL -->|IMAP同期| TBM["Thunderbird<br/>母艦PC"]
    MAIL -->|IMAP同期| TBA["Thunderbird<br/>スタッフA"]
    MAIL -->|IMAP同期| TBB["Thunderbird<br/>スタッフB"]
    MAIL -->|IMAP同期| TBX["Thunderbird<br/>スタッフC〜J"]

    classDef m fill:#faf0dc,stroke:#c38a3d
    classDef t fill:#f0e8f5,stroke:#8a5a9b
    class MAIL m
    class TBM,TBA,TBB,TBX t
```

TB同期（IMAP）がすでに動いているので、**どのPCでDraftsフォルダに書き込んでも、全員のTBに同じ下書きが見えます**。これを前提にシステムを組みます。

---

## 2. 毎朝バッチ処理の仕組み

### 母艦PC側（Windows想定）

タスクスケジューラで毎朝 (例: 7:00) に Node.js スクリプトを起動：

```mermaid
flowchart TB
    SCHED["タスクスケジューラ<br/>毎朝 7:00"]
    SCRIPT["mother.js<br/>Node.jsスクリプト"]
    IMAP1["IMAP接続<br/>既存メールサーバ"]
    FILTER["問い合わせだけ<br/>フィルタ"]
    CF["Cloudflare Worker<br/>下書き生成API"]
    APPEND["IMAP APPEND<br/>Draftsに保存"]
    SYNC["全スタッフTBに<br/>IMAP同期で配布"]

    SCHED --> SCRIPT
    SCRIPT --> IMAP1
    IMAP1 -->|新着メール| FILTER
    FILTER -->|各メール| CF
    CF -->|AI下書き| APPEND
    APPEND --> SYNC

    classDef cf fill:#e1f0fa,stroke:#2a7fb8
    classDef m fill:#faf0dc,stroke:#c38a3d
    classDef t fill:#f0e8f5,stroke:#8a5a9b
    class CF cf
    class IMAP1,APPEND,SYNC m
    class SCRIPT,SCHED,FILTER t
```

**ポイント**:
- 母艦でTBアプリを**立ち上げる必要はありません**（IMAPに直接接続）
- Thunderbird が起動していなくても、スクリプトが IMAP サーバに書き込みます
- スタッフ各自のTBは普段通り使うだけで、下書きが自動で同期されてきます

### 必要なもの（母艦PC）

- Node.js 20以上
- `imapflow` ライブラリ（スクリプトに同梱）
- IMAPアカウント情報（アプリパスワード等）
- タスクスケジューラ設定（Windows標準）

### 既存の `poc/scripts/05-mother.ts` を使う

```bash
pnpm mother          # 本番実行
pnpm mother --dry    # 下書き作成するが Drafts保存しない（テスト）
pnpm mother --list   # 候補一覧だけ表示（AI呼ばない）
```

タスクスケジューラから呼ぶバッチファイル例:
```bat
@echo off
cd C:\mailamb\poc
pnpm mother >> C:\mailamb\logs\mother-%date:~0,10%.log 2>&1
```

---

## 3. 手動で下書きを作成するWebツール — どこに置くか

### 結論: **Cloudflare Pages** に置くのが最適

```mermaid
flowchart LR
    BR["社員のブラウザ"]
    AC["Cloudflare Access<br/>Googleログイン等"]
    PG["mailamb-ui<br/>Cloudflare Pages<br/>静的HTML・JS"]
    WK["mailamb Worker API<br/>下書き生成"]

    BR -->|"HTTPS<br/>draft.yourcompany.com"| AC
    AC -->|社員のみ通過| PG
    PG -->|API呼び出し| WK

    classDef cf fill:#e1f0fa,stroke:#2a7fb8
    classDef user fill:#f0e8f5,stroke:#8a5a9b
    class AC,PG,WK cf
    class BR user
```

### なぜ Cloudflare Pages か

| 項目 | 内容 |
|---|---|
| **ホスティング** | 社内サーバ不要。Cloudflare上に無料でホスト |
| **URL** | 任意のサブドメイン（例: `https://draft.example.com`） |
| **認証** | Cloudflare Access で社員のGoogleアカウントログイン必須にできる（社員以外アクセス不可） |
| **保守** | 更新時は wrangler で deploy。ダウンタイムなし |
| **コスト** | 無料プラン内 |
| **既存Workerと連携** | 同じAPIを叩くだけ |

### Webツールの中身

既にPoCに実装済み（`poc/ui/index.html` + `poc/scripts/04-serve.ts`）。入力画面と結果画面：

```mermaid
flowchart TB
    subgraph INPUT["入力画面"]
        I1["サンプルから読み込み<br/>プルダウン"]
        I2["件名・差出人・メール"]
        I3["本文テキストエリア"]
        I4["詳細設定<br/>モデル・閾値"]
        I5["生成ボタン"]
    end
    subgraph OUTPUT["結果画面"]
        O1["抽出された意図"]
        O2["RAG ヒット<br/>上位5件"]
        O3["AI下書き<br/>編集可"]
    end
    I5 --> OUTPUT

    classDef i fill:#e0f0ef,stroke:#0a7c7b
    classDef o fill:#e1f0fa,stroke:#2a7fb8
    class I1,I2,I3,I4,I5 i
    class O1,O2,O3 o
```

### 使い方の想定シーン

- 母艦バッチが処理した後、追加で急ぎの問い合わせが届いた
- 電話で聞いた内容を元に返信文を作りたい
- Thunderbird以外（スマホ等）から下書き試作したい

### 代替案（Pages使わない場合）

| 案 | 置き場所 | 向くケース |
|---|---|---|
| **A. Cloudflare Pages** (推奨) | クラウド | 誰でもどこからでもアクセス、認証必須 |
| **B. 母艦PC上の軽量サーバ** | 社内LAN | 社外アクセス不要、ネット回線切れても使える |
| **C. 各PCに配布** | ローカルHTMLファイル | オフライン可、認証なし、更新面倒 |

**推奨**: 案A。10名規模ならコストほぼゼロで管理も楽。

---

## 4. 全体構成（お客様の環境に合わせた最終図）

```mermaid
flowchart TB
    CUST["顧客<br/>メール送信"]

    subgraph MAIL["既存メール環境"]
        INBOX[("info@yourcompany.com<br/>レンタル鯖 or Gmail")]
    end

    subgraph HQ["母艦PC Windows"]
        TASK["タスクスケジューラ"]
        BATCH["mother.js<br/>IMAP直叩き"]
    end

    subgraph CF["Cloudflare"]
        WK["mailamb Worker<br/>RAG + AI下書き生成"]
        PG["mailamb-ui<br/>Pages<br/>手動Webツール"]
        AC["Cloudflare Access<br/>社員認証"]
    end

    subgraph STAFF["スタッフPC × 10"]
        TB["Thunderbird<br/>IMAP同期で<br/>下書きが見える"]
    end

    BR["社員ブラウザ<br/>急ぎの手動入力"]

    CUST --> INBOX
    INBOX <-->|IMAP| BATCH
    INBOX <-->|IMAP| TB
    TASK --> BATCH
    BATCH -->|HTTPS| WK
    BATCH -->|"IMAP APPEND Drafts"| INBOX
    BR -->|HTTPS| AC
    AC --> PG
    PG --> WK

    classDef cust fill:#fff,stroke:#333
    classDef mail fill:#faf0dc,stroke:#c38a3d
    classDef cf fill:#e1f0fa,stroke:#2a7fb8
    classDef hq fill:#e0f0ef,stroke:#0a7c7b
    classDef staff fill:#f0e8f5,stroke:#8a5a9b
    class CUST,BR cust
    class INBOX mail
    class WK,PG,AC cf
    class TASK,BATCH hq
    class TB staff
```

### 2つの入口でカバー

| 用途 | ルート | 誰が |
|---|---|---|
| **朝のバッチ** | 母艦PC → IMAP → Drafts | 自動（タスクスケジューラ） |
| **手動の個別対応** | ブラウザ → Pages → Worker | 社員（都度） |

両方とも裏の Worker が同じ下書き生成ロジックを使うので、品質・ベースは一貫します。

---

## 5. 導入時にお客様側でご用意いただくもの

### 必須

- **母艦用PC** （Windows 推奨、常時稼働、Node.js動く）
- **メールの IMAP接続情報** （既存アカウントのパスワードやアプリパスワード）
- **Cloudflare アカウント** （新規作成、無料）
- 既存の **ドメイン** （Webツールのサブドメイン用、任意）

### あると良い

- **Google Workspace** （Cloudflare Access を Google ログインにできる）
- **既存の定型文集** （Word/Excel/テキスト形式でOK、こちらで登録）

---

## 6. 導入の進め方

```mermaid
gantt
    title 導入スケジュール（2〜3週間）
    dateFormat  YYYY-MM-DD
    section 準備
    ヒアリング                 :a1, 2026-10-20, 1d
    初期構築 (CF環境)          :a2, after a1, 2d
    section 本番構築
    定型文登録                 :b1, after a2, 3d
    母艦PC設定                 :b2, after b1, 1d
    section 展開
    試運用 (1〜2名)            :c1, after b2, 7d
    本番展開 (全10名)          :c2, after c1, 1d
```

| フェーズ | 期間 | 内容 |
|---|---|---|
| ヒアリング | 1日 | メール環境・定型文の棚卸し |
| 初期構築 | 1〜2日 | Cloudflare環境構築、Worker/Pages デプロイ |
| 定型文登録 | 1〜3日 | お手持ちの定型文を10〜30件登録 |
| 母艦PC設定 | 半日 | タスクスケジューラ + 母艦スクリプト設置 |
| 試運用 | 1週間 | 1〜2名のスタッフでトライアル |
| 本番展開 | 1日 | 全10名のTBに拡張配布 |

**トータル 2〜3週間** でご利用開始いただけます。
