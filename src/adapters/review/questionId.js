// src/adapters/review/questionId.js
// Question-id helpers for review mode (native id or hashed stem+choices)

(function () {
  if (typeof window === "undefined") return;
  if (!window.czAdapters) window.czAdapters = {};

  const dom = window.czAdapters.reviewDom || {};
  const ns =
    (window.czAdapters.reviewQuestionId =
      window.czAdapters.reviewQuestionId || {});

  const hashString =
    (window.czCore && window.czCore.hashString) || null;

  const normalizeWhitespace =
    dom.normalizeWhitespace ||
    function (text) {
      return (text || "").replace(/\s+/g, " ").trim();
    };

  const findPromptEl =
    dom.findPromptEl ||
    function (block) {
      if (!block) return null;
      return (
        block.querySelector("#question-prompt") ||
        block.querySelector(".result-pane--question-format--PBvdY")
      );
    };

  function computeQuestionHashFromReviewBlock(block) {
    if (!block) return "";
    const promptEl = findPromptEl(block);
    const stemText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    const choiceTexts = Array.from(answerBodies).map((el) =>
      normalizeWhitespace(el.innerText || "")
    );
    const rawKey = stemText + "||" + choiceTexts.join("||");
    return hashString ? hashString(rawKey) : rawKey;
  }

  function getReviewQuestionId(block) {
    if (!block) return null;
    const idEl = block.querySelector("[data-question-id]");
    const nativeQuestionId = idEl
      ? idEl.getAttribute("data-question-id")
      : null;
    if (nativeQuestionId) return nativeQuestionId;
    return computeQuestionHashFromReviewBlock(block) || null;
  }

  ns.computeQuestionHashFromReviewBlock =
    computeQuestionHashFromReviewBlock;
  ns.getReviewQuestionId = getReviewQuestionId;
})();
