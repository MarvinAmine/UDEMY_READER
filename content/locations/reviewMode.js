// content/locations/reviewMode.js
// Attach Quiz Reader + Question Insight on the results page
// (question review – many questions on one page)
// Also used for the single-question "result" view in practice mode.

(function () {
  if (!window.czFeatures) window.czFeatures = {};

  // Support BOTH:
  //  - Full exam review page: .result-pane--question-result-pane-wrapper--2bGiz
  //  - Practice mode "validated" question: .question-result--question-result--LWiOB
  const REVIEW_WRAPPER_SELECTOR =
    ".result-pane--question-result-pane-wrapper--2bGiz, .question-result--question-result--LWiOB";

  function log(...args) {
    console.log("[UdemyReader][ReviewMode]", ...args);
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function findPromptEl(block) {
    if (!block) return null;
    // Full review page uses the extra class, practice result only has #question-prompt
    return (
      block.querySelector(
        ".result-pane--question-format--PBvdY#question-prompt"
      ) || block.querySelector("#question-prompt")
    );
  }

  function getQuestionIdReview(block) {
    if (!block) return null;
    // Try common patterns; if not present, null is fine (cache falls back to text key)
    const fromAttr = block.getAttribute("data-question-id");
    const fromDataset = block.dataset ? block.dataset.questionId : null;
    return (fromAttr || fromDataset || "").trim() || null;
  }

  function getOptionLettersReview(block) {
    if (!block) return [];
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    return Array.from(answerBodies).map((_, idx) =>
      String.fromCharCode(65 + idx)
    );
  }

  function extractReviewQuestionText(block) {
    if (!block) return "";

    const promptEl = findPromptEl(block);
    const questionText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";

    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );

    const answers = Array.from(answerBodies).map((bodyEl, idx) => {
      const label = String.fromCharCode(65 + idx);
      const text = normalizeWhitespace(bodyEl.innerText || "");

      const pane = bodyEl.closest(
        ".answer-result-pane--answer-correct--PLOEU, .answer-result-pane--answer-skipped--1NDPn"
      );
      const classes = pane ? pane.className : "";
      const isCorrect =
        classes &&
        classes.indexOf("answer-result-pane--answer-correct--PLOEU") !== -1;

      const userLabel = pane
        ? pane.querySelector("[data-purpose='answer-result-header-user-label']")
        : null;

      let meta = "";
      if (isCorrect) meta += " (correct)";
      if (userLabel) meta += " (your selection)";
      return `${label}. ${text}${meta}`;
    });

    let explanationText = "";
    const overallExplanation = block.querySelector("#overall-explanation");
    if (overallExplanation) {
      explanationText =
        "\n\nExplanation:\n" +
        normalizeWhitespace(overallExplanation.innerText || "");
    }

    return (
      questionText +
      (answers.length ? "\n\n" + answers.join("\n") : "") +
      explanationText
    );
  }

  function getHighlightRootsReview(block) {
    if (!block) return [];
    const roots = [];

    const prompt = findPromptEl(block);
    if (prompt) roots.push(prompt);

    const answers = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    answers.forEach((el) => roots.push(el));

    const explanation = block.querySelector("#overall-explanation");
    if (explanation) roots.push(explanation);

    return roots;
  }

  function injectCardForBlock(block) {
    if (!block) return;
    if (block.dataset.czTtsInjected === "1") return;

    const promptDiv = findPromptEl(block);
    if (!promptDiv) return;

    const wrapper = document.createElement("div");
    wrapper.className = "cz-tts-wrapper cz-tts-review";

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

    // Insert the card right after the question prompt (works for both review + practice-result)
    promptDiv.insertAdjacentElement("afterend", wrapper);

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
      getText: () => extractReviewQuestionText(block),
      getHighlightRoots: () => getHighlightRootsReview(block)
    });

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    insightFeature.mount(analysisRoot, {
      getQuestionText: () => extractReviewQuestionText(block),
      getQuestionId: () => getQuestionIdReview(block),
      getOptionLetters: () => getOptionLettersReview(block)
    });

    block.dataset.czTtsInjected = "1";
  }

  function scanAllReviewBlocks() {
    const blocks = document.querySelectorAll(REVIEW_WRAPPER_SELECTOR);
    if (!blocks.length) return;
    blocks.forEach(injectCardForBlock);
  }

  function setupObserver() {
    const target = document.body;
    const obs = new MutationObserver(() => {
      scanAllReviewBlocks();
    });
    obs.observe(target, { childList: true, subtree: true });
  }

  // Initial run
  scanAllReviewBlocks();
  setupObserver();
})();
