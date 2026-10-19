import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { processOne, DEFAULT_THRESHOLD, DEFAULT_TOP_K } from "../lib/draft.ts";
import type { Inquiry, Template, PastCase, IndexedDoc } from "../lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "out");
const UI = path.join(ROOT, "ui");

const PORT = Number(process.env.PORT ?? 5174);

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType + "; charset=utf-8" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function main() {
  console.log("[serve] データ読み込み中...");
  const inquiries = await readJson<Inquiry[]>(path.join(DATA, "inquiries.json"));
  const templates = await readJson<Template[]>(path.join(DATA, "templates.json"));
  const pastCases = await readJson<PastCase[]>(path.join(DATA, "past_cases.json"));
  const index = await readJson<IndexedDoc[]>(path.join(OUT, "index.json"));
  console.log(`[serve] inquiries=${inquiries.length}, templates=${templates.length}, past_cases=${pastCases.length}, index=${index.length}`);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

      if (req.method === "GET" && url.pathname === "/") {
        const html = await fs.readFile(path.join(UI, "index.html"), "utf8");
        return send(res, 200, html, "text/html");
      }

      if (req.method === "GET" && url.pathname === "/api/data") {
        return send(res, 200, { inquiries, templates, pastCases, indexCount: index.length });
      }

      if (req.method === "POST" && url.pathname === "/api/draft") {
        const body = JSON.parse(await readBody(req));
        const inq: Inquiry = {
          id: body.id ?? "custom",
          subject: body.subject ?? "",
          from: body.from ?? { name: "テストユーザー", email: "test@example.com" },
          received_at: new Date().toISOString(),
          message_id: `<custom-${Date.now()}@local>`,
          thread_history: body.thread_history,
          body: body.body ?? "",
          attachments: body.attachments ?? [],
          expected_category: body.expected_category ?? "",
          note: "",
        };
        const result = await processOne(inq, index, {
          threshold: body.threshold ?? DEFAULT_THRESHOLD,
          topK: body.topK ?? DEFAULT_TOP_K,
          model: body.model,
          temperature: body.temperature,
          systemPromptOverride: body.systemPromptOverride,
          skipPrefilter: body.skipPrefilter ?? false,
        });
        return send(res, 200, result);
      }

      send(res, 404, { error: "Not Found" });
    } catch (e: any) {
      console.error(e);
      send(res, 500, { error: e.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`\n  ⚡ http://localhost:${PORT}  開いてください\n`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
