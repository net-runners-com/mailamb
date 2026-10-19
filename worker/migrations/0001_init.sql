-- ドキュメントのメタデータ
CREATE TABLE IF NOT EXISTS documents (
  doc_id      TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('template', 'manual', 'past_case')),
  title       TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  category    TEXT,
  tags        TEXT,                 -- JSON配列
  updated_at  INTEGER NOT NULL,     -- unix秒
  active      INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_docs_active ON documents(active);

-- チャンク索引（R2内のオフセットで原本を部分取得できるように）
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id    TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  offset      INTEGER NOT NULL,
  length      INTEGER NOT NULL,
  preview     TEXT,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

-- テンプレ使用ログ（鮮度・編集率計測用）
CREATE TABLE IF NOT EXISTS template_usage (
  usage_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id          TEXT NOT NULL,
  email_msg_id    TEXT NOT NULL,
  generated_at    INTEGER NOT NULL,
  staff_edited    INTEGER,        -- NULL=未判定, 0/1
  staff_discarded INTEGER,
  edit_distance   INTEGER,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id)
);
CREATE INDEX IF NOT EXISTS idx_usage_doc ON template_usage(doc_id);
CREATE INDEX IF NOT EXISTS idx_usage_msg ON template_usage(email_msg_id);

-- NG顧客（Workerに送らない前に止めるためのリスト）
CREATE TABLE IF NOT EXISTS ng_senders (
  email       TEXT PRIMARY KEY,
  reason      TEXT,
  added_at    INTEGER NOT NULL
);

-- 既知の配信元・自動返信ドメイン（prefilter用）
CREATE TABLE IF NOT EXISTS skip_senders (
  pattern     TEXT PRIMARY KEY,    -- 完全一致 or ドメイン一致
  kind        TEXT NOT NULL,       -- 'mailing_list' | 'auto_reply' | 'sales'
  added_at    INTEGER NOT NULL
);
