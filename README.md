# mailamb — 共有メール AI 自動下書きシステム

複数スタッフが共有する問い合わせ用メール（例: `info@yourcompany.com`）に届いた問い合わせに対して、Cloudflare Workers AI が RAG+LLM で返信下書きを自動生成し、各スタッフのメール環境（Thunderbird）にリアルタイム共有します。**AI が下書きを書き、人間が最終確認して送信**する運用。

- 共有メール 1 アカウント + 複数スタッフ運用（約5名〜数十名規模）
- 既存メール環境（Xserver / さくら / 独自鯖 / Workspace / M365 等）はそのまま使用
- MX / SPF / DKIM / DNS 変更なし。鯖側に転送設定を1行追加するだけ
- 母艦PC不要。Cloudflare + Thunderbird拡張 で完結
- 既読 / 返信中 / 送信済み の状態を全スタッフ TB で共有し、二重返信を防止

## デモ

- 構成図: [`構成図.md`](./構成図.md)
- フロー: [`mailamb-flow.md`](./mailamb-flow.md) / [`mailamb-flow.txt`](./mailamb-flow.txt)
- 1枚概要: [`mailamb-oneshot.md`](./mailamb-oneshot.md)
- FAQ: [`mailamb-faq.md`](./mailamb-faq.md)

## クイックスタート

**本番構築** → [`client-handoff/06_本番構築手順.md`](./client-handoff/06_本番構築手順.md)（10章 / Cloudflare構築 → 鯖転送 → 拡張配布まで一本道）

**スタッフ向け配布** → [`mailamb-staff-package-0.17.2.zip`](./mailamb-staff-package-0.17.2.zip)（.xpi + INSTALL.md + SELF_CHECK.md 入り、32KB）

## ドキュメント

### クライアント引き渡し用（最新・推奨）
| # | 内容 |
|---|---|
| [00](./client-handoff/00_お読みください.md) | 入口 |
| [01](./client-handoff/01_提案構成と導入方針.md) | Bβ構成の提案 |
| [02](./client-handoff/02_テスト開始前の確認事項.md) | 事前調査リスト |
| [03](./client-handoff/03_client側AIへの開始指示.md) | お客様側AIへの初動指示 |
| [04](./client-handoff/04_お客様へお送りするメッセージ.txt) | お客様への説明文テンプレ |
| [05](./client-handoff/05_コンサルへ確認をお願いするメッセージ.txt) | 当社内レビュー依頼文 |
| [06](./client-handoff/06_本番構築手順.md) | **本番構築手順**（Cloudflare / 鯖転送 / ナレッジ / 拡張配布 まで） |

### コンポーネント別
- [`addon/README.md`](./addon/README.md) — Thunderbird 拡張 全機能リファレンス
- [`addon/INSTALL.md`](./addon/INSTALL.md) — 拡張インストール手順（スタッフ向け）
- [`addon/SELF_CHECK.md`](./addon/SELF_CHECK.md) — 動作確認手順
- [`admin/README.md`](./admin/README.md) — 管理画面の起動と操作

### 旧版（Pattern A時代 / 参考）
`docs/01〜10` は 母艦PC前提の旧構成資料。現行Bβ構成とは一部矛盾あり。

## ディレクトリ構成

```
mailamb/
├── README.md                     ← このファイル
├── 構成図.md                     ← mermaid 全体図
├── mailamb-flow.{md,txt}         ← フロー図
├── mailamb-faq.md                ← FAQ
├── mailamb-staff-package-*.zip   ← スタッフ配布パッケージ
├── client-handoff/               ← 顧客向けドキュメント一式
├── docs/                         ← 旧版ドキュメント（Pattern A）
├── worker/                       ← Cloudflare Worker (RAG+生成+状態管理)
│   ├── src/
│   ├── migrations/0001_init.sql
│   └── wrangler.toml
├── worker-email/                 ← Cloudflare Email Worker (受信)
│   ├── src/index.ts
│   └── wrangler.toml
├── addon/                        ← Thunderbird 拡張 (WebExtension)
│   ├── manifest.json
│   ├── background.js
│   ├── ui/{panel,options,doc,confirm,banner}.{html,js,css}
│   └── icons/
├── admin/                        ← 管理画面 (静的HTML/CSS/JS)
│   ├── index.html
│   ├── admin.{css,js}
│   └── README.md
└── poc/                          ← ローカルPoC・評価用 + 母艦スクリプト（オプション）
    ├── data/
    ├── lib/
    ├── scripts/
    │   ├── 01-ingest.ts
    │   ├── 02-draft.ts
    │   ├── 03-eval.ts
    │   ├── 04-serve.ts
    │   ├── 05-mother.ts          ← 母艦スクリプト（Bβ本番構成では不要）
    │   └── 06-upload-to-worker.ts
    └── ui/
```

## 技術スタック

- **Cloudflare**: Workers / Workers AI / Vectorize / D1 / R2 / KV / Email Routing + Email Workers / Pages / Access
- **LLM**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Embedding**: `@cf/baai/bge-m3` (1024次元・多言語)
- **スタッフ側**: Thunderbird 158+ + mailamb 拡張 (WebExtension / 未署名 .xpi)
- **既存メール環境**: 鯖の種類不問（Xserver / さくら / 独自IMAP / Workspace / M365）
- **母艦PC**: **不要**

## コスト目安

| サービス | 月想定 (10名規模) | 無料枠 |
|---|---|---|
| Workers requests | 10,000〜30,000 | 100,000/day |
| Workers AI | 2,000〜5,000 req | 10,000/day |
| Vectorize | 2,000〜5,000 query | 30,000/month |
| KV / D1 / R2 | 微少 | 大枠内 |
| Cloudflare Pages | 無料 | 500 builds/month |

実質 **月額 $0〜数ドル**。

## ライセンス

社内配布向けプライベート実装。詳細は社内で確認。
