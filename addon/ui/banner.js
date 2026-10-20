// Message display content script: 開いたメールが「返信中」「送信済」なら本文先頭にバナー
(async () => {
  if (document.getElementById("mailamb-banner")) return;
  let res;
  try {
    res = await browser.runtime.sendMessage({ type: "getDisplayedState" });
  } catch { return; }
  if (!res || res.error || !res.state) return;

  const state = res.state;
  const when = new Date(state.at).toLocaleString("ja-JP", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  const banner = document.createElement("div");
  banner.id = "mailamb-banner";
  if (state.kind === "replied") {
    banner.className = "state-replied";
    banner.innerHTML = `✉️ 送信済: <strong>${esc(state.staff)}</strong> <span class="mb-time">${when}</span>`;
  } else if (state.kind === "claimed") {
    banner.className = "state-claimed";
    banner.innerHTML = `✏️ 返信中: <strong>${esc(state.staff)}</strong> <span class="mb-time">${when}</span>`;
  } else {
    return;
  }

  if (document.body) document.body.insertBefore(banner, document.body.firstChild);

  function esc(s) {
    return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
