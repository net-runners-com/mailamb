// Minimal IMAP client for Cloudflare Workers.
// cloudflare:sockets を使った TLS 直接接続。
// 対応: LOGIN / SELECT / SEARCH / UID FETCH / IDLE / UID STORE / APPEND / LOGOUT

import { connect } from "cloudflare:sockets";

export type ImapConfig = {
  host: string;
  port: number;        // 通常 993
  user: string;
  password: string;
  logger?: (msg: string) => void;
};

export class ImapClient {
  private socket: ReturnType<typeof connect>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private tagCounter = 0;
  private buffer = ""; // 未処理のサーバ出力
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private log: (m: string) => void;

  constructor(private config: ImapConfig) {
    this.log = config.logger ?? (() => {});
    this.socket = connect(`${config.host}:${config.port}`, { secureTransport: "on", allowHalfOpen: false });
    this.writer = this.socket.writable.getWriter();
    this.reader = this.socket.readable.getReader();
  }

  async connect() {
    // 接続後の greeting 読む (`* OK ...`)
    const greet = await this.readLine();
    this.log(`[imap] greet: ${greet}`);
    if (!greet.startsWith("* OK")) throw new Error(`unexpected greeting: ${greet}`);
  }

  private nextTag() { return `A${(++this.tagCounter).toString().padStart(4, "0")}`; }

  private async send(line: string) {
    this.log(`[imap] > ${line.replace(/\r\n$/, "")}`);
    await this.writer.write(this.encoder.encode(line));
  }

  // サーバから 1 行読む (\r\n 区切り)
  private async readLine(timeoutMs = 30000): Promise<string> {
    const start = Date.now();
    while (true) {
      const nl = this.buffer.indexOf("\r\n");
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 2);
        return line;
      }
      if (Date.now() - start > timeoutMs) throw new Error("imap read timeout");
      const { value, done } = await this.reader.read();
      if (done) throw new Error("imap connection closed");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  // タグ付きコマンド送信 → 完了まで応答読む
  private async runCommand(cmd: string): Promise<{ ok: boolean; lines: string[]; status: string }> {
    const tag = this.nextTag();
    await this.send(`${tag} ${cmd}\r\n`);
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      this.log(`[imap] < ${line}`);
      if (line.startsWith(`${tag} `)) {
        return { ok: line.startsWith(`${tag} OK`), lines, status: line.slice(tag.length + 1) };
      }
      lines.push(line);
    }
  }

  async login() {
    const r = await this.runCommand(`LOGIN "${escapeString(this.config.user)}" "${escapeString(this.config.password)}"`);
    if (!r.ok) throw new Error(`LOGIN failed: ${r.status}`);
  }

  async select(mailbox: string): Promise<{ exists: number; recent: number; uidvalidity: number }> {
    const r = await this.runCommand(`SELECT "${escapeString(mailbox)}"`);
    if (!r.ok) throw new Error(`SELECT ${mailbox} failed: ${r.status}`);
    let exists = 0, recent = 0, uidvalidity = 0;
    for (const line of r.lines) {
      const m1 = line.match(/^\* (\d+) EXISTS/);
      if (m1) exists = parseInt(m1[1]);
      const m2 = line.match(/^\* (\d+) RECENT/);
      if (m2) recent = parseInt(m2[1]);
      const m3 = line.match(/UIDVALIDITY (\d+)/);
      if (m3) uidvalidity = parseInt(m3[1]);
    }
    return { exists, recent, uidvalidity };
  }

  async searchUnseen(): Promise<number[]> {
    const r = await this.runCommand(`UID SEARCH UNSEEN`);
    if (!r.ok) throw new Error(`SEARCH failed: ${r.status}`);
    for (const line of r.lines) {
      const m = line.match(/^\* SEARCH ((?:\d+\s*)*)$/);
      if (m) return m[1].trim().split(/\s+/).filter(Boolean).map(Number);
    }
    return [];
  }

  // UID FETCH で本文を取得。BODY.PEEK[] で既読フラグ立てない。
  async fetchByUid(uid: number): Promise<string | null> {
    // literal レスポンス {N}\r\n<bytes> を含むので特殊パース
    const tag = this.nextTag();
    await this.send(`${tag} UID FETCH ${uid} (BODY.PEEK[])\r\n`);
    let source: string | null = null;
    while (true) {
      const line = await this.readLine();
      this.log(`[imap] < ${line.slice(0, 120)}`);
      if (line.startsWith(`${tag} `)) {
        if (!line.startsWith(`${tag} OK`)) throw new Error(`FETCH failed: ${line}`);
        return source;
      }
      // literal リテラル (`{N}` でサイズ指定)
      const litMatch = line.match(/\{(\d+)\}$/);
      if (litMatch) {
        const size = parseInt(litMatch[1]);
        source = await this.readBytes(size);
        // closing `)` の行を読み飛ばす (次の readLine で消化される)
      }
    }
  }

  private async readBytes(n: number): Promise<string> {
    while (this.buffer.length < n) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("connection closed during literal read");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }

  // IDLE: サーバからの push を listen。duration 経過または onEvent が true 返したら DONE 送って終了。
  // 新着があると `* <num> EXISTS` が流れる → onEvent("exists", num)
  async idle(duration: number, onEvent?: (kind: string, data: string) => Promise<boolean | void>) {
    const tag = this.nextTag();
    await this.send(`${tag} IDLE\r\n`);
    // サーバが `+ idling` を返したら IDLE 開始
    const ready = await this.readLine();
    if (!ready.startsWith("+")) throw new Error(`IDLE not accepted: ${ready}`);

    const deadline = Date.now() + duration;
    let shouldStop = false;
    while (!shouldStop && Date.now() < deadline) {
      const timeLeft = Math.max(1000, deadline - Date.now());
      try {
        const line = await this.readLine(timeLeft);
        this.log(`[imap idle] < ${line}`);
        // `* <num> EXISTS` or `* <num> EXPUNGE` or `* <num> RECENT` 等
        const m = line.match(/^\* (\d+) (\w+)/);
        if (m && onEvent) {
          const res = await onEvent(m[2], m[1]);
          if (res === true) shouldStop = true;
        }
      } catch (e: any) {
        if (String(e.message).includes("timeout")) break;
        throw e;
      }
    }

    // DONE 送って IDLE 終了
    await this.send("DONE\r\n");
    while (true) {
      const line = await this.readLine();
      this.log(`[imap] < ${line}`);
      if (line.startsWith(`${tag} `)) break;
    }
  }

  async append(mailbox: string, message: string, flags: string[] = ["\\Draft", "\\Seen"]): Promise<void> {
    const bytes = this.encoder.encode(message);
    const flagsStr = flags.length ? `(${flags.join(" ")}) ` : "";
    const tag = this.nextTag();
    await this.send(`${tag} APPEND "${escapeString(mailbox)}" ${flagsStr}{${bytes.length}}\r\n`);
    const ready = await this.readLine();
    if (!ready.startsWith("+")) throw new Error(`APPEND not accepted: ${ready}`);
    await this.writer.write(bytes);
    await this.send("\r\n");
    while (true) {
      const line = await this.readLine();
      this.log(`[imap] < ${line}`);
      if (line.startsWith(`${tag} `)) {
        if (!line.startsWith(`${tag} OK`)) throw new Error(`APPEND failed: ${line}`);
        return;
      }
    }
  }

  async logout() {
    try {
      await this.runCommand("LOGOUT");
    } finally {
      try { await this.writer.close(); } catch {}
    }
  }
}

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
