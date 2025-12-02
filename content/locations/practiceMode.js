// content/locations/practiceMode.js
// Attach Quiz Reader + Question Insight in Practice/Test mode
// (1 question per page)

(function () {
  if (!window.czFeatures) window.czFeatures = {};

  const QUIZ_FORM_SELECTOR =
    'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]';

  function log(...args) {
    console.log("[UdemyReader][PracticeMode]", ...args);
  }

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
      log("config fn error", e);
      return "";
    }
  }

  /**
   * In practice mode, Udemy typically renders the stem as:
   *
   * <div class="mc-quiz-question--question-prompt--...">
   *   <div class="question-result--question-title--...">Question 8:</div>
   *   <div id="question-prompt" class="ud-text-md rt-scaffolding">[...]</div>
   * </div>
   *
   * To ensure the SAME canonical text as the review/result view,
   * we always prefer #question-prompt (stem only, without "Question 8:").
   */
  function findPromptElPractice(form) {
    if (!form) return null;
    return (
      form.querySelector("#question-prompt") ||
      form.querySelector(".mc-quiz-question--question-prompt--9cMw2")
    );
  }

  /**
   * Build a canonical "question + answers" text for:
   *  - TTS
   *  - Analysis cache key (must match reviewMode.js)
   */
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
      questionText +
      (answers.length ? "\n\n" + answers.join("\n") : "")
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

  function getQuestionIdPractice() {
    const form = getQuestionForm();
    return form?.dataset?.questionId || null;
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

  // Reset the visible text for status + analysis back to default
  // when a new question appears in the same form.
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

  // Ask the background script if we already have a cached analysis
  // for this question (by questionId + canonical text). If yes,
  // re-render it into the current Question Insight body so that
  // previously fetched insight stays visible when you come back.
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

          const insightFeature = window.czFeatures.questionInsight;
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
      log("restoreCachedInsightIfAny error", e);
    }
  }

  // Ensure that the Quiz Reader + Question Insight card
  // is present and bound to the *current* question ID.
  // If Udemy reuses the same <form> across questions, we detect the
  // questionId change and reset + restore from cache per question.
  function syncCardToCurrentQuestion() {
    const form = getQuestionForm();
    if (!form) return;

    const quizFeature = window.czFeatures.quizReader;
    const insightFeature = window.czFeatures.questionInsight;

    if (!quizFeature) {
      log("quizReader feature missing – did quizReaderFeature.js load?");
      return;
    }
    if (!insightFeature) {
      log("questionInsight feature missing – did questionInsightFeature.js load?");
      return;
    }

    const insightConfig = {
      getQuestionText: extractPracticeQuestionText,
      getQuestionId: getQuestionIdPractice,
      getOptionLetters: getOptionLettersPractice
    };

    const currentId = form.dataset?.questionId || "";

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

      // Mount Quiz Reader (TTS)
      quizFeature.mount(wrapper, {
        getText: extractPracticeQuestionText,
        getHighlightRoots: getHighlightRootsPractice
      });

      // Mount Question Insight (analysis)
      const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
      insightFeature.mount(analysisRoot, insightConfig);

      isNewWrapper = true;
    }

    const knownId = wrapper.dataset.czQuestionId || "";

    // New question, or first time we bind this wrapper to a question.
    if (isNewWrapper || knownId !== currentId) {
      wrapper.dataset.czQuestionId = currentId || "";

      // Clear stale analysis from another question
      resetAnalysis(wrapper);

      // If we previously analyzed this question, restore it from cache.
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

  // Initial run
  syncCardToCurrentQuestion();
  setupObserver();
})();
