// mailamb-watcher
// Cloudflare Workers で IMAP IDLE 55秒 窓を 1分ごとに開く "サーバーレス母艦"。
//
// 動作:
//   cron 毎分 → scheduled handler →
//     IMAP接続 → UNSEEN既存処理 → 55秒 IDLE で push待機 (新着を即処理) → 切断
//   次の cron (1分後) に次の窓
//   最大 5秒ギャップ、実質リアルタイム。
//
// シンプル・耐久性高・無料枠内。チェーンや heartbeat は使わない。

import { ImapClient } from "./imap.ts";
import { parseMail, buildReply } from "./parser.ts";

type Env = {
  MAILAMB: Fetcher;
  IMAP_HOST: string;
  IMAP_PORT: string;
  IMAP_USER: string;
  IMAP_PASSWORD: string;
  IMAP_DRAFTS: string;
  MAILAMB_API_KEY: string;
  IDLE_DURATION_MS: string;
};

const log = (...args: any[]) => console.log("[watcher]", ...args);

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runIdleWindow(env));
  },

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "mailamb-watcher" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  },
};

async function runIdleWindow(env: Env): Promise<void> {
  const duration = parseInt(env.IDLE_DURATION_MS) || 55_000;
  const client = new ImapClient({
    host: env.IMAP_HOST,
    port: parseInt(env.IMAP_PORT || "993"),
    user: env.IMAP_USER,
    password: env.IMAP_PASSWORD,
    logger: (m) => log(m),
  });
  try {
    await client.connect();
    await client.login();
    const sel = await client.select("INBOX");
    log(`SELECT INBOX exists=${sel.exists}`);

    // 既存のUNSEENを先に処理
    await processNewMails(client, env);

    // 55秒 IDLE で push待機
    log(`IDLE 開始 duration=${duration}ms`);
    await client.idle(duration, async (kind) => {
      if (kind === "EXISTS") {
        log(`EXISTS push 検知 → 処理`);
        await processNewMails(client, env);
      }
      return false;
    });
  } catch (e: any) {
    log(`loop エラー: ${e.message}`);
  } finally {
    try { await client.logout(); } catch {}
  }
}

async function processNewMails(client: ImapClient, env: Env) {
  const uids = await client.searchUnseen();
  if (uids.length === 0) return;
  log(`UNSEEN: ${uids.length}件`);
  for (const uid of uids.slice(-10)) {
    try {
      const raw = await client.fetchByUid(uid);
      if (!raw) continue;
      const mail = parseMail(raw);
      if (!mail.messageId) { log(`uid=${uid} skip: msgid無し`); continue; }

      const payload = {
        id: `watcher-${uid}`,
        subject: mail.subject || "(件名なし)",
        from: mail.from || { name: "", email: "" },
        received_at: mail.date ? new Date(mail.date).toISOString() : new Date().toISOString(),
        message_id: mail.messageId,
        body: mail.text,
        references: mail.references,
        attachments: [],
      };
      const draftRes = await env.MAILAMB.fetch("https://mailamb/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": env.MAILAMB_API_KEY },
        body: JSON.stringify(payload),
      });
      if (!draftRes.ok) { log(`uid=${uid} 生成失敗: ${draftRes.status}`); continue; }
      const draft = await draftRes.json() as any;
      if (draft.skip) { log(`uid=${uid} skip: ${draft.skip_reason}`); continue; }

      const draftBody = (draft.draft ?? "").replace(/^\s*\[AI下書き\][^\n]*\n+/, "");
      const replyRaw = buildReply({
        fromEmail: env.IMAP_USER,
        toEmail: mail.from?.email ?? "",
        subject: /^re:\s/i.test(mail.subject || "") ? (mail.subject || "") : `Re: ${mail.subject || "(件名なし)"}`,
        inReplyTo: mail.messageId,
        references: [...mail.references, mail.messageId],
        body: draftBody,
      });
      await client.append(env.IMAP_DRAFTS || "Drafts", replyRaw);
      log(`uid=${uid} ✓ APPEND to Drafts`);
    } catch (e: any) {
      log(`uid=${uid} 処理失敗: ${e.message}`);
    }
  }
}
