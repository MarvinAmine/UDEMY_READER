// /src/adapters/practice.js
// Attach Quiz Reader + Question Insight in Practice/Test mode (1 question per page)

(function () {
  if (!window) return;
  if (!window.czLocations) window.czLocations = {};
  if (window.czLocations.practiceMode) return;

  const log = (window.czCore && window.czCore.log) || (() => {});
  const hashString = (window.czCore && window.czCore.hashString) || null;

  const QUIZ_FORM_SELECTOR =
    'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]';

  function getQuestionForm() {
    return document.querySelector(QUIZ_FORM_SELECTOR);
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("PracticeMode", "config fn error", e);
      return "";
    }
  }

  function findPromptElPractice(form) {
    if (!form) return null;
    return (
      form.querySelector("#question-prompt") ||
      form.querySelector(".mc-quiz-question--question-prompt--9cMw2")
    );
  }

  function extractPracticeQuestionText() {
    const form = getQuestionForm();
    if (!form) return "";

    const promptEl = findPromptElPractice(form);
    const questionText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";

    const answerEls = form.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d"
    );
    const answers = Array.from(answerEls).map((el, idx) => {
      const label = String.fromCharCode(65 + idx); // A, B, C, ...
      const text = normalizeWhitespace(el.innerText || "");
      return `${label}. ${text}`;
    });

    return (
      questionText + (answers.length ? "\n\n" + answers.join("\n") : "")
    );
  }

  function getHighlightRootsPractice() {
    const form = getQuestionForm();
    if (!form) return [];

    const roots = [];
    const promptEl = findPromptElPractice(form);
    if (promptEl) roots.push(promptEl);

    const answers = form.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d"
    );
    answers.forEach((el) => roots.push(el));

    return roots;
  }

  function computeQuestionHashFromPracticeForm(form) {
    if (!form) return "";
    const promptEl = findPromptElPractice(form);
    const stemText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";
    const answerEls = form.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d"
    );
    const choiceTexts = Array.from(answerEls).map((el) =>
      normalizeWhitespace(el.innerText || "")
    );
    const rawKey = stemText + "||" + choiceTexts.join("||");
    return hashString ? hashString(rawKey) : rawKey;
  }

  function getQuestionIdPractice() {
    const form = getQuestionForm();
    if (!form) return null;

    const nativeId =
      (form && form.dataset && form.dataset.questionId) || null;
    if (nativeId) return nativeId;

    // CU1 shared: stable fallback id when Udemy doesn't expose an id
    return computeQuestionHashFromPracticeForm(form) || null;
  }

  function getOptionLettersPractice() {
    const form = getQuestionForm();
    if (!form) return [];
    const answerEls = form.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d"
    );
    return Array.from(answerEls).map((_, idx) =>
      String.fromCharCode(65 + idx)
    );
  }

  function resetAnalysis(wrapper) {
    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    if (analysisBody) {
      analysisBody.innerHTML =
        "Click “Analyze question” to see a simplified stem, key triggers, and topic tags.";
    }

    const statusEl = wrapper.querySelector(".cz-tts-status");
    if (statusEl) {
      statusEl.textContent =
        "Ready. Use “Play Q + answers” or select some text and use “Play selection”.";
    }
  }

  function restoreCachedInsightIfAny(wrapper, insightConfig) {
    if (!chrome?.runtime?.sendMessage) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    if (!analysisBody) return;

    const textRaw = safeCall(insightConfig.getQuestionText);
    const questionId = safeCall(insightConfig.getQuestionId) || null;
    const text = (textRaw || "").trim();

    if (!text && !questionId) return;

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_GET_CACHED_ANALYSIS",
          text,
          questionId: questionId || null
        },
        (resp) => {
          if (!resp || !resp.ok || !resp.analysis) return;

          const insightFeature =
            window.czFeatures && window.czFeatures.questionInsight;
          if (
            !insightFeature ||
            typeof insightFeature.applyAnalysisToBody !== "function"
          ) {
            return;
          }

          insightFeature.applyAnalysisToBody(
            analysisBody,
            resp.analysis,
            insightConfig
          );
        }
      );
    } catch (e) {
      log("PracticeMode", "restoreCachedInsightIfAny error", e);
    }
  }

  function syncCardToCurrentQuestion() {
    const form = getQuestionForm();
    if (!form) return;

    const quizFeature =
      window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature) {
      log("PracticeMode", "quizReader feature missing");
      return;
    }
    if (!insightFeature) {
      log("PracticeMode", "questionInsight feature missing");
      return;
    }

    const insightConfig = {
      getQuestionText: extractPracticeQuestionText,
      getQuestionId: getQuestionIdPractice,
      getOptionLetters: getOptionLettersPractice,
      // CU1-A: mark this source as coming from practice mode
      mode: "practice"
    };

    const currentId = getQuestionIdPractice() || "";

    let wrapper = form.querySelector(".cz-tts-wrapper");
    let isNewWrapper = false;

    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = "cz-tts-wrapper";
      wrapper.className = "cz-tts-wrapper";

      wrapper.innerHTML = `
        <div class="cz-tts-toolbar">
          <span class="cz-tts-title">Quiz Reader</span>
          <button type="button" class="cz-tts-btn" data-action="play-question">▶ Play Q + answers</button>
          <button type="button" class="cz-tts-btn" data-action="play-selection">▶ Play selection</button>
          <button type="button" class="cz-tts-btn" data-action="stop" disabled>⏹ Stop</button>
          <button type="button" class="cz-tts-btn cz-tts-collapse-toggle" data-action="toggle-collapse">▾ Hide all</button>
        </div>
        <div class="cz-tts-status">
          Ready. Use “Play Q + answers” or select some text and use “Play selection”.
        </div>
        <div class="cz-tts-analysis">
          <div class="cz-tts-analysis-header">
            <span class="cz-tts-analysis-title">Question Insight</span>
            <button type="button" class="cz-tts-btn" data-action="analyze-question">🧠 Analyze question</button>
          </div>
          <div class="cz-tts-analysis-body">
            Click “Analyze question” to see a simplified stem, key triggers, and topic tags.
          </div>
        </div>
      `;

      const promptDiv = form.querySelector("#question-prompt");
      if (promptDiv && promptDiv.parentNode === form) {
        promptDiv.insertAdjacentElement("afterend", wrapper);
      } else {
        form.appendChild(wrapper);
      }

      quizFeature.mount(wrapper, {
        getText: extractPracticeQuestionText,
        getHighlightRoots: getHighlightRootsPractice
      });

      const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
      insightFeature.mount(analysisRoot, insightConfig);

      isNewWrapper = true;
    }

    const knownId = wrapper.dataset.czQuestionId || "";

    if (isNewWrapper || knownId !== currentId) {
      wrapper.dataset.czQuestionId = currentId || "";

      resetAnalysis(wrapper);
      restoreCachedInsightIfAny(wrapper, insightConfig);
    }
  }

  function setupObserver() {
    const target =
      document.querySelector(".quiz-page-content") || document.body;

    const obs = new MutationObserver(() => {
      syncCardToCurrentQuestion();
    });

    obs.observe(target, { childList: true, subtree: true });
  }

  syncCardToCurrentQuestion();
  setupObserver();

  window.czLocations.practiceMode = {
    resync: syncCardToCurrentQuestion
  };
})();
