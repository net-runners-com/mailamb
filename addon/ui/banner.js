// Message display content script: 開いたメールの先頭に状態バナーを挿入する
(async () => {
  if (document.getElementById("mailamb-banner")) return;

  let state;
  try {
    state = await browser.runtime.sendMessage({ type: "getDisplayedState" });
  } catch (e) {
    return;
  }
  if (!state || state.error) return;

  const banner = document.createElement("div");
  banner.id = "mailamb-banner";

  const pills = [];
  if (state.hasDraft) pills.push(`<span class="mb-pill">🤖 AI下書きあり</span>`);
  if (state.views && state.views.length > 0) {
    pills.push(`<span class="mb-pill">👁 既読: ${state.views.map((v) => esc(v.staff)).join(", ")}</span>`);
  }

  let main = "";
  let cls = "state-none";
  const when = (iso) =>
    new Date(iso).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  if (state.state?.kind === "replied") {
    main = `✉️ 送信済: <strong>${esc(state.state.staff)}</strong> <span class="mb-time">${when(state.state.at)}</span>`;
    cls = "state-replied";
  } else if (state.state?.kind === "claimed") {
    main = `✏️ 返信中: <strong>${esc(state.state.staff)}</strong> <span class="mb-time">${when(state.state.at)}</span>`;
    cls = "state-claimed";
  } else if (state.hasDraft) {
    main = `🤖 AI下書き準備済 — <strong>未着手</strong>`;
    cls = "state-draft";
  } else {
    return; // 何も情報が無ければバナー出さない
  }

  banner.className = cls;
  banner.innerHTML = `<div class="mb-line">${main}${pills.length ? "　" + pills.join("") : ""}</div>`;

  if (document.body) {
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function esc(s) {
    return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
