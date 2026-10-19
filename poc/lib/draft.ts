import { embed, chat } from "./cf-ai.ts";
import { topK } from "./cosine.ts";
import type { Inquiry, IndexedDoc, DraftResult } from "./types.ts";

export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_TOP_K = 5;

export function prefilter(inq: Inquiry): { skip: boolean; reason?: string } {
  const bodyLower = inq.body.toLowerCase();
  const subjectLower = inq.subject.toLowerCase();

  if (subjectLower.includes("【営業】") || subjectLower.includes("[営業]")) {
    return { skip: true, reason: "営業メール（件名フィルタ）" };
  }
  if (bodyLower.includes("突然のご連絡失礼いたします") && bodyLower.includes("弊社")) {
    return { skip: true, reason: "営業メール（本文パターン）" };
  }
  if (inq.expected_category === "採用(別対応)") {
    return { skip: true, reason: "採用応募（担当者に転送）" };
  }
  return { skip: false };
}

export function threadToPromptSection(inq: Inquiry): string {
  if (!inq.thread_history || inq.thread_history.length === 0) return "";
  const history = inq.thread_history
    .map((m) => `--- ${m.at} / ${m.from} ---\n${m.body}`)
    .join("\n\n");
  return `\n\n[これまでのやり取り]\n${history}\n`;
}

export function attachmentWarning(inq: Inquiry): string | undefined {
  if (!inq.attachments || inq.attachments.length === 0) return undefined;
  const list = inq.attachments
    .map((a) => `${a.filename} (${(a.size / 1024).toFixed(0)}KB)`)
    .join(", ");
  return `⚠ 添付あり: ${list}\n⚠ 添付内容はAIに読ませていません。手動で確認してください`;
}

export async function extractIntent(inq: Inquiry): Promise<string> {
  const sys = "あなたはメール分類器です。日本語で、問い合わせの意図を1〜2文で要約し、カテゴリと主要キーワードを抽出してください。";
  const user = `件名: ${inq.subject}\n本文:\n${inq.body}`;
  const res = await chat(sys, user, { max_tokens: 200, temperature: 0.1 });
  return res.trim();
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  systemPromptOverride?: string;
}

export async function generateDraft(
  inq: Inquiry,
  retrieved: (IndexedDoc & { score: number })[],
  opts: GenerateOptions = {}
): Promise<string> {
  const retrievedBlock = retrieved
    .map((d, i) => `## 参考${i + 1} (${d.type} / score: ${d.score.toFixed(3)} / ${d.title})\n${d.content}`)
    .join("\n\n");

  const defaultSystem = `あなたは Web制作受託会社 当社 の返信ドラフト作成アシスタントです。
以下のルールを守ってください:
- 丁寧でビジネスライクな日本語
- 社名は「当社」、担当者名は「〇〇」(人間が後で埋める)
- 挨拶→本文→締めの3段構成
- 参考テンプレ/過去対応がフィットしていれば、文体と構造を踏襲
- 参考に該当がなければ、担当者からの折り返しを提案
- 根拠のない価格・納期を提示しない
- 冒頭に「[AI下書き]」の行を入れる（人間が送信前に削除）`;

  const system = opts.systemPromptOverride ?? defaultSystem;
  const thread = threadToPromptSection(inq);
  const user = `[今回の問い合わせ]
件名: ${inq.subject}
差出人: ${inq.from.name} <${inq.from.email}>
本文:
${inq.body}
${thread}

[参考となる定型文・過去対応]
${retrievedBlock || "(該当なし — フォールバック対応)"}

上記を踏まえ、今回の問い合わせへの返信本文（件名除く、本文のみ）を生成してください。`;

  return (await chat(system, user, {
    model: opts.model,
    max_tokens: 1024,
    temperature: opts.temperature ?? 0.3,
  })).trim();
}

export interface ProcessOptions extends GenerateOptions {
  threshold?: number;
  topK?: number;
  skipPrefilter?: boolean;
}

export async function processOne(
  inq: Inquiry,
  index: IndexedDoc[],
  opts: ProcessOptions = {}
): Promise<DraftResult> {
  const t0 = Date.now();
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const k = opts.topK ?? DEFAULT_TOP_K;

  if (!opts.skipPrefilter) {
    const pre = prefilter(inq);
    if (pre.skip) {
      return { inquiry_id: inq.id, skip: true, skip_reason: pre.reason, retrieved: [], elapsed_ms: Date.now() - t0 };
    }
  }

  const intent = await extractIntent(inq);
  const queryText = `${intent}\n\n[本文抜粋]\n${inq.body.slice(0, 500)}`;
  const [queryVec] = await embed([queryText]);
  const hits = topK(queryVec, index, k, threshold);

  const draft = await generateDraft(inq, hits, opts);

  return {
    inquiry_id: inq.id,
    skip: false,
    intent,
    retrieved: hits.map((h) => ({ id: h.id, type: h.type, score: h.score, title: h.title })),
    draft,
    attachment_warning: attachmentWarning(inq),
    elapsed_ms: Date.now() - t0,
  };
}
