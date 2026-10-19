import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processOne } from "../lib/draft.ts";
import type { Inquiry, IndexedDoc, DraftResult } from "../lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../data");
const OUT = path.resolve(__dirname, "../out");

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function main() {
  const inquiries = await readJson<Inquiry[]>(path.join(DATA, "inquiries.json"));
  const index = await readJson<IndexedDoc[]>(path.join(OUT, "index.json"));

  console.log(`[draft] ${inquiries.length} 件を処理 (index: ${index.length} 件)`);

  const results: DraftResult[] = [];
  for (const inq of inquiries) {
    process.stdout.write(`  ${inq.id} (${inq.expected_category}) ... `);
    try {
      const r = await processOne(inq, index);
      results.push(r);
      console.log(r.skip ? `skip: ${r.skip_reason}` : `OK (${r.elapsed_ms}ms, top: ${r.retrieved[0]?.title ?? "-"})`);
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
      results.push({ inquiry_id: inq.id, skip: true, skip_reason: `ERROR: ${e.message}`, retrieved: [], elapsed_ms: 0 });
    }
  }

  await fs.writeFile(path.join(OUT, "drafts.json"), JSON.stringify(results, null, 2));
  console.log(`[draft] 完了: out/drafts.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
