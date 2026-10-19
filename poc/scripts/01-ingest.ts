import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embed } from "../lib/cf-ai.ts";
import type { Template, PastCase, IndexedDoc } from "../lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../data");
const OUT = path.resolve(__dirname, "../out");

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

function templateToDoc(t: Template): { id: string; type: "template"; title: string; content: string } {
  return {
    id: t.id,
    type: "template",
    title: t.title,
    content: `[カテゴリ: ${t.category}]\n[タグ: ${t.tags.join(", ")}]\n[タイトル: ${t.title}]\n\n${t.body}`,
  };
}

function pastCaseToDoc(c: PastCase): { id: string; type: "past_case"; title: string; content: string } {
  return {
    id: c.id,
    type: "past_case",
    title: `[${c.category}] ${c.inquiry.slice(0, 40)}`,
    content: `[カテゴリ: ${c.category}]\n[結果: ${c.outcome}]\n\n[問い合わせ本文]\n${c.inquiry}\n\n[実際の返信]\n${c.reply}`,
  };
}

async function main() {
  const templates = await readJson<Template[]>(path.join(DATA, "templates.json"));
  const pastCases = await readJson<PastCase[]>(path.join(DATA, "past_cases.json"));

  const docs = [
    ...templates.map(templateToDoc),
    ...pastCases.map(pastCaseToDoc),
  ];
  console.log(`[ingest] ${docs.length} 件を embedding します (templates: ${templates.length}, past_cases: ${pastCases.length})`);

  // bge-m3 のバッチサイズに注意（CFは最大100件/callだが安全に20ずつ）
  const BATCH = 20;
  const indexed: IndexedDoc[] = [];
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    console.log(`  batch ${i / BATCH + 1}: embedding ${chunk.length} items...`);
    const vectors = await embed(chunk.map((d) => d.content));
    chunk.forEach((d, j) => indexed.push({ ...d, vector: vectors[j] }));
  }

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, "index.json"), JSON.stringify(indexed, null, 2));
  console.log(`[ingest] 完了: ${indexed.length} 件を out/index.json に保存`);
  console.log(`  dim: ${indexed[0].vector.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
