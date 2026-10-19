import type { Env, DocumentRow } from "./types.ts";

// 500トークン目安でチャンク分割（簡易：日本語500文字単位、オーバーラップ100文字）
export function chunkText(text: string, size = 500, overlap = 100) {
  const chunks: { offset: number; length: number; content: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    chunks.push({ offset: i, length: end - i, content: text.slice(i, end) });
    if (end === text.length) break;
    i = end - overlap;
  }
  return chunks;
}

export interface IngestInput {
  doc_id: string;
  type: "template" | "manual" | "past_case";
  title: string;
  category?: string;
  tags?: string[];
  content: string;
}

export async function ingestDocument(env: Env, input: IngestInput) {
  const now = Math.floor(Date.now() / 1000);
  const r2_key = `${input.type}s/${input.doc_id}.md`;

  // 1. R2に原本保存
  await env.DOCS.put(r2_key, input.content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });

  // 2. 既存ベクトルをパージ（同じdoc_idで更新時）
  const existing = await env.DB.prepare("SELECT chunk_id FROM chunks WHERE doc_id = ?")
    .bind(input.doc_id)
    .all<{ chunk_id: string }>();
  if (existing.results?.length) {
    await env.VECTORIZE.deleteByIds(existing.results.map((r) => r.chunk_id));
    await env.DB.prepare("DELETE FROM chunks WHERE doc_id = ?").bind(input.doc_id).run();
  }

  // 3. D1 documents にUPSERT
  await env.DB.prepare(
    `INSERT INTO documents (doc_id, type, title, r2_key, category, tags, updated_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(doc_id) DO UPDATE SET
       type = excluded.type,
       title = excluded.title,
       r2_key = excluded.r2_key,
       category = excluded.category,
       tags = excluded.tags,
       updated_at = excluded.updated_at,
       active = 1`
  )
    .bind(
      input.doc_id,
      input.type,
      input.title,
      r2_key,
      input.category ?? null,
      JSON.stringify(input.tags ?? []),
      now
    )
    .run();

  // 4. チャンク分割 + embed + Vectorize upsert
  const pieces = chunkText(input.content);
  const texts = pieces.map((p) => {
    const header = `[タイトル: ${input.title}]\n[カテゴリ: ${input.category ?? "-"}]\n\n`;
    return header + p.content;
  });

  // AIバッチ (bge-m3は複数text同時可)
  const embedRes = await env.AI.run(env.EMBED_MODEL as any, { text: texts } as any);
  const vectors = (embedRes as any).data as number[][];

  // D1にchunks登録
  const chunkInserts = pieces.map((p, i) => {
    const chunk_id = `${input.doc_id}:${i}`;
    return env.DB.prepare(
      "INSERT INTO chunks (chunk_id, doc_id, r2_key, offset, length, preview) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(chunk_id, input.doc_id, r2_key, p.offset, p.length, p.content.slice(0, 100));
  });
  await env.DB.batch(chunkInserts);

  // Vectorize upsert
  const vectorRecords = pieces.map((p, i) => ({
    id: `${input.doc_id}:${i}`,
    values: vectors[i],
    metadata: {
      doc_id: input.doc_id,
      chunk_id: `${input.doc_id}:${i}`,
      type: input.type,
      category: input.category ?? "",
      updated_at: now,
    },
  }));
  await env.VECTORIZE.upsert(vectorRecords);

  return { doc_id: input.doc_id, chunks: pieces.length };
}
