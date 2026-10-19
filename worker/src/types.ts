export interface Env {
  AI: Ai;
  VECTORIZE: Vectorize;
  DB: D1Database;
  DOCS: R2Bucket;
  PROCESSED: KVNamespace;
  GEN_MODEL: string;
  EMBED_MODEL: string;
  RAG_THRESHOLD: string;
  RAG_TOP_K: string;
  TEMPERATURE: string;
  API_KEY?: string;
}

export interface DraftRequest {
  message_id: string;
  subject: string;
  from: { name: string; email: string };
  body: string;
  thread_history?: { from: string; at: string; body: string }[];
  attachments?: { filename: string; size: number }[];
}

export interface DraftResponse {
  message_id: string;
  skip: boolean;
  skip_reason?: string;
  intent?: string;
  retrieved: { doc_id: string; chunk_id: string; type: string; score: number; title: string }[];
  draft?: string;
  attachment_warning?: string;
  model: string;
  elapsed_ms: number;
}

export interface DocumentRow {
  doc_id: string;
  type: "template" | "manual" | "past_case";
  title: string;
  r2_key: string;
  category: string | null;
  tags: string | null;
  updated_at: number;
  active: number;
}

export interface ChunkRow {
  chunk_id: string;
  doc_id: string;
  r2_key: string;
  offset: number;
  length: number;
  preview: string | null;
}
