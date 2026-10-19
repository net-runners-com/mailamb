import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Inquiry, DraftResult } from "../lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../data");
const OUT = path.resolve(__dirname, "../out");

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function main() {
  const inquiries = await readJson<Inquiry[]>(path.join(DATA, "inquiries.json"));
  const drafts = await readJson<DraftResult[]>(path.join(OUT, "drafts.json"));
  const inqMap = new Map(inquiries.map((i) => [i.id, i]));

  const lines: string[] = [];
  lines.push(`# PoC 評価結果 (${new Date().toISOString()})\n`);
  lines.push(`入力: ${inquiries.length} 件 / 結果: ${drafts.length} 件`);
  const skipped = drafts.filter((d) => d.skip).length;
  const generated = drafts.length - skipped;
  lines.push(`- 生成: ${generated} 件\n- スキップ: ${skipped} 件\n`);

  // 人間評価シート
  lines.push(`\n## 評価シート\n`);
  lines.push(`各行、以下4軸で◎○△×を手で埋めてください:`);
  lines.push(`- **意図把握**: 問い合わせの意図を正しく捉えているか`);
  lines.push(`- **テンプレ適合**: 引っ張ってきた参考が妥当か`);
  lines.push(`- **文体**: 当社の返信として自然か`);
  lines.push(`- **直し量**: そのまま送れる(◎) / 微修正(○) / 書き直し半分(△) / 使えない(×)\n`);

  lines.push(`| ID | カテゴリ | 意図把握 | テンプレ適合 | 文体 | 直し量 | メモ |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const d of drafts) {
    const inq = inqMap.get(d.inquiry_id)!;
    lines.push(`| ${d.inquiry_id} | ${inq.expected_category} |  |  |  |  |  |`);
  }

  // 各結果の詳細
  lines.push(`\n---\n\n## 詳細\n`);
  for (const d of drafts) {
    const inq = inqMap.get(d.inquiry_id)!;
    lines.push(`\n### ${d.inquiry_id}: ${inq.subject}`);
    lines.push(`\n- カテゴリ(期待): \`${inq.expected_category}\``);
    lines.push(`- 差出人: ${inq.from.name} <${inq.from.email}>`);
    lines.push(`- 処理時間: ${d.elapsed_ms}ms`);
    if (d.skip) {
      lines.push(`- **SKIP**: ${d.skip_reason}`);
      continue;
    }
    lines.push(`- 抽出意図: ${d.intent?.replace(/\n/g, " ")}`);
    lines.push(`\n**RAGヒット**:`);
    if (d.retrieved.length === 0) {
      lines.push(`- (閾値超えなし → フォールバック)`);
    } else {
      for (const r of d.retrieved) {
        lines.push(`- \`${r.id}\` [${r.type}] score=${r.score.toFixed(3)} — ${r.title}`);
      }
    }
    lines.push(`\n**問い合わせ本文**:\n\n\`\`\`\n${inq.body}\n\`\`\``);
    if (d.attachment_warning) {
      lines.push(`\n**添付警告**: ${d.attachment_warning}`);
    }
    lines.push(`\n**AI下書き**:\n\n\`\`\`\n${d.draft}\n\`\`\`\n`);
    lines.push(`---`);
  }

  const outFile = path.join(OUT, "report.md");
  await fs.writeFile(outFile, lines.join("\n"));
  console.log(`[eval] out/report.md を生成`);

  // サマリ統計
  const avgMs = drafts.filter((d) => !d.skip).reduce((a, d) => a + d.elapsed_ms, 0) / Math.max(generated, 1);
  console.log(`  生成件数: ${generated}, スキップ: ${skipped}, 平均生成時間: ${avgMs.toFixed(0)}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
