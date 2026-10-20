// mailamb-admin: 管理者用ダッシュボード
// ツールバーボタン → TB内タブで dashboard.html 開く

browser.browserAction?.onClicked?.addListener?.(async () => {
  await browser.tabs.create({ url: browser.runtime.getURL("ui/dashboard.html") });
});

// 設定取得 (dashboard から参照用)
const DEFAULT_SETTINGS = { workerUrl: "", apiKey: "" };

async function getSettings() {
  const s = await browser.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "getSettings") return getSettings();
});
