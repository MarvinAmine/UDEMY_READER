// content/locations/reviewMode.js
(function () {
  if (window.czLocations && window.czLocations.reviewMode) return;

  function log(...args) {
    console.log("[UdemyReader][ReviewMode]", ...args);
  }

  function isReviewPage() {
    return !!document.querySelector(
      ".result-pane--question-result-pane-wrapper--2bGiz"
    );
  }

  function findPromptEl(block) {
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // Q + answers only (for Play Q + answers + for analysis base)
  function extractReviewQuestionStemAndAnswers(block) {
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
        ? pane.querySelector(
            "[data-purpose='answer-result-header-user-label']"
          )
        : null;

      let meta = "";
      if (isCorrect) meta += " (correct)";
      if (userLabel) meta += " (your selection)";
      return `${label}. ${text}${meta}`;
    });

    return (
      questionText +
      (answers.length ? "\n\n" + answers.join("\n") : "")
    );
  }

  // Explanation only (for Play explanation and to enrich analysis prompt)
  function extractReviewExplanation(block) {
    if (!block) return "";
    const overallExplanation = block.querySelector("#overall-explanation");
    if (!overallExplanation) return "";
    return normalizeWhitespace(overallExplanation.innerText || "");
  }

  // Option letters for Question Insight
  function getOptionLettersReview(block) {
    if (!block) return [];
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    return Array.from(answerBodies).map((_, idx) =>
      String.fromCharCode(65 + idx)
    );
  }

  // Highlighting roots depend on which play action is active
  function getHighlightRootsReview(block, action) {
    if (!block) return [];
    const roots = [];

    const promptEl = findPromptEl(block);
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    const overallExplanation = block.querySelector("#overall-explanation");

    // Default / Play Q + answers
    if (!action || action === "play-question") {
      if (promptEl) roots.push(promptEl);
      answerBodies.forEach((el) => roots.push(el));
      return roots;
    }

    // Play explanation
    if (action === "play-question-expl") {
      if (overallExplanation) roots.push(overallExplanation);
      return roots;
    }

    // For selection we don't pre-compute highlight roots
    if (action === "play-selection") {
      return [];
    }

    // Fallback – shouldn't normally hit
    if (promptEl) roots.push(promptEl);
    answerBodies.forEach((el) => roots.push(el));
    if (overallExplanation) roots.push(overallExplanation);
    return roots;
  }

  function injectCardForBlock(block) {
    if (!block || block.dataset.czTtsInjected === "1") return;

    const promptEl = findPromptEl(block);
    if (!promptEl) return;

    const wrapper = document.createElement("div");
    wrapper.className = "cz-tts-wrapper cz-tts-review";
    wrapper.innerHTML = `
      <div class="cz-tts-toolbar">
        <span class="cz-tts-title">Quiz Reader</span>
        <button type="button" class="cz-tts-btn" data-action="play-question">
          ▶ Play Q + answers
        </button>
        <button type="button" class="cz-tts-btn" data-action="play-question-expl">
          ▶ Play explanation
        </button>
        <button type="button" class="cz-tts-btn" data-action="play-selection">
          ▶ Play selection
        </button>
        <button type="button" class="cz-tts-btn" data-action="stop" disabled>
          ⏹ Stop
        </button>
      </div>
      <div class="cz-tts-status">
        Ready. Use “Play Q + answers” or select some text and use “Play selection”.
      </div>
      <div class="cz-tts-analysis">
        <div class="cz-tts-analysis-header">
          <span class="cz-tts-analysis-title">Question Insight</span>
          <button type="button" class="cz-tts-btn" data-action="analyze-question">
            🧠 Analyze question
          </button>
        </div>
        <div class="cz-tts-analysis-body">
          Click “Analyze question” to see a simplified stem, key triggers, and topic tags.
        </div>
      </div>
    `;

    // Insert right after the question prompt
    promptEl.insertAdjacentElement("afterend", wrapper);
    block.dataset.czTtsInjected = "1";

    const quizFeature =
      window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature) {
      log("quizReader feature missing – did quizReaderFeature.js load?");
      return;
    }

    quizFeature.mount(wrapper, {
      getText: () => extractReviewQuestionStemAndAnswers(block),
      // This is wired to "Play explanation" (explanation only)
      getTextWithExplanation: () => extractReviewExplanation(block),
      getHighlightRoots: (action) => getHighlightRootsReview(block, action)
    });

    if (!insightFeature) {
      log("questionInsight feature missing – did questionInsightFeature.js load?");
      return;
    }

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (!analysisRoot) return;

    // For analysis we send: question + answers + (optional) explanation
    insightFeature.mount(analysisRoot, {
      getQuestionText: () => {
        const qa = extractReviewQuestionStemAndAnswers(block);
        const expl = extractReviewExplanation(block);
        return expl ? qa + "\n\nExplanation:\n" + expl : qa;
      },
      // No stable question ID in review DOM (optional); omit to skip stats
      getOptionLetters: () => getOptionLettersReview(block)
    });

    log("Injected Quiz Reader + Question Insight card into review question block.");
  }

  function scanAndInjectAll() {
    if (!isReviewPage()) return;
    const blocks = document.querySelectorAll(
      ".result-pane--question-result-pane-wrapper--2bGiz"
    );
    blocks.forEach(injectCardForBlock);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanAndInjectAll);
  } else {
    scanAndInjectAll();
  }

  const observer = new MutationObserver(() => {
    scanAndInjectAll();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  window.czLocations = window.czLocations || {};
  window.czLocations.reviewMode = {
    rescan: scanAndInjectAll
  };
})();
