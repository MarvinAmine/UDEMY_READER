// src/adapters/review/dom.js
// DOM helpers for Udemy review pages (results view)

(function () {
  if (typeof window === "undefined") return;
  if (!window.czAdapters) window.czAdapters = {};

  const ns =
    (window.czAdapters.reviewDom = window.czAdapters.reviewDom || {});

  // Main block selectors used on results pages
  ns.REVIEW_BLOCK_SELECTOR =
    ".result-pane--question-result-pane-wrapper--2bGiz";
  ns.INLINE_RESULT_SELECTOR = ".question-result--question-result--LWiOB";

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function findPromptEl(block) {
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

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
      return `${label}. ${text}`;
    });

    return (
      questionText + (answers.length ? "\n\n" + answers.join("\n") : "")
    );
  }

  function extractReviewExplanation(block) {
    if (!block) return "";
    const overallExplanation = block.querySelector("#overall-explanation");
    if (!overallExplanation) return "";
    return normalizeWhitespace(overallExplanation.innerText || "");
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

  function getHighlightRootsReview(block, action) {
    if (!block) return [];
    const roots = [];

    const promptEl = findPromptEl(block);
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    const overallExplanation = block.querySelector("#overall-explanation");

    if (!action || action === "play-question") {
      if (promptEl) roots.push(promptEl);
      answerBodies.forEach((el) => roots.push(el));
      return roots;
    }

    if (action === "play-question-expl") {
      if (overallExplanation) roots.push(overallExplanation);
      return roots;
    }

    if (action === "play-selection") {
      return [];
    }

    if (promptEl) roots.push(promptEl);
    answerBodies.forEach((el) => roots.push(el));
    if (overallExplanation) roots.push(overallExplanation);
    return roots;
  }

  // expose helpers
  ns.normalizeWhitespace = normalizeWhitespace;
  ns.findPromptEl = findPromptEl;
  ns.extractReviewQuestionStemAndAnswers =
    extractReviewQuestionStemAndAnswers;
  ns.extractReviewExplanation = extractReviewExplanation;
  ns.getOptionLettersReview = getOptionLettersReview;
  ns.getHighlightRootsReview = getHighlightRootsReview;
})();
