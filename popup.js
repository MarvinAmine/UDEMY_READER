// popup.js – store / load Google TTS API key

document.addEventListener("DOMContentLoaded", () => {
  const keyInput = document.getElementById("googleKey");
  const saveBtn = document.getElementById("saveKey");
  const statusEl = document.getElementById("saveStatus");

  if (!chrome?.storage?.sync) {
    statusEl.textContent = "chrome.storage.sync not available.";
    return;
  }

  // Load existing key
  chrome.storage.sync.get(["czGoogleTtsKey"], (res) => {
    keyInput.value = res.czGoogleTtsKey || "";
  });

  saveBtn.addEventListener("click", () => {
    const key = keyInput.value.trim();
    chrome.storage.sync.set({ czGoogleTtsKey: key }, () => {
      statusEl.textContent = key ? "Key saved." : "Key cleared.";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 1500);
    });
  });
});
