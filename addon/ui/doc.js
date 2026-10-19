const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;","'":"&#39;"}[c]));

// 軽量Markdownレンダラ (見出し / リスト / 強調 / パラグラフ / コードライン)
function renderMarkdown(src) {
  const lines = String(src ?? "").split(/\r?\n/);
  const out = [];
  let listKind = null; // "ol" | "ul" | null
  let inPara = false;

  const closeList = () => { if (listKind) { out.push(`</${listKind}>`); listKind = null; } };
  const closePara = () => { if (inPara) { out.push("</p>"); inPara = false; } };

  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line === "") { closeList(); closePara(); continue; }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      closeList(); closePara();
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const ul = line.match(/^\s*[-*・]\s+(.+)$/);
    if (ol) {
      closePara();
      if (listKind !== "ol") { closeList(); out.push("<ol>"); listKind = "ol"; }
      out.push(`<li>${inline(ol[2])}</li>`);
      continue;
    }
    if (ul) {
      closePara();
      if (listKind !== "ul") { closeList(); out.push("<ul>"); listKind = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    closeList();
    if (!inPara) { out.push("<p>"); inPara = true; }
    else out.push("<br>");
    out.push(inline(line));
  }
  closeList(); closePara();
  return out.join("");
}

(async () => {
  const params = new URLSearchParams(location.search);
  const doc_id = params.get("id");
  if (!doc_id) {
    $("status").textContent = "doc_id が指定されていません";
    return;
  }

  try {
    const settings = await browser.runtime.sendMessage({ type: "getSettings" });
    const url = `${settings.workerUrl}/api/documents/${encodeURIComponent(doc_id)}`;
    const res = await fetch(url, {
      headers: settings.apiKey ? { "X-API-Key": settings.apiKey } : {},
    });
    if (res.status === 404) {
      $("status").textContent = `該当なし: ${doc_id}`;
      return;
    }
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const d = await res.json();

    const tagStr = (() => {
      try { return JSON.parse(d.tags ?? "[]"); } catch { return []; }
    })();

    $("status").hidden = true;

    $("meta").hidden = false;
    $("meta").innerHTML = `
      <strong>doc_id</strong> ${esc(d.doc_id)} ・
      <strong>タイプ</strong> ${esc(d.type)} ・
      <strong>カテゴリ</strong> ${esc(d.category ?? "—")}
      ${tagStr.length ? "<br>" + tagStr.map((t) => `<span class="doc-tag">${esc(t)}</span>`).join("") : ""}
    `;

    $("title").hidden = false;
    $("title").textContent = d.title ?? "(タイトルなし)";

    $("body").hidden = false;
    $("body").innerHTML = renderMarkdown(d.content ?? "(本文なし)");
  } catch (e) {
    $("status").textContent = `エラー: ${e.message}`;
    $("status").classList.add("error");
  }
})();
