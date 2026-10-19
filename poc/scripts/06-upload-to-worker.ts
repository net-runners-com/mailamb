// PoCの templates + past_cases を本番Workerに登録する
// 事前に .env に WORKER_URL と WORKER_API_KEY が必要
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Template, PastCase } from "../lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../data");

const { WORKER_URL, WORKER_API_KEY } = process.env;
if (!WORKER_URL || !WORKER_API_KEY) {
  console.error("WORKER_URL と WORKER_API_KEY が .env に必要");
  process.exit(1);
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function upload(body: unknown): Promise<any> {
  const res = await fetch(`${WORKER_URL}/api/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": WORKER_API_KEY! },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const templates = await readJson<Template[]>(path.join(DATA, "templates.json"));
  const pastCases = await readJson<PastCase[]>(path.join(DATA, "past_cases.json"));

  console.log(`[upload] templates: ${templates.length}, past_cases: ${pastCases.length}`);

  for (const t of templates) {
    const content = `# ${t.title}\n\nカテゴリ: ${t.category}\nタグ: ${t.tags.join(", ")}\n\n---\n\n${t.body}`;
    try {
      const r = await upload({
        doc_id: t.id,
        type: "template",
        title: t.title,
        category: t.category,
        tags: t.tags,
        content,
      });
      console.log(`  template ${t.id}: ${r.chunks} chunks`);
    } catch (e: any) {
      console.log(`  template ${t.id}: ERROR ${e.message}`);
    }
  }

  for (const c of pastCases) {
    const content = `# [${c.category}] ${c.outcome}\n\n## 問い合わせ\n${c.inquiry}\n\n## 返信\n${c.reply}\n\n## メモ\n${c.note}`;
    try {
      const r = await upload({
        doc_id: c.id,
        type: "past_case",
        title: `[${c.category}] ${c.inquiry.slice(0, 40)}`,
        category: c.category,
        tags: [c.outcome],
        content,
      });
      console.log(`  past_case ${c.id}: ${r.chunks} chunks`);
    } catch (e: any) {
      console.log(`  past_case ${c.id}: ERROR ${e.message}`);
    }
  }

  console.log("[upload] 完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
