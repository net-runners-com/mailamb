// 最小限の RFC5322 パーサ: ヘッダと本文の分離、よく使うヘッダ抽出だけ。
// Message-ID / Subject / From / To / Date / References / In-Reply-To を取り出す。

export type ParsedMail = {
  headers: Record<string, string>;
  text: string;
  messageId: string | null;
  subject: string | null;
  from: { name: string; email: string } | null;
  to: string[];
  date: string | null;
  inReplyTo: string | null;
  references: string[];
};

export function parseMail(raw: string): ParsedMail {
  const sepIndex = raw.indexOf("\r\n\r\n");
  const headerPart = sepIndex >= 0 ? raw.slice(0, sepIndex) : raw;
  const bodyPart = sepIndex >= 0 ? raw.slice(sepIndex + 4) : "";

  // 連続行 (折返し) を展開
  const unfolded: string[] = [];
  for (const line of headerPart.split(/\r\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += " " + line.trim();
    } else {
      unfolded.push(line);
    }
  }

  const headers: Record<string, string> = {};
  for (const h of unfolded) {
    const m = h.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (headers[key]) headers[key] += ", " + m[2];
    else headers[key] = m[2];
  }

  const text = decodeBody(bodyPart, headers["content-type"] || "", headers["content-transfer-encoding"] || "");

  const messageId = extractMsgId(headers["message-id"] || "");
  const from = parseAddress(headers["from"] || "");
  const to = (headers["to"] || "").split(",").map((s) => parseAddress(s)?.email ?? "").filter(Boolean);
  const references = (headers["references"] || "").split(/\s+/).filter((r) => r.startsWith("<"));
  const inReplyTo = extractMsgId(headers["in-reply-to"] || "");

  return {
    headers,
    text: text.slice(0, 20000),
    messageId,
    subject: decodeMimeHeader(headers["subject"] || ""),
    from,
    to,
    date: headers["date"] || null,
    inReplyTo,
    references,
  };
}

function extractMsgId(s: string): string | null {
  const m = s.match(/<[^>]+>/);
  return m ? m[0] : null;
}

function parseAddress(s: string): { name: string; email: string } | null {
  if (!s) return null;
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/) || s.match(/^\s*([^\s]+@[^\s]+)\s*$/);
  if (!m) return null;
  if (m.length === 3) {
    return { name: decodeMimeHeader(m[1].trim()) || "", email: m[2].trim() };
  }
  return { name: "", email: m[1].trim() };
}

// RFC 2047 MIME encoded-word のデコード (日本語件名用)
function decodeMimeHeader(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset, enc, data) => {
    try {
      let bytes: Uint8Array;
      if (enc.toLowerCase() === "b") {
        bytes = base64ToBytes(data);
      } else {
        // Q-encoded
        bytes = qpDecode(data.replace(/_/g, " "));
      }
      return new TextDecoder(charset.toLowerCase() === "utf-8" ? "utf-8" : charset).decode(bytes);
    } catch { return _; }
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function qpDecode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && i + 2 < s.length) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i));
  }
  return new Uint8Array(out);
}

function decodeBody(body: string, contentType: string, encoding: string): string {
  const charsetMatch = contentType.match(/charset="?([^";]+)"?/i);
  const charset = (charsetMatch?.[1] || "utf-8").toLowerCase();
  let bytes: Uint8Array;
  const enc = encoding.toLowerCase().trim();
  if (enc === "base64") {
    try { bytes = base64ToBytes(body.replace(/\s/g, "")); } catch { return body; }
  } else if (enc === "quoted-printable") {
    bytes = qpDecode(body.replace(/=\r\n/g, ""));
  } else {
    try { return new TextDecoder(charset).decode(new TextEncoder().encode(body)); } catch { return body; }
  }
  try { return new TextDecoder(charset).decode(bytes); } catch { return body; }
}

// === 返信用 RFC 5322 ビルダー ===

export function buildReply(opts: {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  inReplyTo: string;
  references: string[];
  body: string;
}): string {
  const date = new Date().toUTCString().replace(/GMT$/, "+0000");
  const uniq = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${opts.fromName ? `${encHeader(opts.fromName)} <${opts.fromEmail}>` : opts.fromEmail}`,
    `To: ${opts.toEmail}`,
    `Subject: ${encHeader(opts.subject)}`,
    `Date: ${date}`,
    `Message-ID: <mailamb-draft-${uniq}@mailamb.local>`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
    opts.references.length ? `References: ${opts.references.join(" ")}` : "",
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `X-Mailamb: ai-draft`,
  ].filter(Boolean);
  return headers.join("\r\n") + "\r\n\r\n" + opts.body;
}

function encHeader(s: string): string {
  if (!s) return "";
  if (!/[^\x20-\x7e]/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `=?utf-8?B?${btoa(bin)}?=`;
}
