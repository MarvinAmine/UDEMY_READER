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

  function extractPracticeQuestionText() {
    const form = getQuestionForm();
    if (!form) return "";

    const promptEl = form.querySelector(
      ".mc-quiz-question--question-prompt--9cMw2"
    );
    const questionText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";

    const answerEls = form.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d");
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
    const prompt = form.querySelector("#question-prompt");
    if (prompt) roots.push(prompt);

    const answers = form.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d");
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
    const answerEls = form.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d");
    return Array.from(answerEls).map((_, idx) =>
      String.fromCharCode(65 + idx)
    );
  }

  function injectCardIfNeeded() {
    const form = getQuestionForm();
    if (!form) return;

    if (form.querySelector(".cz-tts-wrapper")) return; // already added

    const wrapper = document.createElement("div");
    wrapper.id = "cz-tts-wrapper";
    wrapper.className = "cz-tts-wrapper";

    wrapper.innerHTML = `
      <div class="cz-tts-toolbar">
        <span class="cz-tts-title">Quiz Reader</span>
        <button type="button" class="cz-tts-btn" data-action="play-question">▶ Play Q + answers</button>
        <button type="button" class="cz-tts-btn" data-action="play-selection">▶ Play selection</button>
        <button type="button" class="cz-tts-btn" data-action="pause">⏸ Pause</button>
        <button type="button" class="cz-tts-btn" data-action="resume">⏯ Resume</button>
        <button type="button" class="cz-tts-btn" data-action="stop">⏹ Stop</button>
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

    quizFeature.mount(wrapper, {
      getText: extractPracticeQuestionText,
      getHighlightRoots: getHighlightRootsPractice
    });

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    insightFeature.mount(analysisRoot, {
      getQuestionText: extractPracticeQuestionText,
      getQuestionId: getQuestionIdPractice,
      getOptionLetters: getOptionLettersPractice
    });
  }

  function setupObserver() {
    const target =
      document.querySelector(".quiz-page-content") || document.body;

    const obs = new MutationObserver(() => {
      injectCardIfNeeded();
    });

    obs.observe(target, { childList: true, subtree: true });
  }

  // Initial run
  injectCardIfNeeded();
  setupObserver();
})();
