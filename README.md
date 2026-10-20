# mailamb — 共有メール AI 自動下書きシステム (minimal 構成)

複数スタッフが共有する問い合わせ用メール（例: `info@yourcompany.com`）に届いた問い合わせに対して、Cloudflare Workers AI が RAG+LLM で返信下書きを自動生成し、各スタッフの Thunderbird に自動配信します。

## 特徴

- ✓ 既存メール鯖 (Xserver / さくら / 独自鯖 / Workspace / M365) に**無影響**
- ✓ **MX / DNS 変更なし、新規ドメイン追加なし**
- ✓ **母艦PC不要** (Cloudflare 内で完結)
- ✓ **完全無料** (Workers Free Plan 内で成立、10名規模想定)
- ✓ 新着検知 **最大5秒遅延** (実質リアルタイム)
- ✓ **二重送信防止** (スタッフ間で送信状態を共有)
- ✓ AI は下書きまで、送信は必ず人間が判断

## 構成

```
顧客メール (info@yourcompany.com)
    ↓
Xserver 受信 (既存通り)
    ↓                              ↓ IMAP IDLE (Cloudflare → Xserver)
全スタッフ TB                   worker-watcher
   (既存IMAP同期)                 (CF Workers)
                                   ↓ 新着検知
                              mailamb Worker (AI生成)
                                   ↓
                              Drafts に IMAP APPEND
                                   ↓
                              全スタッフTBに同期で下書き配布
                                   ↓
                              スタッフが編集 → 送信
                                   ↓
                              TB拡張 が送信前 state 確認・送信後 replied 記録
```

## クイックスタート

### お客様に提案する時
[client-handoff/00_お読みください.md](./client-handoff/00_%E3%81%8A%E8%AA%AD%E3%81%BF%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84.md) → `01_提案構成` → `04_お客様へお送りするメッセージ`

### 本番構築する時 (エンジニア or AI 向け)
[client-handoff/06_本番構築手順.md](./client-handoff/06_%E6%9C%AC%E7%95%AA%E6%A7%8B%E7%AF%89%E6%89%8B%E9%A0%86.md)

6ステップ、所要2〜3時間、$0/月で動く。

### スタッフPCに拡張配布
[mailamb-staff-package-0.18.0.zip](./mailamb-staff-package-0.18.0.zip) を解凍、各PC 10分でインストール。

## ディレクトリ構成

```
mailamb/
├── README.md                          ← このファイル
├── 構成図.md                          ← mermaid 全体図
├── mailamb-*.{md,txt}                 ← 顧客向けフロー説明資料
├── mailamb-staff-package-*.zip        ← スタッフ配布パッケージ
├── client-handoff/                    ← 顧客向けドキュメント (00〜06)
├── worker/                            ← mailamb Worker (AI生成 + state管理)
│   ├── src/
│   ├── migrations/0001_init.sql
│   └── wrangler.toml
├── worker-watcher/                    ← ★ メインドライバ (CF Workers IMAP IDLE)
│   ├── src/{index,imap,parser}.ts
│   └── wrangler.toml
├── addon/                             ← TB拡張 v0.18.0 (minimal mode, 送信ガード)
│   ├── manifest.json
│   ├── background.js
│   └── ui/
├── addon-admin/                       ← 管理者用 TB拡張 v0.1.0 (ダッシュボード+ナレッジCRUD)
└── poc/
    ├── data/                          ← サンプルナレッジ (templates/past_cases/inquiries)
    └── scripts/
        └── 05-mother.ts               ← 代替案: 母艦PC常駐スクリプト
```

## 技術スタック

| 層 | 技術 |
|---|---|
| LLM | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Cloudflare Workers AI) |
| Embedding | `@cf/baai/bge-m3` (1024次元・多言語) |
| ベクトル検索 | Cloudflare Vectorize |
| ナレッジメタ | Cloudflare D1 |
| ナレッジ本文 | Cloudflare R2 |
| 状態管理 | Cloudflare KV |
| IMAP (Watcher) | cloudflare:sockets (自前実装 Minimal IMAP Client) |
| スタッフ側 | Thunderbird 158+ + mailamb 拡張 |

## コスト

**$0/月** (10名規模、日30件問い合わせ想定)。Workers Free Plan 範囲内で全部収まる。

## 代替構成

minimal構成が合わない場合:

- **母艦PC方式** ([poc/scripts/05-mother.ts](./poc/scripts/05-mother.ts)): 常駐PCで IMAP IDLE。CF 使いたくない / IMAP接続を内部に閉じたい場合。
- **CF Email Routing方式**: 新規ドメイン or 独自ドメイン MX を CF に向けられる場合。本リポには同梱していない (別途実装)。

## ライセンス

社内配布向けプライベート実装。詳細は社内で確認。
