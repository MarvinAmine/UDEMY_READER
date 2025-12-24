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
  const setupSection = document.getElementById("setupSection");
  const startWizardBtn = document.getElementById("startWizard");
  const wizardCard = document.getElementById("wizardCard");
  const wizardStepLabel = document.getElementById("wizardStepLabel");
  const wizardTitle = document.getElementById("wizardTitle");
  const wizardDesc = document.getElementById("wizardDesc");
  const wizardLinks = document.getElementById("wizardLinks");
  const wizardPrimary = document.getElementById("wizardPrimary");
  const wizardSecondary = document.getElementById("wizardSecondary");
  const wizardStepCounter = document.getElementById("wizardStepCounter");
  const openPracticeBtn = document.getElementById("openPracticeBtn");
  const pageStatusDot = document.getElementById("pageStatusDot");
  const pageStatusTitle = document.getElementById("pageStatusTitle");
  const pageStatusDesc = document.getElementById("pageStatusDesc");
  const practiceGuide = document.getElementById("practiceGuide");

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

  const wizardSteps = [
    {
      targetId: "llmSection",
      label: "Step 1 · Required",
      title: "Add your LLM API key",
      desc:
        "Paste your OpenAI-compatible API key so the copilot can chat, summarize, and explain answers.",
      links: [
        {
          label: "Get an OpenAI API key →",
          href: "https://platform.openai.com/api-keys"
        }
      ],
      primary: "Mark step done",
      secondary: null
    },
    {
      targetId: "ttsSection",
      label: "Step 2 · Optional",
      title: "Enable reading aloud (Google TTS)",
      desc:
        "Add a Google Cloud Text-to-Speech API key if you want the copilot to read questions and answers aloud.",
      links: [
        {
          label: "Enable TTS & create a key →",
          href: "https://console.cloud.google.com/marketplace/product/google/texttospeech.googleapis.com"
        }
      ],
      primary: "Mark step done",
      secondary: "Skip optional"
    },
    {
      targetId: "usageSection",
      label: "Step 3",
      title: "Open a Udemy practice exam",
      desc:
        "Use the copilot on Udemy practice exams. Try the linked example or browse all AWS practice tests.",
      links: [
        {
          label: "AWS SAA practice exam →",
          href:
            "https://www.udemy.com/course/practice-exams-aws-certified-solutions-architect-associate/learn/quiz/4726082/result/1704817959?expanded=1704817959#overview"
        },
        {
          label: "Browse AWS practice tests →",
          href:
            "https://www.udemy.com/courses/search/?src=ukw&q=AWS+practice+exams&features=has_practice_test"
        }
      ],
      primary: "Finish setup",
      secondary: null
    }
  ];

  let wizardIndex = 0;
  let wizardActive = false;
  let highlightedEl = null;

  const updatePageStatus = () => {
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url || "";
      const isPractice =
        /^https?:\/\/www\.udemy\.com\/course\/[^/]+\/learn\/quiz\/[^/]+\/(result|test)/.test(
          url
        );
      const isPracticeSearch =
        /^https?:\/\/www\.udemy\.com\/courses\/search\/.*q=AWS\+practice\+exams/.test(
          url
        );
      const isCoursePage =
        /^https?:\/\/www\.udemy\.com\/course\/[^/]+\/?([?#].*)?$/.test(url);
      if (pageStatusDot && pageStatusTitle && pageStatusDesc) {
        pageStatusDot.classList.remove("is-on", "is-off", "is-warn");
        pageStatusDot.classList.add(
          isPractice
            ? "is-on"
            : isPracticeSearch || isCoursePage
            ? "is-warn"
            : "is-off"
        );
        if (isPractice) {
          pageStatusTitle.textContent = "Practice exam detected";
          pageStatusDesc.textContent =
            "You’re on a Udemy practice exam—start the copilot here.";
        } else if (isCoursePage) {
          pageStatusTitle.textContent = "Open a practice test";
          pageStatusDesc.textContent =
            'Click "Go to course," then pick any Practice Test/Quiz item.';
        } else if (isPracticeSearch) {
          pageStatusTitle.textContent = "Choose a practice exam";
          pageStatusDesc.textContent =
            "Pick a course, then click any “Practice Test”/“Quiz” item to launch it.";
        } else {
          pageStatusTitle.textContent = "Not on a practice exam";
          pageStatusDesc.textContent =
            "Open a Udemy AWS practice exam to enable the copilot.";
        }
      }

      if (practiceGuide) {
        if (isPracticeSearch && !isPractice) {
          practiceGuide.innerHTML = `
            <li>Choose an AWS practice test between those in the list.</li>
            <li>Open the practice test by clicking on “Go to course”.</li>
          `;
          practiceGuide.classList.remove("is-hidden");
        } else if (isCoursePage && !isPractice) {
          practiceGuide.innerHTML = `
            <li>Open the practice test by clicking on “Go to course”.</li>
          `;
          practiceGuide.classList.remove("is-hidden");
        } else {
          practiceGuide.classList.add("is-hidden");
        }
      }
    });
  };

  const clearHighlight = () => {
    if (highlightedEl) {
      highlightedEl.classList.remove("wizard-highlight");
      highlightedEl = null;
    }
  };

  const renderWizardStep = () => {
    if (!wizardCard || !wizardStepLabel || !wizardTitle || !wizardDesc) return;

    if (!wizardActive || wizardIndex >= wizardSteps.length) {
      wizardActive = false;
      clearHighlight();
      wizardCard.classList.add("is-hidden");
      wizardStepCounter?.classList.add("is-hidden");
      setupSection?.classList.add("is-hidden");
      if (startWizardBtn) {
        startWizardBtn.textContent = "Restart guided setup";
      }
      return;
    }

    const step = wizardSteps[wizardIndex];
    wizardCard.classList.remove("is-hidden");
    if (wizardStepCounter) {
      wizardStepCounter.classList.remove("is-hidden");
      wizardStepCounter.textContent = `Step ${wizardIndex + 1} of ${
        wizardSteps.length
      }`;
    }

    wizardStepLabel.textContent = step.label;
    wizardTitle.textContent = step.title;
    wizardDesc.textContent = step.desc;

    if (wizardLinks) {
      wizardLinks.innerHTML = "";
      (step.links || []).forEach((link) => {
        const a = document.createElement("a");
        a.href = link.href;
        a.textContent = link.label;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "wizard-link";
        wizardLinks.appendChild(a);
      });
    }

    if (wizardPrimary) {
      wizardPrimary.textContent = step.primary || "Next";
    }
    if (wizardSecondary) {
      if (step.secondary) {
        wizardSecondary.classList.remove("is-hidden");
        wizardSecondary.textContent = step.secondary;
      } else {
        wizardSecondary.classList.add("is-hidden");
      }
    }

    clearHighlight();
    if (step.targetId) {
      const target = document.getElementById(step.targetId);
      if (target) {
        target.classList.add("wizard-highlight");
        highlightedEl = target;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  if (startWizardBtn && setupSection && wizardCard) {
    startWizardBtn.addEventListener("click", () => {
      wizardActive = true;
      wizardIndex = 0;
      setupSection.classList.remove("is-hidden");
      renderWizardStep();
    });
  }

  if (wizardPrimary) {
    wizardPrimary.addEventListener("click", () => {
      wizardIndex += 1;
      renderWizardStep();
    });
  }

  if (wizardSecondary) {
    wizardSecondary.addEventListener("click", () => {
      wizardIndex += 1;
      renderWizardStep();
    });
  }

  if (openPracticeBtn) {
    openPracticeBtn.addEventListener("click", () => {
      const example =
        "https://www.udemy.com/courses/search/?src=ukw&q=AWS+practice+exams&features=has_practice_test";
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: example });
      } else {
        window.open(example, "_blank", "noopener,noreferrer");
      }
    });
  }

  updatePageStatus();
});
