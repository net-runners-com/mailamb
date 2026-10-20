// mailamb-admin dashboard
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

let settings = { workerUrl: "", apiKey: "" };

async function loadSettings() {
  settings = await browser.runtime.sendMessage({ type: "getSettings" });
  $("s_url").value = settings.workerUrl;
  $("s_key").value = settings.apiKey;
}

async function saveSettings() {
  const workerUrl = $("s_url").value.trim();
  const apiKey = $("s_key").value.trim();
  await browser.storage.local.set({ workerUrl, apiKey });
  settings = { workerUrl, apiKey };
}

async function api(path, opts = {}) {
  if (!settings.workerUrl) throw new Error("Worker URL が未設定");
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["X-API-Key"] = settings.apiKey;
  const res = await fetch(`${settings.workerUrl}${path}`, {
    ...opts, headers: { ...headers, ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function checkConnection() {
  const dot = $("connStatus"), label = $("connLabel");
  dot.className = "dot pending"; label.textContent = "確認中…";
  try {
    const h = await api("/health");
    dot.className = "dot ok"; label.textContent = `接続OK (${h.model ?? "?"})`;
    return true;
  } catch (e) {
    dot.className = "dot ng"; label.textContent = `接続NG: ${e.message}`;
    return false;
  }
}

function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$("main > .pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${name}`));
  if (name === "knowledge") loadKnowledge();
  if (name === "sent") loadSent();
}

const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;","'":"&#39;"}[c]));
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("ja-JP", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
}) : "—";

// ============== ナレッジ一覧 ==============
async function loadKnowledge() {
  const tbody = $("knowledgeBody");
  tbody.innerHTML = `<tr><td colspan="7" class="empty">読み込み中…</td></tr>`;
  try {
    const list = await api("/api/documents");
    $("knowledgeMeta").textContent = `${list.length} 件`;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">まだナレッジが登録されていません</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((d) => `
      <tr>
        <td class="from">${esc(d.doc_id)}</td>
        <td><span class="badge type">${esc(d.type)}</span></td>
        <td><div class="subject" title="${esc(d.title)}">${esc(d.title)}</div></td>
        <td class="from">${esc(d.category ?? "—")}</td>
        <td class="from">${fmtTime(new Date(d.updated_at * 1000).toISOString())}</td>
        <td>${d.active ? '<span class="badge ok">有効</span>' : '<span class="badge none">無効</span>'}</td>
        <td>${d.active ? `<button class="danger small" data-del="${esc(d.doc_id)}">無効化</button>` : "—"}</td>
      </tr>`).join("");
    $$("[data-del]").forEach((b) => b.addEventListener("click", () => deleteDoc(b.dataset.del)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger)">エラー: ${esc(e.message)}</td></tr>`;
  }
}

async function deleteDoc(doc_id) {
  if (!confirm(`${doc_id} を無効化しますか？`)) return;
  try {
    await api(`/api/documents/${encodeURIComponent(doc_id)}`, { method: "DELETE" });
    await loadKnowledge();
  } catch (e) { alert(`削除エラー: ${e.message}`); }
}

// ============== 送信履歴 ==============
async function loadSent() {
  const tbody = $("sentBody");
  tbody.innerHTML = `<tr><td colspan="4" class="empty">読み込み中…</td></tr>`;
  try {
    const data = await api("/api/admin/activity");
    $("sentMeta").textContent = `${data.count} 件`;
    if (data.count === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">まだ送信記録はありません</td></tr>`;
      return;
    }
    tbody.innerHTML = data.items.map((it) => {
      const s = it.state ?? {};
      const kindBadge = s.kind === "replied"
        ? `<span class="badge ok">✉ 送信済</span>`
        : s.kind === "claimed"
          ? `<span class="badge warn">✏ 返信中</span>`
          : `<span class="badge none">—</span>`;
      return `
        <tr>
          <td class="from">${fmtTime(s.at)}</td>
          <td><div class="subject" title="${esc(it.message_id)}">${esc((it.message_id || "").slice(0, 60))}</div></td>
          <td>${kindBadge}</td>
          <td>${esc(s.staff ?? "")}</td>
        </tr>`;
    }).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty" style="color:var(--danger)">エラー: ${esc(e.message)}</td></tr>`;
  }
}

// ============== ナレッジ追加 (直接入力) ==============
function clearForm() {
  ["k_doc_id", "k_title", "k_category", "k_tags", "k_content"].forEach((id) => ($(id).value = ""));
  $("k_type").value = "template";
}

$("k_clear").addEventListener("click", clearForm);

$("k_save").addEventListener("click", async () => {
  const msg = $("k_msg"); msg.className = "msg"; msg.textContent = "";
  const payload = {
    doc_id: $("k_doc_id").value.trim(),
    type: $("k_type").value,
    title: $("k_title").value.trim(),
    category: $("k_category").value.trim(),
    tags: $("k_tags").value.split(",").map((s) => s.trim()).filter(Boolean),
    content: $("k_content").value,
  };
  if (!payload.doc_id || !payload.title || !payload.content) {
    msg.className = "msg ng"; msg.textContent = "doc_id, タイトル, 本文は必須";
    return;
  }
  try {
    const r = await api("/api/documents", { method: "POST", body: JSON.stringify(payload) });
    msg.className = "msg ok"; msg.textContent = `保存: ${r.doc_id} (${r.chunks ?? "?"} chunks)`;
    setTimeout(() => { clearForm(); msg.textContent = ""; }, 1500);
  } catch (e) {
    msg.className = "msg ng"; msg.textContent = `保存エラー: ${e.message}`;
  }
});

// ============== ナレッジ追加 (ファイルアップロード) ==============
async function handleFile(file) {
  const text = await file.text();
  const name = file.name;

  if (name.endsWith(".eml")) {
    // .eml パース: Subject と本文抽出
    const sepIdx = text.indexOf("\r\n\r\n") >= 0 ? text.indexOf("\r\n\r\n") : text.indexOf("\n\n");
    const headerPart = sepIdx >= 0 ? text.slice(0, sepIdx) : text;
    const bodyPart = sepIdx >= 0 ? text.slice(sepIdx + (text.includes("\r\n\r\n") ? 4 : 2)) : "";
    const subject = extractHeader(headerPart, "subject") || "(no subject)";
    const from = extractHeader(headerPart, "from") || "";
    $("k_type").value = "past_case";
    $("k_doc_id").value = `case-${Date.now().toString(36)}`;
    $("k_title").value = subject.slice(0, 100);
    $("k_content").value = `## 元メール (${from})\n${bodyPart.trim()}`;
  } else if (name.endsWith(".md") || name.endsWith(".txt")) {
    $("k_type").value = "template";
    $("k_doc_id").value = `tpl-${name.replace(/\.(md|txt)$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36).slice(-4)}`;
    const firstLine = text.split(/\r?\n/)[0].replace(/^#\s*/, "").trim();
    $("k_title").value = firstLine || name.replace(/\.(md|txt)$/, "");
    $("k_content").value = text;
  } else if (name.endsWith(".html")) {
    $("k_type").value = "reference";
    $("k_doc_id").value = `ref-${Date.now().toString(36)}`;
    $("k_title").value = name.replace(/\.html$/, "");
    $("k_content").value = text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  } else {
    alert(`未対応ファイル形式: ${name}`);
    return;
  }
  switchTab("add");
}

function extractHeader(headerPart, name) {
  const lines = [];
  let acc = "";
  for (const line of headerPart.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && acc) acc += " " + line.trim();
    else { if (acc) lines.push(acc); acc = line; }
  }
  if (acc) lines.push(acc);
  const re = new RegExp(`^${name}:\\s*(.*)$`, "i");
  for (const l of lines) {
    const m = l.match(re);
    if (m) {
      // decode MIME header =?utf-8?B?xxx?=
      return m[1].replace(/=\?utf-8\?B\?([^?]+)\?=/gi, (_, b64) => {
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new TextDecoder("utf-8").decode(bytes);
        } catch { return _; }
      });
    }
  }
  return null;
}

const dz = $("dropzone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault(); dz.classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// ============== Settings ==============
$("s_save").addEventListener("click", async () => {
  await saveSettings();
  const msg = $("s_msg");
  const ok = await checkConnection();
  msg.className = ok ? "msg ok" : "msg ng";
  msg.textContent = ok ? "保存して接続確認OK" : "保存したが接続NG";
  setTimeout(() => (msg.textContent = ""), 2500);
});

// ============== 初期化 ==============
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
$("refreshBtn").addEventListener("click", async () => {
  await loadSettings();
  const ok = await checkConnection();
  if (ok) {
    const active = document.querySelector(".tab.active").dataset.tab;
    if (active === "knowledge") loadKnowledge();
    if (active === "sent") loadSent();
  }
});

(async () => {
  await loadSettings();
  const ok = await checkConnection();
  if (ok) loadKnowledge();
})();
