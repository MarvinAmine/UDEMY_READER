// popup.js – manage Google TTS key, LLM config, and weak-topic summary

document.addEventListener("DOMContentLoaded", () => {
  const googleKeyInput = document.getElementById("googleKey");
  const saveTtsBtn = document.getElementById("saveKey");
  const saveStatusEl = document.getElementById("saveStatus");

  const llmKeyInput = document.getElementById("llmKey");
  const llmModelInput = document.getElementById("llmModel");
  const saveLlmBtn = document.getElementById("saveLlm");
  const llmSaveStatusEl = document.getElementById("llmSaveStatus");

  const highlightToggle = document.getElementById("highlightToggle");
  const highlightStatusEl = document.getElementById("highlightStatus");
  const whyToggle = document.getElementById("whyToggle");
  const whyStatusEl = document.getElementById("whyStatus");

  const weakTopicsList = document.getElementById("weakTopicsList");

  if (!chrome?.storage?.sync) {
    saveStatusEl.textContent = "chrome.storage.sync not available.";
    llmSaveStatusEl.textContent = "chrome.storage.sync not available.";
    if (highlightStatusEl) {
      highlightStatusEl.textContent =
        "chrome.storage.sync not available.";
    }
    if (whyStatusEl) {
      whyStatusEl.textContent = "chrome.storage.sync not available.";
    }
    return;
  }

  // Load existing keys/configs
  chrome.storage.sync.get(
    [
      "czGoogleTtsKey",
      "czLlmApiKey",
      "czLlmModel",
      "czHighlightEnabled",
      "czWhyEnabled"
    ],
    (res) => {
      googleKeyInput.value = res.czGoogleTtsKey || "";
      llmKeyInput.value = res.czLlmApiKey || "";
      llmModelInput.value = res.czLlmModel || "gpt-5.1";
      if (highlightToggle) {
        highlightToggle.checked =
          res.czHighlightEnabled === undefined
            ? true
            : !!res.czHighlightEnabled;
      }
      if (whyToggle) {
        whyToggle.checked =
          res.czWhyEnabled === undefined ? true : !!res.czWhyEnabled;
      }
    }
  );

  saveTtsBtn.addEventListener("click", () => {
    const key = googleKeyInput.value.trim();
    chrome.storage.sync.set({ czGoogleTtsKey: key }, () => {
      saveStatusEl.textContent = key ? "TTS key saved." : "TTS key cleared.";
      setTimeout(() => (saveStatusEl.textContent = ""), 1500);
    });
  });

  saveLlmBtn.addEventListener("click", () => {
    const key = llmKeyInput.value.trim();
    const model = llmModelInput.value.trim() || "gpt-5.1";
    chrome.storage.sync.set(
      { czLlmApiKey: key, czLlmModel: model },
      () => {
        llmSaveStatusEl.textContent = key
          ? "LLM config saved."
          : "LLM key cleared.";
        setTimeout(() => (llmSaveStatusEl.textContent = ""), 1500);
      }
    );
  });

  if (highlightToggle) {
    highlightToggle.addEventListener("change", () => {
      const enabled = highlightToggle.checked;
      chrome.storage.sync.set(
        { czHighlightEnabled: enabled },
        () => {
          if (!highlightStatusEl) return;
          highlightStatusEl.textContent = enabled
            ? "Keyword highlighting enabled."
            : "Keyword highlighting disabled.";
          setTimeout(
            () => (highlightStatusEl.textContent = ""),
            1500
          );
        }
      );
    });
  }

  if (whyToggle) {
    whyToggle.addEventListener("change", () => {
      const enabled = whyToggle.checked;
      chrome.storage.sync.set({ czWhyEnabled: enabled }, () => {
        if (!whyStatusEl) return;
        whyStatusEl.textContent = enabled
          ? '"Why?" bubbles enabled.'
          : '"Why?" bubbles disabled.';
        setTimeout(() => (whyStatusEl.textContent = ""), 1500);
      });
    });
  }

  // Load weak-topic stats from local storage
  if (chrome?.storage?.local) {
    chrome.storage.local.get(["czQuestionStats"], (res) => {
      const stats = res.czQuestionStats || {};
      const tagCounts = {};

      Object.values(stats).forEach((entry) => {
        if (!entry || !entry.tags) return;
        Object.entries(entry.tags).forEach(([tag, count]) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + (count || 0);
        });
      });

      const sorted = Object.entries(tagCounts).sort(
        (a, b) => b[1] - a[1]
      );

      weakTopicsList.innerHTML = "";

      if (!sorted.length) {
        weakTopicsList.innerHTML =
          '<li class="popup-topics-empty">No analyzed questions yet.</li>';
        return;
      }

      sorted.slice(0, 10).forEach(([tag, count]) => {
        const li = document.createElement("li");
        li.textContent = `${tag} – ${count}`;
        weakTopicsList.appendChild(li);
      });
    });
  } else {
    weakTopicsList.innerHTML =
      '<li class="popup-topics-empty">chrome.storage.local not available.</li>';
  }
});
