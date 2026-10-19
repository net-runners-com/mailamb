const $ = (id) => document.getElementById(id);

async function currentMessage() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try {
    return await browser.messageDisplay.getDisplayedMessage(tab.id);
  } catch {
    return null;
  }
}

function headerLookup(headers, name) {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? headers[key] : undefined;
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

async function populateIdentities(selected) {
  const identities = await browser.runtime.sendMessage({ type: "listIdentities" });
  const sel = $("fromSelect");
  sel.innerHTML = "";
  for (const id of identities) {
    const opt = document.createElement("option");
    opt.value = id.id;
    opt.textContent = id.label;
    if (selected && id.email === selected) opt.selected = true;
    sel.appendChild(opt);
  }
  if (identities.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "(アカウント未設定)";
    opt.disabled = true;
    sel.appendChild(opt);
  }
}

async function init() {
  const msg = await currentMessage();
  if (!msg) {
    $("status").textContent = "メールを選択してください";
    $("status").classList.add("error");
    return;
  }

  const full = await browser.messages.getFull(msg.id);
  // Message-ID ヘッダ (大文字小文字不定)
  let msgid = headerLookup(full.headers, "message-id");
  if (msgid && !msgid.startsWith("<")) msgid = `<${msgid}>`;
  if (!msgid) {
    $("status").textContent = "Message-ID が見つかりません";
    $("status").classList.add("error");
    return;
  }

  $("meta").hidden = false;
  $("meta").textContent = `件名: ${msg.subject}\nMsg-ID: ${msgid}`;
  $("status").textContent = "下書き取得中...";

  let draftRes;
  try {
    draftRes = await browser.runtime.sendMessage({ type: "fetchDraft", msgid });
  } catch (e) {
    $("status").textContent = `エラー: ${e.message}`;
    $("status").classList.add("error");
    return;
  }

  if (!draftRes) {
    $("status").textContent = "このメール用のAI下書きはまだ生成されていません";
    return;
  }
  if (draftRes.skip) {
    $("status").textContent = `スキップ: ${draftRes.skip_reason ?? ""}`;
    return;
  }
  $("status").textContent = `モデル: ${draftRes.model} / ${draftRes.elapsed_ms}ms`;

  // 共有IMAP: 他スタッフが既に返信中/送信済ならバッジ表示
  const state = draftRes.state;
  if (state) {
    const badge = $("stateBadge");
    badge.hidden = false;
    badge.classList.add(state.kind);
    const when = new Date(state.at).toLocaleString("ja-JP");
    if (state.kind === "replied") {
      badge.innerHTML = `✉️ 送信済 (${state.staff}) <span class="time">${when}</span>`;
    } else {
      badge.innerHTML = `✏️ 返信中 (${state.staff}) <span class="time">${when}</span>`;
    }
  }

  // 既読管理: このメールを他に誰が開いたか（共有IMAPの\Seenとは独立）
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  const myStaff = settings?.staffId ?? "";
  const views = draftRes.views ?? [];
  if (views.length > 0) {
    const vb = $("viewsBadge");
    vb.hidden = false;
    const html = views
      .map((v) => {
        const when = new Date(v.at).toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const self = v.staff === myStaff ? " self" : "";
        return `<span class="viewer${self}">${v.staff} ${when}</span>`;
      })
      .join("");
    vb.innerHTML = `<span class="label">👁 既読:</span>${html}`;
  }

  // 自分が開いたことを記録（他TBに伝搬）
  browser.runtime.sendMessage({ type: "postView", msgid }).catch(() => {});

  if (draftRes.attachment_warning) {
    $("warnBlock").hidden = false;
    $("warnBlock").textContent = draftRes.attachment_warning;
  }

  $("retrievedBlock").hidden = false;
  const hitsEl = $("retrieved");
  hitsEl.innerHTML = "";
  for (const r of draftRes.retrieved ?? []) {
    const el = document.createElement("div");
    el.className = "hit clickable";
    el.title = `クリックで全文表示: ${r.doc_id}`;
    el.dataset.docId = r.doc_id;
    el.innerHTML = `
      <span class="type">${r.type}</span>
      <span class="title">${r.title}</span>
      <span class="score">${Number(r.score).toFixed(3)}</span>
    `;
    el.addEventListener("click", async () => {
      try {
        const url = browser.runtime.getURL(`ui/doc.html?id=${encodeURIComponent(r.doc_id)}`);
        await browser.windows.create({ url, type: "popup", width: 820, height: 720 });
      } catch (e) {
        alert(`別窓を開けません: ${e.message}`);
      }
    });
    hitsEl.appendChild(el);
  }
  if ((draftRes.retrieved ?? []).length === 0) {
    hitsEl.innerHTML = `<div class="hit"><span class="title" style="color:var(--muted)">(閾値超えなし — フォールバック)</span></div>`;
  }

  $("draftBlock").hidden = false;
  $("draft").value = draftRes.draft ?? "";

  $("actionsBlock").hidden = false;
  // 元メールの To(受信した宛先) を取り出して差出人の初期選択に使う
  const toHdr = headerLookup(full.headers, "to") ?? "";
  const emailMatch = toHdr.match(/<?([^\s<>]+@[^\s<>]+)>?/);
  const preferredFrom = emailMatch ? emailMatch[1] : null;
  await populateIdentities(preferredFrom);

  $("reply").addEventListener("click", async () => {
    // 既に送信済なら警告
    if (state?.kind === "replied") {
      if (!confirm(`このメールは既に ${state.staff} が送信済です。続けますか？`)) return;
    }
    const identityId = $("fromSelect").value;
    const body = $("draft").value;
    try {
      // 「返信中」を他TBに伝える
      try {
        await browser.runtime.sendMessage({ type: "claimDraft", msgid });
      } catch (e) {
        console.warn("claim failed:", e);
      }
      await browser.runtime.sendMessage({
        type: "openReply",
        messageId: msg.id,
        from: identityId,
        body,
      });
      window.close();
    } catch (e) {
      $("status").textContent = `返信エラー: ${e.message}`;
      $("status").classList.add("error");
    }
  });

  $("copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("draft").value);
    $("copy").textContent = "コピー済";
    setTimeout(() => ($("copy").textContent = "本文コピー"), 1500);
  });

  $("markReplied").addEventListener("click", async () => {
    try {
      await browser.runtime.sendMessage({ type: "markReplied", msgid });
      $("markReplied").textContent = "送信済にしました";
      $("markReplied").disabled = true;
    } catch (e) {
      $("status").textContent = `状態更新エラー: ${e.message}`;
      $("status").classList.add("error");
    }
  });

  $("saveDraft").addEventListener("click", async () => {
    const identityId = $("fromSelect").value;
    const body = $("draft").value;
    const btn = $("saveDraft");
    btn.disabled = true; btn.textContent = "保存中…";
    try {
      await browser.runtime.sendMessage({
        type: "saveDraft",
        messageId: msg.id,
        from: identityId,
        body,
      });
      btn.textContent = "Draftsに保存済";
      setTimeout(() => { btn.textContent = "Draftsに保存"; btn.disabled = false; }, 1800);
    } catch (e) {
      btn.textContent = "Draftsに保存";
      btn.disabled = false;
      $("status").textContent = `保存エラー: ${e.message}`;
      $("status").classList.add("error");
    }
  });
}

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

init();
