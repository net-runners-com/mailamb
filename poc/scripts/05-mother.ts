// 母艦スクリプト（ローカル版）
// 共有IMAPメールサーバに直接繋ぎ、問い合わせを拾って Workers AI で下書き生成し、
// 同じアカウントの Drafts に APPEND する。
// 対応: Xserver / さくら / 独自メール鯖 / Gmail / Workspace / M365（IMAP + 標準パスワード）
//
// モード:
//   pnpm mother             # 一回だけ処理して終了（朝バッチ用）
//   pnpm mother --watch     # IMAP IDLE で常駐、新着が来た瞬間に処理（リアルタイム）
//
// 本番 Windows 母艦でも同じコードが動く想定（Node 20+）
//
// 使い方:
//   pnpm mother              # 直近N件のUNSEEN問い合わせを処理
//   pnpm mother --dry        # 生成までするが Drafts 保存しない
//   pnpm mother --list       # 候補一覧だけ表示（AI呼ばない）
//   pnpm mother --limit=3    # 最大件数指定

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
// @ts-ignore - MailComposer has no types shipped
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { processOne } from "../lib/draft.ts";
import type { Inquiry, IndexedDoc } from "../lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../out");

const {
  IMAP_HOST,          // Xserverなら sv1234.xserver.jp 等
  IMAP_PORT = "993",
  IMAP_USER,
  IMAP_PASSWORD,
  INQUIRY_ADDRS = "",
  WORKER_URL = "",
  WORKER_API_KEY = "",
} = process.env;

if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) {
  console.error("IMAP_HOST / IMAP_USER / IMAP_PASSWORD が .env に必要です");
  console.error("例: IMAP_HOST=sv1234.xserver.jp IMAP_USER=info@yourcompany.com IMAP_PASSWORD=xxx");
  process.exit(1);
}

const INQUIRY_SET = new Set(
  INQUIRY_ADDRS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);

// CLI
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIST_ONLY = args.includes("--list");
const WATCH = args.includes("--watch");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 5);

type Processed = Record<string, { at: string; action: string; draft_uid?: number }>;

// 共有IMAP運用: 他スタッフが既にTBから返信した msgid 一覧を Worker から取得。
// 母艦が同じメールの下書きを再生成しないようにする。
async function fetchRepliedIds(): Promise<Set<string>> {
  if (!WORKER_URL || !WORKER_API_KEY) return new Set();
  try {
    const res = await fetch(`${WORKER_URL}/api/draft/replied-ids`, {
      headers: { "X-API-Key": WORKER_API_KEY },
    });
    if (!res.ok) {
      console.warn(`[mother] replied-ids fetch failed: ${res.status}`);
      return new Set();
    }
    const data = (await res.json()) as { replied: Array<{ message_id: string }> };
    return new Set((data.replied ?? []).map((r) => r.message_id));
  } catch (e) {
    console.warn(`[mother] replied-ids error:`, e);
    return new Set();
  }
}

async function loadProcessed(): Promise<Processed> {
  try {
    return JSON.parse(await fs.readFile(path.join(OUT, "processed.json"), "utf8"));
  } catch {
    return {};
  }
}

async function saveProcessed(p: Processed) {
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, "processed.json"), JSON.stringify(p, null, 2));
}

async function findDraftsPath(client: ImapFlow): Promise<string> {
  // 標準的には SPECIAL-USE \Drafts でヒットする (Xserver/さくら/IMAP RFC準拠)
  for await (const mbox of client.list()) {
    if (mbox.specialUse === "\\Drafts") return mbox.path;
  }
  // フォールバック（Gmail/下書きフォルダ名が特殊な鯖）
  const candidates = ["Drafts", "INBOX.Drafts", "下書き", "[Gmail]/Drafts", "[Gmail]/下書き"];
  for (const p of candidates) {
    try {
      await client.mailboxOpen(p, { readOnly: true });
      await client.mailboxClose();
      return p;
    } catch {}
  }
  throw new Error("Drafts フォルダが見つかりません（鯖側のフォルダ名を確認）");
}

function pickRecipientMatch(toAddrs: string[]): string | null {
  if (INQUIRY_SET.size === 0) return toAddrs[0] ?? null;
  const hit = toAddrs.find((a) => INQUIRY_SET.has(a.toLowerCase()));
  return hit ?? null;
}

async function composeReplyDraft(opts: {
  from: string;              // 送信者（test@example.com 等）
  to: string;                // 返信先
  subject: string;           // Re: 付き
  inReplyTo: string;         // 元Message-ID
  references: string[];      // 元References + 元Message-ID
  body: string;              // AI生成本文（[AI下書き]マーカー付き）
}): Promise<Buffer> {
  const mail = new MailComposer({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
  return await mail.compile().build();
}

async function fetchInquiryEmail(parsed: Awaited<ReturnType<typeof simpleParser>>): Promise<{
  inquiry: Inquiry;
  recipient: string;
} | null> {
  const toArr = (parsed.to as any);
  const toList: string[] = [];
  if (toArr) {
    const addrs = Array.isArray(toArr) ? toArr : [toArr];
    for (const g of addrs) {
      for (const v of g.value ?? []) if (v.address) toList.push(v.address);
    }
  }
  const recipient = pickRecipientMatch(toList);
  if (!recipient) return null;

  const fromV = (parsed.from as any)?.value?.[0];
  const from = { name: fromV?.name ?? "", email: fromV?.address ?? "" };
  const body = parsed.text?.trim() ?? "";
  if (!body) return null;

  const refs = String(parsed.references ?? "")
    .split(/\s+/)
    .filter(Boolean);

  const inquiry: Inquiry = {
    id: parsed.messageId ?? `<local-${Date.now()}>`,
    subject: parsed.subject ?? "(件名なし)",
    from,
    received_at: (parsed.date ?? new Date()).toISOString(),
    message_id: parsed.messageId ?? "",
    in_reply_to: parsed.inReplyTo ?? undefined,
    references: refs,
    body,
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? "unknown",
      size: a.size ?? 0,
    })),
    expected_category: "",
    note: "",
  };
  return { inquiry, recipient };
}

function makeReplySubject(original: string): string {
  const trimmed = original.trim();
  return /^re:\s*/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

type Ctx = {
  client: ImapFlow;
  draftsPath: string;
  index: IndexedDoc[];
  processed: Processed;
  repliedIds: Set<string>;
};

// 1周: UNSEEN を検索して処理。--watch でも --once でも共通で呼ばれる。
async function processBatch(ctx: Ctx): Promise<void> {
  const { client, draftsPath, index, processed, repliedIds } = ctx;
  // 共有IMAP運用: 既読フラグを立てない。
  const uids = await client.search({ seen: false }, { uid: true });
  const target = (uids ?? []).slice(-LIMIT);
  if (!uids || uids.length === 0) {
    console.log(`[mother] UNSEEN: 0 件`);
    return;
  }
  console.log(`[mother] UNSEEN: ${uids.length} 件, 対象: ${target.length} 件`);

      for (const uid of target) {
        const msg: FetchMessageObject = (await client.fetchOne(
          String(uid),
          { source: true, envelope: true },
          { uid: true }
        )) as any;
        if (!msg?.source) continue;

        const parsed = await simpleParser(msg.source);
        const picked = await fetchInquiryEmail(parsed);
        if (!picked) {
          console.log(`  uid=${uid} skip: 問い合わせアドレス宛てでない`);
          continue;
        }
        const { inquiry, recipient } = picked;

        if (processed[inquiry.message_id]) {
          console.log(`  uid=${uid} skip: 処理済み (${inquiry.message_id})`);
          continue;
        }

        if (repliedIds.has(inquiry.message_id)) {
          console.log(`  uid=${uid} skip: TB側で送信済み (${inquiry.message_id})`);
          processed[inquiry.message_id] = {
            at: new Date().toISOString(),
            action: "skip:replied_in_tb",
          };
          continue;
        }

        console.log(`\n  uid=${uid}  To:${recipient}  From:${inquiry.from.email}  Subj:${inquiry.subject}`);

        if (LIST_ONLY) continue;

        const r = await processOne(inquiry, index);
        if (r.skip) {
          console.log(`    SKIP: ${r.skip_reason}`);
          processed[inquiry.message_id] = { at: new Date().toISOString(), action: `skip:${r.skip_reason}` };
          continue;
        }
        const topHit = r.retrieved[0]?.title ?? "(ヒットなし)";
        console.log(`    OK (${r.elapsed_ms}ms, top: ${topHit})`);

        // 共有IMAP運用: 下書き冒頭に担当プレースホルダ。送信者が自分のイニシャルで上書き。
        const draftBody =
          [
            "[AI下書き] ← 送信前に削除してください",
            "[担当: __] ← 自分のイニシャルを記入してから送信",
            r.attachment_warning ?? "",
            r.attachment_warning ? "" : null,
            r.draft ?? "",
          ]
            .filter((x) => x !== null)
            .join("\n\n")
            .trim();

        if (DRY) {
          console.log("    --dry: Drafts保存しない");
          continue;
        }

        const raw = await composeReplyDraft({
          from: recipient, // 返信元 = 問い合わせの宛先
          to: inquiry.from.email,
          subject: makeReplySubject(inquiry.subject),
          inReplyTo: inquiry.message_id,
          references: [...(inquiry.references ?? []), inquiry.message_id],
          body: draftBody,
        });

        const appendRes = await client.append(draftsPath, raw, ["\\Draft", "\\Seen"]);
        const draftUid = (appendRes as any)?.uid as number | undefined;
        console.log(`    → Drafts にAPPEND (uid=${draftUid ?? "?"})`);

        processed[inquiry.message_id] = {
          at: new Date().toISOString(),
          action: "drafted",
          draft_uid: draftUid,
        };
      }
  await saveProcessed(processed);
}

async function main() {
  console.log(`[mother] ${IMAP_USER} に接続中... (watch=${WATCH}, dry=${DRY}, list=${LIST_ONLY}, limit=${LIMIT})`);

  const processed = await loadProcessed();
  const repliedIds = await fetchRepliedIds();
  if (repliedIds.size > 0) {
    console.log(`[mother] TB側で送信済みmsgid: ${repliedIds.size}件 (再処理をスキップ)`);
  }
  const index: IndexedDoc[] = LIST_ONLY
    ? []
    : JSON.parse(await fs.readFile(path.join(OUT, "index.json"), "utf8"));

  const client = new ImapFlow({
    host: IMAP_HOST!,
    port: Number(IMAP_PORT),
    secure: true,
    auth: { user: IMAP_USER!, pass: IMAP_PASSWORD!.replace(/\s+/g, "") },
    logger: false,
  });
  await client.connect();

  try {
    const draftsPath = await findDraftsPath(client);
    console.log(`[mother] Drafts: ${draftsPath}`);
    const ctx: Ctx = { client, draftsPath, index, processed, repliedIds };

    if (!WATCH) {
      // 一回だけ処理（朝バッチ or 手動実行用）
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try { await processBatch(ctx); } finally { lock.release(); }
    } else {
      // 常駐モード: IMAP IDLE で新着検知
      // readOnly 付きで INBOX を開くと imapflow は BODY.PEEK[] を使う（既読立てない）
      await client.mailboxOpen("INBOX", { readOnly: true });
      console.log("[mother --watch] IDLE で待機中... (Ctrl+C で終了)");

      // 起動時に既存のUNSEENを処理
      await processBatch(ctx);

      let busy = false;
      client.on("exists", async (data: any) => {
        if (busy) return;
        busy = true;
        try {
          console.log(`[mother --watch] 新着検知: exists=${data?.count}`);
          await processBatch(ctx);
        } catch (e) {
          console.error("[mother --watch] エラー:", e);
        } finally {
          busy = false;
        }
      });
      client.on("close", () => {
        console.warn("[mother --watch] IMAP接続が切れた。プロセスを終了します（再起動は外側で）");
        process.exit(1);
      });

      // 無限待機
      process.on("SIGINT", async () => {
        console.log("\n[mother --watch] 終了します");
        try { await client.logout(); } catch {}
        process.exit(0);
      });
      await new Promise<void>(() => {});
    }
  } finally {
    if (!WATCH) await client.logout();
  }

  await saveProcessed(processed);
  if (!WATCH) console.log("\n[mother] 完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
