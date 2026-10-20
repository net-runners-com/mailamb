// mailamb-watcher
// Cloudflare Workers 単体で IMAP IDLE を保持し、新着メールをリアルタイムに検知。
// 新着があれば mailamb Worker (AI生成) → Drafts に APPEND まで Workers内で完結。
//
// 動作モード:
//  1. scheduled handler (cron 1min): 保険起点。チェーン切れ検知時のみ起動。
//  2. fetch handler /loop: 自己チェーンのエンドポイント。IDLEを一定時間保持して自分を再呼出。

import { ImapClient } from "./imap.ts";
import { parseMail, buildReply } from "./parser.ts";

type Env = {
  SELF: Fetcher;
  MAILAMB: Fetcher;
  IMAP_HOST: string;
  IMAP_PORT: string;
  IMAP_USER: string;
  IMAP_PASSWORD: string;
  IMAP_DRAFTS: string;        // "Drafts" or "INBOX.Drafts" or "下書き"
  MAILAMB_API_KEY: string;
  IDLE_DURATION_MS: string;
  HEARTBEAT_WINDOW_MS: string;
  HEARTBEAT_KV?: KVNamespace;  // 任意: チェーン生存確認用 KV
};

const log = (...args: any[]) => console.log("[watcher]", ...args);

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // チェーン切れ検知。最後のループ時刻を見て、HEARTBEAT_WINDOW_MS 超えてなければ何もしない。
    if (env.HEARTBEAT_KV) {
      const last = await env.HEARTBEAT_KV.get("last_heartbeat");
      if (last && Date.now() - parseInt(last) < parseInt(env.HEARTBEAT_WINDOW_MS)) {
        log("heartbeat 新鮮、チェーン生存中、cron skip");
        return;
      }
    }
    log("cron 起点でチェーン開始");
    ctx.waitUntil(env.SELF.fetch("https://self/loop"));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === "/loop") {
      // IDLE 保持 → 新着検知 → 処理 → チェーン
      ctx.waitUntil(runLoop(env));
      return new Response("chained");
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "mailamb-watcher" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  },
};

async function runLoop(env: Env): Promise<void> {
  // heartbeat 更新
  if (env.HEARTBEAT_KV) {
    await env.HEARTBEAT_KV.put("last_heartbeat", String(Date.now()), { expirationTtl: 600 });
  }

  const duration = parseInt(env.IDLE_DURATION_MS) || 90_000;
  let client: ImapClient | null = null;
  try {
    client = new ImapClient({
      host: env.IMAP_HOST,
      port: parseInt(env.IMAP_PORT || "993"),
      user: env.IMAP_USER,
      password: env.IMAP_PASSWORD,
      logger: (m) => log(m),
    });
    await client.connect();
    await client.login();
    const sel = await client.select("INBOX");
    log(`SELECT INBOX exists=${sel.exists}`);

    // IDLE 入る前に、既存の UNSEEN があれば先に処理
    await processNewMails(client, env);

    log(`IDLE 開始 duration=${duration}ms`);
    await client.idle(duration, async (kind) => {
      if (kind === "EXISTS") {
        log(`EXISTS push 検知 → 処理`);
        await processNewMails(client!, env);
      }
      return false;
    });

    await client.logout();
  } catch (e: any) {
    log(`loop エラー: ${e.message}`);
    try { if (client) await client.logout(); } catch {}
  } finally {
    // チェーン再呼出 (fire-and-forget)
    try {
      await env.SELF.fetch("https://self/loop");
    } catch (e: any) {
      log(`chain fetch 失敗 (cron で復活待ち): ${e.message}`);
    }
  }
}

async function processNewMails(client: ImapClient, env: Env) {
  const uids = await client.searchUnseen();
  log(`UNSEEN: ${uids.length}件`);
  for (const uid of uids.slice(-10)) { // 最大10件/ループ
    try {
      const raw = await client.fetchByUid(uid);
      if (!raw) continue;
      const mail = parseMail(raw);
      if (!mail.messageId) { log(`uid=${uid} skip: msgid無し`); continue; }

      // mailamb Worker に送って下書き生成
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
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": env.MAILAMB_API_KEY,
        },
        body: JSON.stringify(payload),
      });
      if (!draftRes.ok) {
        log(`uid=${uid} 生成失敗: ${draftRes.status}`);
        continue;
      }
      const draft = await draftRes.json() as any;
      if (draft.skip) {
        log(`uid=${uid} skip: ${draft.skip_reason}`);
        continue;
      }

      // Drafts に APPEND
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
