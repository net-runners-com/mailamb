(async () => {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const msg = params.get("msg") ?? "本当に送信しますか？";
  document.getElementById("msg").textContent = msg;

  const choose = async (choice) => {
    try {
      await browser.runtime.sendMessage({ type: "confirmResponse", id, choice });
    } catch {}
    window.close();
  };
  document.getElementById("ok").addEventListener("click", () => choose(true));
  document.getElementById("cancel").addEventListener("click", () => choose(false));
  // Esc で cancel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") choose(false);
    if (e.key === "Enter") choose(true);
  });
  document.getElementById("cancel").focus();
})();
