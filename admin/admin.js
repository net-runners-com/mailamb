// mailamb 管理画面 - Worker API を叩く SPA
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const STORAGE_KEY = "mailamb.admin.settings";
let settings = { url: "", key: "" };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    settings = { url: s.url ?? "", key: s.key ?? "" };
  } catch {}
  $("s_url").value = settings.url;
  $("s_key").value = settings.key;
}

function saveSettings() {
  settings = { url: $("s_url").value.trim(), key: $("s_key").value.trim() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function api(path, opts = {}) {
  if (!settings.url) throw new Error("Worker URL が未設定です");
  const headers = { "Content-Type": "application/json" };
  if (settings.key) headers["X-API-Key"] = settings.key;
  const res = await fetch(`${settings.url}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

// ---- 接続確認 ----
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

// ---- タブ切り替え ----
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$("main > .pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${name}`));
  if (name === "activity") loadActivity();
  if (name === "knowledge") loadKnowledge();
}

// ---- Activity タブ ----
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function esc(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;","'":"&#39;"}[c])); }

async function loadActivity() {
  const tbody = $("activityBody");
  if (!settings.url) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">設定を入力してください</td></tr>`;
    return;
  }
  tbody.innerHTML = `<tr><td colspan="7" class="empty">読み込み中…</td></tr>`;
  try {
    const data = await api("/api/admin/activity?limit=200");
    $("activityMeta").textContent = `${data.count} 件`;
    if (data.count === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">まだ下書き生成されたメールはありません</td></tr>`;
      return;
    }
    tbody.innerHTML = data.items.map(renderActivityRow).join("");
    $$("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => showDetail(btn.dataset.detail));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger)">エラー: ${esc(e.message)}</td></tr>`;
  }
}

function renderActivityRow(it) {
  const stateBadge = it.state
    ? `<span class="badge ${it.state.kind}">${it.state.kind === "replied" ? "✉ 送信済" : "✏ 返信中"} / ${esc(it.state.staff)}</span>`
    : `<span class="badge none">未着手</span>`;
  const viewers = (it.views ?? [])
    .map((v) => `<span class="viewer-pill" title="${esc(v.at)}">${esc(v.staff)}</span>`)
    .join("");
  const fromStr = it.from ? `${esc(it.from.name ?? "")} &lt;${esc(it.from.email ?? "")}&gt;` : "—";
  const idEnc = encodeURIComponent(it.message_id);
  return `
    <tr>
      <td class="from">${fmtTime(it.received_at)}</td>
      <td><div class="subject" title="${esc(it.subject)}">${esc(it.subject || "(件名なし)")}</div></td>
      <td class="from">${fromStr}</td>
      <td><div class="intent" title="${esc(it.intent)}">${esc((it.intent || "").slice(0, 60))}${(it.intent || "").length > 60 ? "…" : ""}</div></td>
      <td>${stateBadge}</td>
      <td><div class="viewers">${viewers || '<span class="viewer-pill" style="background:var(--border);color:var(--muted)">0</span>'}</div></td>
      <td><button class="secondary small" data-detail="${idEnc}">詳細</button></td>
    </tr>`;
}

async function showDetail(idEnc) {
  const data = await api(`/api/draft/by-msgid/${idEnc}`);
  const modal = $("pane-detail");
  modal.classList.add("active");
  $("detailTitle").textContent = data.subject || "(件名なし)";
  $("detailBody").innerHTML = `
    <div class="modal-section"><h4>Message-ID</h4><div class="kv">${esc(data.message_id)}</div></div>
    <div class="modal-section"><h4>送信元</h4><div class="kv">${data.from ? `${esc(data.from.name ?? "")} &lt;${esc(data.from.email ?? "")}&gt;` : "—"}</div></div>
    <div class="modal-section"><h4>受信日時</h4><div class="kv">${fmtTime(data.received_at)}</div></div>
    <div class="modal-section"><h4>意図</h4><pre>${esc(data.intent ?? "")}</pre></div>
    <div class="modal-section"><h4>RAG ヒット</h4><pre>${(data.retrieved ?? []).map((r) => `[${r.type}] ${r.title} (${Number(r.score).toFixed(3)})`).join("\n") || "—"}</pre></div>
    <div class="modal-section"><h4>AI下書き</h4><pre>${esc(data.draft ?? "")}</pre></div>
    <div class="modal-section"><h4>状態</h4><pre>${data.state ? JSON.stringify(data.state, null, 2) : "未着手"}</pre></div>
    <div class="modal-section"><h4>既読者</h4><pre>${JSON.stringify(data.views ?? [], null, 2)}</pre></div>
  `;
}
$("detailClose").addEventListener("click", () => $("pane-detail").classList.remove("active"));
$("pane-detail").addEventListener("click", (e) => { if (e.target === $("pane-detail")) $("pane-detail").classList.remove("active"); });

// ---- Knowledge タブ ----
async function loadKnowledge() {
  const tbody = $("knowledgeBody");
  tbody.innerHTML = `<tr><td colspan="7" class="empty">読み込み中…</td></tr>`;
  try {
    const list = await api("/api/documents");
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">まだナレッジが登録されていません</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((d) => `
      <tr>
        <td class="from">${esc(d.doc_id)}</td>
        <td><span class="badge claimed">${esc(d.type)}</span></td>
        <td><div class="subject" title="${esc(d.title)}">${esc(d.title)}</div></td>
        <td class="from">${esc(d.category ?? "—")}</td>
        <td class="from">${fmtTime(new Date(d.updated_at * 1000).toISOString())}</td>
        <td>${d.active ? '<span class="badge replied">有効</span>' : '<span class="badge none">無効</span>'}</td>
        <td>${d.active ? `<button class="danger small" data-del="${esc(d.doc_id)}">無効化</button>` : "—"}</td>
      </tr>`).join("");
    $$("[data-del]").forEach((b) => b.addEventListener("click", () => deleteDoc(b.dataset.del)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger)">エラー: ${esc(e.message)}</td></tr>`;
  }
}

async function deleteDoc(doc_id) {
  if (!confirm(`${doc_id} を無効化しますか？（RAG検索対象から外れます）`)) return;
  try {
    await api(`/api/documents/${encodeURIComponent(doc_id)}`, { method: "DELETE" });
    await loadKnowledge();
  } catch (e) {
    alert(`削除エラー: ${e.message}`);
  }
}

$("addKnowledgeBtn").addEventListener("click", () => {
  $("knowledgeForm").hidden = false;
  $("k_doc_id").focus();
});
$("k_cancel").addEventListener("click", () => {
  $("knowledgeForm").hidden = true;
  ["k_doc_id","k_title","k_category","k_tags","k_content"].forEach((id) => ($(id).value = ""));
});
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
    setTimeout(() => {
      $("knowledgeForm").hidden = true;
      ["k_doc_id","k_title","k_category","k_tags","k_content"].forEach((id) => ($(id).value = ""));
      loadKnowledge();
    }, 800);
  } catch (e) {
    msg.className = "msg ng"; msg.textContent = `保存エラー: ${e.message}`;
  }
});

// ---- Settings タブ ----
$("s_save").addEventListener("click", async () => {
  saveSettings();
  const msg = $("s_msg");
  const ok = await checkConnection();
  msg.className = ok ? "msg ok" : "msg ng";
  msg.textContent = ok ? "保存して接続確認OK" : "保存したが接続NG";
  setTimeout(() => (msg.textContent = ""), 2500);
});

// ---- Tabs + 初期化 ----
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
$("refreshBtn").addEventListener("click", async () => {
  const ok = await checkConnection();
  if (ok) {
    const active = document.querySelector(".tab.active").dataset.tab;
    if (active === "activity") loadActivity();
    if (active === "knowledge") loadKnowledge();
  }
});

loadSettings();
checkConnection().then((ok) => {
  if (ok) loadActivity();
});
