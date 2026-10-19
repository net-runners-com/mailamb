// mailamb Thunderbird extension - background
// 共有IMAP運用で AI 下書き生成・状態共有・二重送信防止を担当する。
// 本番の処理フローは addon/README.md を参照。

// ============================================================================
// 1. 設定
// ============================================================================

const DEFAULT_SETTINGS = {
  workerUrl: "",            // 例: "https://mailamb.<subdomain>.workers.dev"
  apiKey: "",               // Worker 認証用（X-API-Key）
  staffId: "",              // 共有運用で誰が返信中/送信済かを区別する識別子
  enableAutoDraft: true,    // 新着メール自動 Draft 保存
  inquiryAddresses: "",     // カンマ区切り。空なら全着信対象
  fromIdentities: [],       // 旧版互換（未使用）
};

async function getSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// ============================================================================
// 2. ロギング (TB console + Worker /api/log)
// ============================================================================

async function clog(level, ...parts) {
  const msg = parts.map((p) => (typeof p === "string" ? p : safeJson(p))).join(" ");
  (level === "error" ? console.error : console.log)("[mailamb]", ...parts);
  try {
    const { workerUrl, apiKey, staffId } = await getSettings();
    if (!workerUrl) return;
    await fetch(`${workerUrl}/api/log`, {
      method: "POST",
      headers: jsonHeaders(apiKey),
      body: JSON.stringify({ source: `addon:${staffId || "?"}`, level, msg }),
    });
  } catch {}
}

function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function jsonHeaders(apiKey) {
  return { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) };
}

// ============================================================================
// 3. Worker API クライアント
// ============================================================================

async function workerFetch(path, init = {}) {
  const { workerUrl, apiKey } = await getSettings();
  if (!workerUrl) throw new Error("Worker URL が未設定（オプションで設定してください）");
  const res = await fetch(`${workerUrl}${path}`, {
    ...init,
    headers: { ...jsonHeaders(apiKey), ...(init.headers || {}) },
  });
  return res;
}

async function fetchDraftByMsgId(msgid) {
  const res = await workerFetch(`/api/draft/by-msgid/${encodeURIComponent(msgid)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return await res.json();
}

async function fetchState(msgid) {
  const res = await workerFetch(`/api/draft/state/${encodeURIComponent(msgid)}`);
  if (!res.ok) return null;
  return (await res.json()).state ?? null;
}

async function postState(msgid, kind) {
  const { staffId } = await getSettings();
  if (!staffId) throw new Error("設定でスタッフIDを登録してください");
  const res = await workerFetch(`/api/draft/state/${encodeURIComponent(msgid)}`, {
    method: "POST",
    body: JSON.stringify({ staff: staffId, kind }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return await res.json();
}

async function postView(msgid) {
  const { staffId } = await getSettings();
  if (!staffId) throw new Error("設定でスタッフIDを登録してください");
  const res = await workerFetch(`/api/draft/view/${encodeURIComponent(msgid)}`, {
    method: "POST",
    body: JSON.stringify({ staff: staffId }),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function claimImapSaved(msgid) {
  const { staffId } = await getSettings();
  if (!staffId) return { ok: false, existing: null };
  const res = await workerFetch(`/api/draft/imap-saved/${encodeURIComponent(msgid)}`, {
    method: "POST",
    body: JSON.stringify({ staff: staffId }),
  });
  if (!res.ok) return { ok: false, existing: null };
  return await res.json();
}

async function requestDraftGeneration(payload) {
  const res = await workerFetch(`/api/draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    await clog("error", `requestDraftGeneration failed: ${res.status}`);
    return null;
  }
  return await res.json();
}

// ============================================================================
// 4. TB ヘルパー (headers / identities / folders / compose)
// ============================================================================

function headerFromFull(full, name) {
  const key = Object.keys(full.headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  let v = key ? full.headers[key] : undefined;
  if (Array.isArray(v)) v = v[0];
  return v || null;
}

function normalizeMsgId(v) {
  if (!v) return null;
  if (Array.isArray(v)) v = v[0];
  return v.startsWith("<") ? v : `<${v}>`;
}

function extractMsgId(full) {
  return normalizeMsgId(headerFromFull(full, "message-id"));
}

async function listIdentities() {
  const accounts = await browser.accounts.list();
  const items = [];
  for (const a of accounts) {
    for (const id of a.identities ?? []) {
      items.push({
        id: id.id,
        label: `${id.name || id.email} <${id.email}>`,
        accountId: a.id,
        email: id.email,
      });
    }
  }
  return items;
}

async function findDraftsFolder(accountId) {
  const account = await browser.accounts.get(accountId);
  if (!account) return null;
  const walk = (folders) => {
    for (const f of folders ?? []) {
      if ((f.specialUse ?? []).includes("drafts") || f.type === "drafts") return f;
      const sub = walk(f.subFolders);
      if (sub) return sub;
    }
    return null;
  };
  return walk(account.folders);
}

// compose窓から「返信元の Message-ID」を取り出す。
// 優先: 1) customHeaders の In-Reply-To / 2) relatedMessage の In-Reply-To / 3) relatedMessage の Message-ID
async function composeInReplyTo(tabId) {
  const details = await browser.compose.getComposeDetails(tabId);
  const custom = details.customHeaders?.find((h) => h.name.toLowerCase() === "in-reply-to")?.value;
  const n1 = normalizeMsgId(custom);
  if (n1) return n1;
  if (details.relatedMessageId != null) {
    try {
      const full = await browser.messages.getFull(details.relatedMessageId);
      return normalizeMsgId(headerFromFull(full, "in-reply-to"))
          || normalizeMsgId(headerFromFull(full, "message-id"));
    } catch {}
  }
  return null;
}

// ============================================================================
// 5. RFC 5322 ビルダー + タグ
// ============================================================================

function encHeader(s) {
  if (!s) return "";
  if (!/[^\x20-\x7e]/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `=?utf-8?B?${btoa(bin)}?=`;
}

const AI_SUBJECT_PREFIX = "[AI下書き] "; // 旧版下書きの送信前クリーンアップ用
const MAILAMB_TAG_KEY = "mailamb-ai-draft";

function buildRfc5322({ fromEmail, fromName, toEmail, subject, inReplyTo, references, body }) {
  const date = new Date().toUTCString().replace(/GMT$/, "+0000");
  const uniq = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${fromName ? `${encHeader(fromName)} <${fromEmail}>` : fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${date}`,
    `Message-ID: <mailamb-draft-${uniq}@mailamb.local>`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
    references && references.length ? `References: ${references.join(" ")}` : "",
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `X-Mailamb: ai-draft`,
  ].filter(Boolean);
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// 初回のみ "AI下書き" タグを登録 (TB 128+ API / 旧 API 両対応)
async function ensureAiDraftTag() {
  try {
    const list = browser.messages?.tags?.list ?? browser.messages?.listTags;
    const create = browser.messages?.tags?.create ?? browser.messages?.createTag;
    if (!list) { await clog("error", "tag API 利用不可"); return; }
    const tags = await list.call(browser.messages?.tags ?? browser.messages);
    if (tags.find((t) => t.key === MAILAMB_TAG_KEY || t.tag === "AI下書き")) return;
    if (!create) { await clog("error", "tag create API 利用不可"); return; }
    await create.call(browser.messages?.tags ?? browser.messages, MAILAMB_TAG_KEY, "AI下書き", "#2a7fb8");
    await clog("info", `tag '${MAILAMB_TAG_KEY}' を作成`);
  } catch (e) {
    await clog("error", `tag 作成失敗: ${e.message}`);
  }
}
ensureAiDraftTag();

// ============================================================================
// 6. Draft 保存 (messages.import ベース, compose窓を開かない)
// ============================================================================

async function buildReplyInfo(originalMessageId, identityId, draftBody) {
  const full = await browser.messages.getFull(originalMessageId);
  const origMsgid = extractMsgId(full) || "";
  const origSubject = headerFromFull(full, "subject") || "(件名なし)";
  const origFromRaw = headerFromFull(full, "from") || "";
  const toMatch = origFromRaw.match(/<?([^\s<>]+@[^\s<>]+)>?/);
  const identities = await listIdentities();
  const me = identities.find((i) => i.id === identityId) || identities[0];
  const origRefs = (headerFromFull(full, "references") || "").split(/\s+/).filter(Boolean);
  return {
    fromEmail: me.email,
    fromName: "",
    toEmail: toMatch ? toMatch[1] : origFromRaw,
    subject: /^re:\s/i.test(origSubject) ? origSubject : `Re: ${origSubject}`,
    inReplyTo: origMsgid,
    references: [...origRefs, origMsgid].filter(Boolean),
    body: draftBody,
    accountId: me.accountId,
  };
}

async function saveReplyAsDraft({ messageId, from, body }) {
  await clog("info", `saveReplyAsDraft start msg=${messageId} identity=${from}`);
  const info = await buildReplyInfo(messageId, from, body);
  const draftsFolder = await findDraftsFolder(info.accountId);
  if (!draftsFolder) {
    await clog("error", `Drafts フォルダが見つからない (account=${info.accountId})`);
    throw new Error(`Drafts フォルダが見つかりません (account=${info.accountId})`);
  }
  const raw = buildRfc5322(info);
  const file = new File(
    [new Blob([raw], { type: "message/rfc822" })],
    `draft-${Date.now()}.eml`,
    { type: "message/rfc822" }
  );
  try {
    const imported = await browser.messages.import(file, draftsFolder, {
      new: false, read: false, tags: [MAILAMB_TAG_KEY],
    });
    await clog("info", `✓ imported to ${draftsFolder.path} (id=${imported?.id})`);
    return { ok: true, imported };
  } catch (e) {
    await clog("error", `messages.import 失敗: ${e.message}`);
    throw e;
  }
}

// パネルの「下書きで返信」用: compose窓を開く (保存はしない)
async function openReplyWith({ messageId, from, body }) {
  return await browser.compose.beginReply(messageId, "replyToSender", {
    identityId: from,
    plainTextBody: body,
    isPlainText: true,
  });
}

// ============================================================================
// 7. 新着メール自動 Draft 化
// ============================================================================

const AUTO_PROCESSED = new Set();
const AUTO_PENDING = new Map(); // mid -> { tb_msgid, triedAt, attempts }

// 問い合わせ宛先リストでフィルタ (空なら全着信対象)
async function isInquiryMail(full) {
  const { inquiryAddresses } = await getSettings();
  const allow = inquiryAddresses.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length === 0) return true;
  const to = (headerFromFull(full, "to") || "").toLowerCase();
  return allow.some((a) => to.includes(a));
}

// TB側メールから Inquiry payload を組み立てて Worker に生成要求
async function generateDraftFromTbMail(tb_msgid, mid) {
  const full = await browser.messages.getFull(tb_msgid);
  const detail = await browser.messages.get(tb_msgid);

  // text/plain → なければ text/html から tags剥がし
  const extractBody = (part, matcher, stripHtml = false) => {
    if (matcher(part) && part.body) {
      return stripHtml ? part.body.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ") : part.body;
    }
    for (const p of part.parts ?? []) {
      const r = extractBody(p, matcher, stripHtml);
      if (r) return r;
    }
    return null;
  };
  const body = extractBody(full, (p) => p.contentType?.startsWith("text/plain"))
            || extractBody(full, (p) => p.contentType?.startsWith("text/html"), true)
            || "";

  const fromMatch = (detail.author ?? "").match(/([^<]*)<([^>]+)>/)
                 || [null, detail.author ?? "", detail.author ?? ""];
  const result = await requestDraftGeneration({
    id: `tb-${tb_msgid}`,
    subject: detail.subject ?? "(件名なし)",
    from: { name: (fromMatch[1] || "").trim(), email: (fromMatch[2] || "").trim() },
    received_at: new Date(detail.date ?? Date.now()).toISOString(),
    message_id: mid,
    body: body.slice(0, 10000),
    references: [],
    attachments: [],
  });
  if (result) await clog("info", `拡張で生成完了 elapsed=${result.elapsed_ms}ms skip=${result.skip}`);
  return result;
}

// draft + 元メールから claim → identity 決定 → saveReplyAsDraft
async function processAutoDraftWithDraft(tb_msgid, mid, draft) {
  const full = await browser.messages.getFull(tb_msgid);
  const claim = await claimImapSaved(mid);
  if (!claim.ok) {
    await clog("info", `claim済 by ${claim.existing?.staff ?? "?"}: ${mid}`);
    return;
  }
  const toHdr = headerFromFull(full, "to");
  const prefEmail = (toHdr ?? "").match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1];
  const identities = await listIdentities();
  const identity = (prefEmail && identities.find((i) => i.email === prefEmail)) || identities[0];
  if (!identity) {
    await clog("error", `identity 無し: ${mid}`);
    return;
  }
  const cleanDraft = (draft.draft ?? "").replace(/^\s*\[AI下書き\][^\n]*\n+/, "");
  const body = [draft.attachment_warning ?? "", cleanDraft].filter(Boolean).join("\n\n").trim();
  await saveReplyAsDraft({ messageId: tb_msgid, from: identity.id, body });
  await clog("info", `✓ auto-drafted: ${mid}`);
}

async function autoDraft(msgHeader) {
  try {
    const full = await browser.messages.getFull(msgHeader.id);
    const mid = extractMsgId(full);
    await clog("info", `onNewMailReceived tb_msgid=${msgHeader.id} mid=${mid}`);
    if (!mid || AUTO_PROCESSED.has(mid)) {
      await clog("info", `skip: already processed or no mid`);
      return;
    }
    if (!(await isInquiryMail(full))) {
      await clog("info", `skip: not in allowlist`);
      AUTO_PROCESSED.add(mid);
      return;
    }
    let draft = await fetchDraftByMsgId(mid);
    if (!draft) {
      // KV未存在 → 拡張自身が生成要求 (CF Email Routing 未発火でも動く)
      await clog("info", `KV未存在 → 即生成要求: ${mid}`);
      draft = await generateDraftFromTbMail(msgHeader.id, mid);
      if (!draft) {
        await clog("error", `生成失敗、retry queue入: ${mid}`);
        AUTO_PENDING.set(mid, { tb_msgid: msgHeader.id, triedAt: Date.now(), attempts: 0 });
        return;
      }
    }
    AUTO_PROCESSED.add(mid);
    if (draft.skip) {
      await clog("info", `skip (${draft.skip_reason}): ${mid}`);
      return;
    }
    await processAutoDraftWithDraft(msgHeader.id, mid, draft);
  } catch (e) {
    await clog("error", `autoDraft 失敗: ${e.message}`);
  }
}

// KV にまだ下書きが無い場合の retry (10秒間隔、3回で拡張生成fallback、10回で諦め)
async function retryPending() {
  if (AUTO_PENDING.size === 0) return;
  const now = Date.now();
  for (const [mid, info] of AUTO_PENDING.entries()) {
    if (info.attempts >= 10) {
      await clog("info", `retry 諦め: ${mid}`);
      AUTO_PENDING.delete(mid);
      continue;
    }
    if (now - info.triedAt < 10000) continue;
    info.attempts++;
    info.triedAt = now;
    try {
      let draft = await fetchDraftByMsgId(mid);
      if (!draft && info.attempts >= 3) {
        await clog("info", `retry ${info.attempts}回目: 拡張から生成要求`);
        draft = await generateDraftFromTbMail(info.tb_msgid, mid);
      }
      if (draft && !draft.skip) {
        await clog("info", `retry HIT (${info.attempts}回目): ${mid}`);
        AUTO_PENDING.delete(mid);
        AUTO_PROCESSED.add(mid);
        await processAutoDraftWithDraft(info.tb_msgid, mid, draft);
      } else if (draft?.skip) {
        AUTO_PENDING.delete(mid);
      }
    } catch (e) {
      await clog("error", `retry err ${mid}: ${e.message}`);
    }
  }
}
setInterval(retryPending, 10000);

// ============================================================================
// 8. 二重送信防止: 別窓ポップアップ確認
// ============================================================================

const PENDING_CONFIRMS = new Map();

async function showConfirmPopup(message) {
  return new Promise(async (resolve) => {
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    PENDING_CONFIRMS.set(id, resolve);
    const url = browser.runtime.getURL(
      `ui/confirm.html?id=${encodeURIComponent(id)}&msg=${encodeURIComponent(message)}`
    );
    try {
      await browser.windows.create({ url, type: "popup", width: 500, height: 240 });
    } catch {
      PENDING_CONFIRMS.delete(id);
      resolve(false);
      return;
    }
    setTimeout(() => {
      if (PENDING_CONFIRMS.has(id)) { PENDING_CONFIRMS.delete(id); resolve(false); }
    }, 60000);
  });
}

// ============================================================================
// 9. メール表示 (バナー注入用の state 問い合わせ)
// ============================================================================

let currentDisplayedMsgId = null;

async function getDisplayedState() {
  if (!currentDisplayedMsgId) return { error: "no-msgid" };
  const { workerUrl } = await getSettings();
  if (!workerUrl) return { error: "no-worker-url" };
  try {
    const d = await fetchDraftByMsgId(currentDisplayedMsgId);
    if (!d) return { hasDraft: false, state: null, views: [] };
    return {
      hasDraft: true,
      state: d.state ?? null,
      views: d.views ?? [],
      message_id: currentDisplayedMsgId,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================================
// 10. イベント登録
// ============================================================================

// (10-1) バナー注入する content script
browser.messageDisplayScripts?.register?.({
  css: [{ file: "ui/banner.css" }],
  js: [{ file: "ui/banner.js" }],
}).catch((e) => console.warn("mailamb: messageDisplayScripts.register", e));

// (10-2) 現在表示中のメールの Message-ID を追跡
browser.messageDisplay?.onMessageDisplayed?.addListener?.(async (tab, msg) => {
  try {
    const full = await browser.messages.getFull(msg.id);
    currentDisplayedMsgId = extractMsgId(full);
  } catch {
    currentDisplayedMsgId = null;
  }
});

// (10-3) 新着メール自動 Draft 化
browser.messages?.onNewMailReceived?.addListener?.(async (folder, msgs) => {
  const { workerUrl, enableAutoDraft } = await getSettings();
  if (!workerUrl || enableAutoDraft === false) return;
  for (const m of msgs.messages ?? []) autoDraft(m); // 並列
});

// (10-4) compose窓が開いた瞬間に state チェック → macOS 通知
browser.tabs?.onCreated?.addListener?.(async (tab) => {
  if (tab.type !== "messageCompose") return;
  try {
    await new Promise((r) => setTimeout(r, 400)); // compose初期化を待つ
    const { workerUrl, staffId } = await getSettings();
    if (!workerUrl) return;
    const msgid = await composeInReplyTo(tab.id);
    if (!msgid) return;
    const state = await fetchState(msgid);
    if (!state) return;
    const when = new Date(state.at).toLocaleString("ja-JP");
    if (state.kind === "replied") {
      await clog("info", `compose open: replied by ${state.staff}`);
      await notify("⚠️ 二重返信注意", `このメールは既に ${state.staff} が ${when} に送信済です`);
    } else if (state.kind === "claimed" && state.staff && state.staff !== staffId) {
      await notify("✏️ 他スタッフが返信中", `${state.staff} が ${when} から返信中です`);
    }
  } catch (e) {
    await clog("error", `compose open check 失敗: ${e.message}`);
  }
});

async function notify(title, message) {
  try {
    await browser.notifications.create(`mailamb-${Date.now()}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/64.png"),
      title, message,
    });
  } catch {
    try { alert(`${title}\n${message}`); } catch {}
  }
}

// (10-5) 送信前: [AI下書き] 件名除去 + state チェック → 確認ポップアップで最終ブロック
browser.compose?.onBeforeSend?.addListener?.(async (tab, details) => {
  try {
    // 旧版下書きの件名プレフィックス削除
    const subj = details?.subject ?? "";
    if (subj.startsWith(AI_SUBJECT_PREFIX)) {
      const cleaned = subj.slice(AI_SUBJECT_PREFIX.length);
      await browser.compose.setComposeDetails(tab.id, { subject: cleaned });
      await clog("info", `件名 [AI下書き] 自動削除: ${cleaned.slice(0, 40)}`);
    }
    // state 確認
    const { staffId } = await getSettings();
    const msgid = await composeInReplyTo(tab.id);
    if (!msgid) return;
    const state = await fetchState(msgid);
    if (!state) return;
    await clog("info", `onBeforeSend state=${state.kind} by=${state.staff}`);
    const when = new Date(state.at).toLocaleString("ja-JP");
    if (state.kind === "replied") {
      const ok = await showConfirmPopup(
        `このメールは既に ${state.staff} が ${when} に送信済です。\n\n` +
        `もう一度送信しますか？\n（二重返信になる可能性があります）`
      );
      if (!ok) { await clog("info", `送信キャンセル (replied重複)`); return { cancel: true }; }
    } else if (state.kind === "claimed" && state.staff && state.staff !== staffId) {
      const ok = await showConfirmPopup(
        `このメールは ${state.staff} が ${when} から返信中です。\n\n続けて自分が送信しますか？`
      );
      if (!ok) { await clog("info", `送信キャンセル (他スタッフclaim)`); return { cancel: true }; }
    }
  } catch (e) {
    await clog("error", `onBeforeSend err: ${e.message}`);
  }
});

// (10-6) 送信直後: replied 記録
browser.compose?.onAfterSend?.addListener?.(async (tab) => {
  try {
    const msgid = await composeInReplyTo(tab.id);
    if (msgid) await postState(msgid, "replied");
  } catch (e) {
    await clog("error", `onAfterSend err: ${e.message}`);
  }
});

// ============================================================================
// 11. メッセージルーター (panel.js / options.js / confirm.js からの呼び出し)
// ============================================================================

browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg?.type) {
    case "getSettings":       return getSettings();
    case "listIdentities":    return listIdentities();
    case "fetchDraft":        return fetchDraftByMsgId(msg.msgid);
    case "openReply":         return openReplyWith(msg);
    case "saveDraft":         return saveReplyAsDraft(msg);
    case "claimDraft":        return postState(msg.msgid, "claimed");
    case "markReplied":       return postState(msg.msgid, "replied");
    case "postView":          return postView(msg.msgid);
    case "getDisplayedState": return getDisplayedState();
    case "confirmResponse": {
      const resolver = PENDING_CONFIRMS.get(msg.id);
      if (resolver) { PENDING_CONFIRMS.delete(msg.id); resolver(!!msg.choice); }
      return { ok: true };
    }
  }
});
