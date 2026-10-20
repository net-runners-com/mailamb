// mailamb Thunderbird extension (minimal mode)
// 用途: 送信時の二重送信防止 + 送信後の replied 記録 + 本文バナー表示
//
// 下書き生成とDrafts保存は worker-watcher 側で完結する。
// この拡張は「送信ガード + 状態可視化」だけに絞ってる。

// ============================================================================
// 設定
// ============================================================================

const DEFAULT_SETTINGS = {
  workerUrl: "",   // 例: "https://mailamb.<subdomain>.workers.dev"
  apiKey: "",      // Worker 認証用 (X-API-Key)
  staffId: "",     // 自分の識別子 (例: tanaka)
};

async function getSettings() {
  const s = await browser.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

// ============================================================================
// Worker API
// ============================================================================

async function fetchState(msgid) {
  const { workerUrl, apiKey } = await getSettings();
  if (!workerUrl) return null;
  const res = await fetch(`${workerUrl}/api/draft/state/${encodeURIComponent(msgid)}`, {
    headers: apiKey ? { "X-API-Key": apiKey } : {},
  });
  if (!res.ok) return null;
  return (await res.json()).state ?? null;
}

async function postState(msgid, kind) {
  const { workerUrl, apiKey, staffId } = await getSettings();
  if (!workerUrl || !staffId) return;
  await fetch(`${workerUrl}/api/draft/state/${encodeURIComponent(msgid)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    body: JSON.stringify({ staff: staffId, kind }),
  });
}

// ============================================================================
// compose から 返信元 Message-ID を取り出す
// ============================================================================

async function composeInReplyTo(tabId) {
  const details = await browser.compose.getComposeDetails(tabId);
  const normalize = (v) => {
    if (!v) return null;
    if (Array.isArray(v)) v = v[0];
    return v.startsWith("<") ? v : `<${v}>`;
  };
  const custom = details.customHeaders?.find(
    (h) => h.name.toLowerCase() === "in-reply-to"
  )?.value;
  const n1 = normalize(custom);
  if (n1) return n1;
  if (details.relatedMessageId != null) {
    try {
      const full = await browser.messages.getFull(details.relatedMessageId);
      const findHdr = (name) => {
        const k = Object.keys(full.headers ?? {}).find((x) => x.toLowerCase() === name.toLowerCase());
        return k ? full.headers[k] : undefined;
      };
      return normalize(findHdr("in-reply-to"))
          || normalize(findHdr("message-id"));
    } catch {}
  }
  return null;
}

// ============================================================================
// 送信確認ポップアップ (別窓)
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
// 送信前後の state 管理
// ============================================================================

// 送信前: 元メールが既に replied なら確認ポップアップで止める
browser.compose?.onBeforeSend?.addListener?.(async (tab) => {
  try {
    const { staffId } = await getSettings();
    const msgid = await composeInReplyTo(tab.id);
    if (!msgid) return;
    const state = await fetchState(msgid);
    if (!state) return;
    const when = new Date(state.at).toLocaleString("ja-JP");
    if (state.kind === "replied") {
      const ok = await showConfirmPopup(
        `このメールは既に ${state.staff} が ${when} に送信済です。\n\n` +
        `もう一度送信しますか？（二重返信になる可能性があります）`
      );
      if (!ok) return { cancel: true };
    } else if (state.kind === "claimed" && state.staff && state.staff !== staffId) {
      const ok = await showConfirmPopup(
        `このメールは ${state.staff} が ${when} から返信中です。\n\n続けて自分が送信しますか？`
      );
      if (!ok) return { cancel: true };
    }
  } catch (e) {
    console.warn("[mailamb] onBeforeSend err:", e);
  }
});

// 送信直後: 元メールの msgid を replied に記録
browser.compose?.onAfterSend?.addListener?.(async (tab) => {
  try {
    const msgid = await composeInReplyTo(tab.id);
    if (msgid) await postState(msgid, "replied");
  } catch (e) {
    console.warn("[mailamb] onAfterSend err:", e);
  }
});

// ============================================================================
// メール表示にバナー (送信済み時のみ)
// ============================================================================

let currentDisplayedMsgId = null;
browser.messageDisplay?.onMessageDisplayed?.addListener?.(async (tab, msg) => {
  try {
    const full = await browser.messages.getFull(msg.id);
    const key = Object.keys(full.headers ?? {}).find((k) => k.toLowerCase() === "message-id");
    let mid = key ? full.headers[key] : undefined;
    if (Array.isArray(mid)) mid = mid[0];
    currentDisplayedMsgId = mid ? (mid.startsWith("<") ? mid : `<${mid}>`) : null;
  } catch {
    currentDisplayedMsgId = null;
  }
});

async function getDisplayedState() {
  if (!currentDisplayedMsgId) return { error: "no-msgid" };
  const state = await fetchState(currentDisplayedMsgId);
  return { state, message_id: currentDisplayedMsgId };
}

browser.messageDisplayScripts?.register?.({
  css: [{ file: "ui/banner.css" }],
  js: [{ file: "ui/banner.js" }],
}).catch(() => {});

// ============================================================================
// メッセージルーター
// ============================================================================

browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg?.type) {
    case "getSettings": return getSettings();
    case "getDisplayedState": return getDisplayedState();
    case "confirmResponse": {
      const resolver = PENDING_CONFIRMS.get(msg.id);
      if (resolver) { PENDING_CONFIRMS.delete(msg.id); resolver(!!msg.choice); }
      return { ok: true };
    }
  }
});
