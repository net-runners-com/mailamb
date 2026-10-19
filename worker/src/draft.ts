import type { Env, DraftRequest, DraftResponse, DocumentRow, ChunkRow } from "./types.ts";

export async function prefilter(
  req: DraftRequest,
  env: Env
): Promise<{ skip: boolean; reason?: string }> {
  const bodyLower = req.body.toLowerCase();
  const subjectLower = req.subject.toLowerCase();

  if (subjectLower.includes("【営業】") || subjectLower.includes("[営業]")) {
    return { skip: true, reason: "営業メール（件名フィルタ）" };
  }
  if (bodyLower.includes("突然のご連絡失礼いたします") && bodyLower.includes("弊社")) {
    return { skip: true, reason: "営業メール（本文パターン）" };
  }

  // NG顧客照合
  const ng = await env.DB.prepare("SELECT reason FROM ng_senders WHERE email = ?")
    .bind(req.from.email.toLowerCase())
    .first<{ reason: string | null }>();
  if (ng) return { skip: true, reason: `NG顧客: ${ng.reason ?? "指定"}` };

  // skip_senders パターン
  const domain = req.from.email.split("@")[1]?.toLowerCase() ?? "";
  const skip = await env.DB.prepare(
    "SELECT kind FROM skip_senders WHERE pattern = ? OR pattern = ?"
  )
    .bind(req.from.email.toLowerCase(), domain)
    .first<{ kind: string }>();
  if (skip) return { skip: true, reason: `skip (${skip.kind})` };

  return { skip: false };
}

export function threadToPrompt(req: DraftRequest): string {
  if (!req.thread_history?.length) return "";
  return (
    "\n\n[これまでのやり取り]\n" +
    req.thread_history.map((m) => `--- ${m.at} / ${m.from} ---\n${m.body}`).join("\n\n")
  );
}

export function attachmentWarning(req: DraftRequest): string | undefined {
  if (!req.attachments?.length) return undefined;
  const list = req.attachments
    .map((a) => `${a.filename} (${(a.size / 1024).toFixed(0)}KB)`)
    .join(", ");
  return `⚠ 添付あり: ${list}\n⚠ 添付内容はAIに読ませていません。手動で確認してください`;
}

async function aiChat(
  env: Env,
  model: string,
  system: string,
  user: string,
  opts: { max_tokens?: number; temperature?: number } = {}
): Promise<string> {
  const res = await env.AI.run(model as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.3,
  } as any);
  return (res as any).response ?? "";
}

async function aiEmbed(env: Env, model: string, texts: string[]): Promise<number[][]> {
  const res = await env.AI.run(model as any, { text: texts } as any);
  return (res as any).data as number[][];
}

async function extractIntent(env: Env, req: DraftRequest): Promise<string> {
  const sys = "あなたはメール分類器です。日本語で、問い合わせの意図を1〜2文で要約し、カテゴリと主要キーワードを抽出してください。";
  const user = `件名: ${req.subject}\n本文:\n${req.body}`;
  return (await aiChat(env, env.GEN_MODEL, sys, user, { max_tokens: 200, temperature: 0.1 })).trim();
}

async function retrieveChunks(
  env: Env,
  queryVec: number[],
  topK: number,
  threshold: number
) {
  const matches = await env.VECTORIZE.query(queryVec, { topK, returnMetadata: "all" });
  const hits = matches.matches
    .filter((m) => m.score >= threshold)
    .map((m) => ({
      chunk_id: String(m.metadata?.chunk_id ?? m.id),
      doc_id: String(m.metadata?.doc_id ?? ""),
      type: String(m.metadata?.type ?? ""),
      score: m.score,
    }));
  if (hits.length === 0) return [];

  // doc_id単位で最高スコアのみ残す
  const bestByDoc = new Map<string, typeof hits[number]>();
  for (const h of hits) {
    const cur = bestByDoc.get(h.doc_id);
    if (!cur || cur.score < h.score) bestByDoc.set(h.doc_id, h);
  }
  const dedup = Array.from(bestByDoc.values()).sort((a, b) => b.score - a.score);

  // D1からメタ取得、R2から原本抜粋
  const results = [];
  for (const h of dedup) {
    const doc = await env.DB.prepare(
      "SELECT doc_id, type, title, r2_key FROM documents WHERE doc_id = ? AND active = 1"
    )
      .bind(h.doc_id)
      .first<Pick<DocumentRow, "doc_id" | "type" | "title" | "r2_key">>();
    if (!doc) continue;
    const chunk = await env.DB.prepare(
      "SELECT r2_key, offset, length FROM chunks WHERE chunk_id = ?"
    )
      .bind(h.chunk_id)
      .first<Pick<ChunkRow, "r2_key" | "offset" | "length">>();

    let content = "";
    if (chunk) {
      const obj = await env.DOCS.get(chunk.r2_key, {
        range: { offset: chunk.offset, length: chunk.length },
      });
      if (obj) content = await obj.text();
    }
    if (!content) {
      const obj = await env.DOCS.get(doc.r2_key);
      if (obj) content = (await obj.text()).slice(0, 2000);
    }

    results.push({ ...doc, chunk_id: h.chunk_id, score: h.score, content });
  }
  return results;
}

async function generateDraft(
  env: Env,
  req: DraftRequest,
  retrieved: Array<{ title: string; type: string; score: number; content: string }>
): Promise<string> {
  const retrievedBlock = retrieved
    .map(
      (d, i) =>
        `## 参考${i + 1} (${d.type} / score: ${d.score.toFixed(3)} / ${d.title})\n${d.content}`
    )
    .join("\n\n");

  const system = `あなたは Web制作受託会社 当社 の返信ドラフト作成アシスタントです。

【絶対ルール】
- 丁寧でビジネスライクな日本語のみを使用。英語の人名（William, John 等）や意味不明な単語を絶対に出力しない
- 事実や数字は「参考テンプレ・過去対応」に書かれているものだけを使用。存在しない機能・価格・期間を創作しない
- 問い合わせ本文に書かれていない情報を勝手に補完しない

【文体】
- 社名は「当社」、担当者名は「〇〇」（人間が後で埋める）
- 挨拶→本文→締めの3段構成
- 冒頭に「[AI下書き]」の行を入れる（人間が送信前に削除）

【生成方針】
- 参考テンプレ/過去対応が高スコア（0.7以上）でフィットしていれば、文体と構造を忠実に踏襲
- 参考スコアが低い（全て0.6未満）or 該当なしなら、具体的な価格・納期は出さず「担当者より詳細をご連絡します」と締める
- 複数の質問が含まれる場合は番号を振って個別に答える
- 添付ファイル情報は本文に含めない（別途ヘッダで通知される）`;

  const user = `[今回の問い合わせ]
件名: ${req.subject}
差出人: ${req.from.name} <${req.from.email}>
本文:
${req.body}
${threadToPrompt(req)}

[参考となる定型文・過去対応]
${retrievedBlock || "(該当なし — フォールバック対応)"}

上記を踏まえ、今回の問い合わせへの返信本文（件名除く、本文のみ）を生成してください。`;

  return (
    await aiChat(env, env.GEN_MODEL, system, user, {
      max_tokens: 1024,
      temperature: parseFloat(env.TEMPERATURE),
    })
  ).trim();
}

export async function processDraft(env: Env, req: DraftRequest): Promise<DraftResponse> {
  const t0 = Date.now();

  // 重複処理ガード
  const seen = await env.PROCESSED.get(req.message_id);
  if (seen) {
    return {
      message_id: req.message_id,
      skip: true,
      skip_reason: `処理済み (${seen})`,
      retrieved: [],
      model: env.GEN_MODEL,
      elapsed_ms: Date.now() - t0,
    };
  }

  const pre = await prefilter(req, env);
  if (pre.skip) {
    await env.PROCESSED.put(req.message_id, `skip:${pre.reason}`, {
      expirationTtl: 60 * 60 * 24 * 90,
    });
    return {
      message_id: req.message_id,
      skip: true,
      skip_reason: pre.reason,
      retrieved: [],
      model: env.GEN_MODEL,
      elapsed_ms: Date.now() - t0,
    };
  }

  const intent = await extractIntent(env, req);
  const queryText = `${intent}\n\n[本文抜粋]\n${req.body.slice(0, 500)}`;
  const [queryVec] = await aiEmbed(env, env.EMBED_MODEL, [queryText]);

  const topK = parseInt(env.RAG_TOP_K, 10);
  const threshold = parseFloat(env.RAG_THRESHOLD);
  const retrieved = await retrieveChunks(env, queryVec, topK, threshold);

  const draft = await generateDraft(env, req, retrieved);

  const response: DraftResponse = {
    message_id: req.message_id,
    skip: false,
    intent,
    retrieved: retrieved.map((r) => ({
      doc_id: r.doc_id,
      chunk_id: r.chunk_id,
      type: r.type,
      score: r.score,
      title: r.title,
    })),
    draft,
    attachment_warning: attachmentWarning(req),
    model: env.GEN_MODEL,
    elapsed_ms: Date.now() - t0,
  };

  // 処理済み記録 + 下書き全文保持（TB拡張 + 管理者ダッシュボードが参照）
  const ttl = 60 * 60 * 24 * 90;
  await env.PROCESSED.put(req.message_id, "generated", { expirationTtl: ttl });
  // 元メールのメタ情報も同梱（管理者ダッシュボード用）
  const stored = {
    ...response,
    subject: req.subject,
    from: req.from,
    received_at: req.received_at,
  };
  await env.PROCESSED.put(`draft:${req.message_id}`, JSON.stringify(stored), {
    expirationTtl: ttl,
  });

  // テンプレ使用ログ
  const now = Math.floor(Date.now() / 1000);
  for (const r of retrieved) {
    await env.DB.prepare(
      "INSERT INTO template_usage (doc_id, email_msg_id, generated_at) VALUES (?, ?, ?)"
    )
      .bind(r.doc_id, req.message_id, now)
      .run();
  }

  return response;
}
