export interface Inquiry {
  id: string;
  subject: string;
  from: { name: string; email: string };
  received_at: string;
  message_id: string;
  in_reply_to?: string;
  references?: string[];
  thread_history?: ThreadMessage[];
  body: string;
  attachments: Attachment[];
  expected_category: string;
  note: string;
}

export interface ThreadMessage {
  from: string;
  at: string;
  body: string;
}

export interface Attachment {
  filename: string;
  size: number;
}

export interface Template {
  id: string;
  title: string;
  category: string;
  tags: string[];
  body: string;
}

export interface PastCase {
  id: string;
  category: string;
  inquiry: string;
  reply: string;
  outcome: string;
  note: string;
}

export interface IndexedDoc {
  id: string;
  type: "template" | "past_case";
  title: string;
  content: string;
  vector: number[];
}

export interface DraftResult {
  inquiry_id: string;
  skip: boolean;
  skip_reason?: string;
  intent?: string;
  retrieved: { id: string; type: string; score: number; title: string }[];
  draft?: string;
  attachment_warning?: string;
  elapsed_ms: number;
}
