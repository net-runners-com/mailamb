import type { Env, DraftRequest } from "./types.ts";
import { processDraft } from "./draft.ts";
import { ingestDocument, type IngestInput } from "./ingest.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    },
  });
}

function requireAuth(req: Request, env: Env): Response | null {
  if (!env.API_KEY) return null; // 未設定なら開放（開発時）
  const key = req.headers.get("X-API-Key") ?? req.headers.get("Authorization")?.replace(/^Bearer\s+/, "");
  if (key !== env.API_KEY) return json({ error: "unauthorized" }, 401);
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") return json({});

    // Health
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "mailamb", model: env.GEN_MODEL });
    }

    // --- /api/draft ---
    if (url.pathname === "/api/draft" && req.method === "POST") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      try {
        const body = (await req.json()) as DraftRequest;
        if (!body.message_id || !body.body) {
          return json({ error: "message_id and body are required" }, 400);
        }
        const result = await processDraft(env, body);
        return json(result);
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    // --- /api/documents (ingest) ---
    if (url.pathname === "/api/documents" && req.method === "POST") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      try {
        const body = (await req.json()) as IngestInput;
        if (!body.doc_id || !body.content || !body.type || !body.title) {
          return json({ error: "doc_id, type, title, content required" }, 400);
        }
        const result = await ingestDocument(env, body);
        return json(result);
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    // --- /api/documents (list) ---
    if (url.pathname === "/api/documents" && req.method === "GET") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const rows = await env.DB.prepare(
        "SELECT doc_id, type, title, category, tags, updated_at, active FROM documents ORDER BY updated_at DESC"
      ).all();
      return json(rows.results ?? []);
    }

    // --- /api/draft/state/:msgid (shared-mailbox 二重返信防止) ---
    // POST { staff, kind: "claimed"|"replied" }
    // claimed: 30min TTL (他スタッフが「返信中」を見られる)
    // replied: 90day TTL (送信済み)
    const stateMatch = url.pathname.match(/^\/api\/draft\/state\/(.+)$/);
    if (stateMatch && req.method === "POST") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const msgid = decodeURIComponent(stateMatch[1]);
      try {
        const body = (await req.json()) as { staff?: string; kind?: string };
        const staff = (body.staff ?? "").trim();
        const kind = body.kind === "replied" ? "replied" : "claimed";
        if (!staff) return json({ error: "staff required" }, 400);
        const state = { staff, kind, at: new Date().toISOString() };
        const ttl = kind === "replied" ? 60 * 60 * 24 * 90 : 60 * 30;
        await env.PROCESSED.put(`state:${msgid}`, JSON.stringify(state), {
          expirationTtl: ttl,
        });
        return json({ ok: true, state });
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    if (stateMatch && req.method === "GET") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const msgid = decodeURIComponent(stateMatch[1]);
      const raw = await env.PROCESSED.get(`state:${msgid}`);
      if (!raw) return json({ state: null, message_id: msgid });
      return json({ state: JSON.parse(raw), message_id: msgid });
    }

    // --- /api/log (拡張デバッグ用: ログ収集、任意) ---
    if (url.pathname === "/api/log" && req.method === "POST") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      try {
        const body = (await req.json()) as { source?: string; level?: string; msg?: string };
        const entry = {
          at: new Date().toISOString(),
          source: body.source ?? "unknown",
          level: body.level ?? "info",
          msg: String(body.msg ?? "").slice(0, 2000),
        };
        const key = `log:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await env.PROCESSED.put(key, JSON.stringify(entry), {
          expirationTtl: 60 * 60, // 1時間
        });
        return json({ ok: true });
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }
    if (url.pathname === "/api/log" && req.method === "GET") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const list = await env.PROCESSED.list({ prefix: "log:", limit: 100 });
      const entries: any[] = [];
      await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.PROCESSED.get(k.name);
          if (raw) entries.push({ key: k.name, ...JSON.parse(raw) });
        })
      );
      entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return json({ count: entries.length, entries });
    }

    // --- /api/admin/activity (管理者ダッシュボード用: 送信済み一覧) ---
    // ミニマム構成: 下書き本文はKVに持たないので、state:replied の一覧のみ
    if (url.pathname === "/api/admin/activity" && req.method === "GET") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const result = await env.PROCESSED.list({ prefix: "state:" });
      const items: any[] = [];
      await Promise.all(
        result.keys.map(async (k) => {
          const raw = await env.PROCESSED.get(k.name);
          if (!raw) return;
          const s = JSON.parse(raw);
          items.push({
            message_id: k.name.slice("state:".length),
            state: s,
          });
        })
      );
      items.sort((a, b) =>
        String(b.state?.at ?? "").localeCompare(String(a.state?.at ?? ""))
      );
      return json({ count: items.length, items });
    }

    // --- /api/documents/:id (delete / soft) ---
    const docMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (docMatch && req.method === "DELETE") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const doc_id = docMatch[1];
      await env.DB.prepare("UPDATE documents SET active = 0 WHERE doc_id = ?").bind(doc_id).run();
      return json({ ok: true, doc_id });
    }

    // --- /api/documents/:id (get full content) ---
    if (docMatch && req.method === "GET") {
      const unauth = requireAuth(req, env);
      if (unauth) return unauth;
      const doc_id = docMatch[1];
      const row = await env.DB.prepare(
        "SELECT doc_id, type, title, category, tags, r2_key, updated_at, active FROM documents WHERE doc_id = ?"
      ).bind(doc_id).first();
      if (!row) return json({ error: "not found", doc_id }, 404);
      let content = "";
      if (row.r2_key) {
        const obj = await env.DOCS.get(String(row.r2_key));
        if (obj) content = await obj.text();
      }
      return json({ ...row, content });
    }

    return json({ error: "not found" }, 404);
  },
};
