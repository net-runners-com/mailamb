const $ = (id) => document.getElementById(id);

async function load() {
  const s = await browser.storage.local.get({
    workerUrl: "", apiKey: "", staffId: "", enableAutoDraft: true, inquiryAddresses: "",
  });
  $("workerUrl").value = s.workerUrl;
  $("apiKey").value = s.apiKey;
  $("staffId").value = s.staffId;
  $("enableAutoDraft").checked = s.enableAutoDraft !== false;
  $("inquiryAddresses").value = s.inquiryAddresses;
}

$("save").addEventListener("click", async () => {
  await browser.storage.local.set({
    workerUrl: $("workerUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    staffId: $("staffId").value.trim(),
    enableAutoDraft: $("enableAutoDraft").checked,
    inquiryAddresses: $("inquiryAddresses").value.trim(),
  });
  $("msg").textContent = "保存しました";
  setTimeout(() => ($("msg").textContent = ""), 2000);
});

load();
