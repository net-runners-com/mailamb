const $ = (id) => document.getElementById(id);

async function load() {
  const s = await browser.storage.local.get({ workerUrl: "", apiKey: "" });
  $("workerUrl").value = s.workerUrl;
  $("apiKey").value = s.apiKey;
}

$("save").addEventListener("click", async () => {
  await browser.storage.local.set({
    workerUrl: $("workerUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
  });
  $("msg").textContent = "保存しました";
  setTimeout(() => ($("msg").textContent = ""), 2000);
});

load();
