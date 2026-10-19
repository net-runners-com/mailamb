// mailamb Email Worker
// 受信: info@example.com
// 1. 本文解析
// 2. mailamb Worker (Service Binding) に /api/draft 送信 → KVに draft 保存される
// 3. 元メールをスタッフ複数（FORWARD_TO）に転送
//
// TB拡張は転送されたメールの Message-ID を元に /api/draft/by-msgid/:msgid を叩いて下書き取得。

import PostalMime from "postal-mime";

interface Env {
  MAILAMB: Fetcher;      // Service Binding to mailamb worker
  MAILAMB_API_KEY: string; // mailamb Worker 認証用
  FORWARD_TO: string;    // 「verifiedな」宛先リスト（カンマ区切り）
  FAIL_OPEN: string;     // "true" なら生成失敗でも転送する
}

export default {
  // デバッグ用の health
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response("mailamb-email ok\n");
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const start = Date.now();
    const to = message.to;
    const from = message.from;
    console.log(`[email] from=${from} to=${to}`);

    // raw読み込み
    const rawStream = message.raw;
    const buf = await new Response(rawStream).arrayBuffer();
    const parsed = await PostalMime.parse(buf);

    const msgid = parsed.messageId ?? message.headers.get("message-id") ?? `<generated-${Date.now()}@mailamb>`;
    const subject = parsed.subject ?? "(件名なし)";
    const body = parsed.text ?? parsed.html?.replace(/<[^>]+>/g, "") ?? "";
    const senderName = parsed.from?.name ?? "";
    const senderEmail = parsed.from?.address ?? from;

    const refs = String(parsed.inReplyTo ?? "")
      .split(/\s+/)
      .filter(Boolean);

    // --- 下書き生成リクエスト ---
    const draftReq = {
      message_id: msgid,
      subject,
      from: { name: senderName, email: senderEmail },
      body,
      attachments: (parsed.attachments ?? []).map((a) => ({
        filename: a.filename ?? "unknown",
        size: (a.content as any)?.byteLength ?? 0,
      })),
      references: refs,
    };

    // 生成を待ちきらず転送優先する選択肢もあるが、PoCは同期で待つ
    try {
      const res = await env.MAILAMB.fetch("https://mailamb/api/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": env.MAILAMB_API_KEY,
        },
        body: JSON.stringify(draftReq),
      });
      if (!res.ok) {
        console.log(`[email] draft API ${res.status}: ${await res.text()}`);
        if (env.FAIL_OPEN !== "true") {
          message.setReject("downstream draft generation failed");
          return;
        }
      } else {
        const result: any = await res.json();
        console.log(`[email] draft OK (${Date.now() - start}ms) retrieved=${result.retrieved?.length ?? 0}`);
      }
    } catch (e: any) {
      console.log(`[email] draft fetch ERROR: ${e.message}`);
      if (env.FAIL_OPEN !== "true") {
        message.setReject("downstream draft generation error");
        return;
      }
    }

    // --- 転送 ---
    const dests = env.FORWARD_TO.split(",").map((s) => s.trim()).filter(Boolean);
    for (const d of dests) {
      try {
        await message.forward(d);
        console.log(`[email] forwarded → ${d}`);
      } catch (e: any) {
        console.log(`[email] forward ERROR → ${d}: ${e.message}`);
      }
    }

    console.log(`[email] done ${Date.now() - start}ms`);
  },
};
