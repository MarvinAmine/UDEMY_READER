// src/adapters/review/importAttempt.js
// UC1-B: Import full exam attempt from review page into local history

(function () {
  if (typeof window === "undefined") return;
  if (!window.czAdapters) window.czAdapters = {};

  const log = (window.czCore && window.czCore.log) || (() => {});
  const dom = window.czAdapters.reviewDom || {};
  const questionHelpers = window.czAdapters.reviewQuestionId || {};

  const REVIEW_BLOCK_SELECTOR =
    dom.REVIEW_BLOCK_SELECTOR ||
    ".result-pane--question-result-pane-wrapper--2bGiz";

  const ns =
    (window.czAdapters.reviewImport =
      window.czAdapters.reviewImport || {});

  let uc1bImportTriggered = false;

  function normalizeWhitespace(text) {
    if (dom.normalizeWhitespace) return dom.normalizeWhitespace(text);
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function findPromptEl(block) {
    if (dom.findPromptEl) return dom.findPromptEl(block);
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

  function generateUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }

  function getExamContext() {
    const path = window.location.pathname || "";

    const titleEl = document.querySelector(
      'h2.results-header--title--yQsZc[data-purpose="title"]'
    );
    if (!titleEl) {
      log(
        "ReviewMode",
        "getExamContext: no results header detected on this page."
      );
      return null;
    }

    const examTitle = normalizeWhitespace(titleEl.innerText || "") || null;

    let attemptOrdinal = null;
    const attemptEl = document.querySelector("span.ud-heading-lg");
    if (attemptEl) {
      const m = attemptEl.innerText.match(/Attempt\s+(\d+)/i);
      if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n)) attemptOrdinal = n;
      }
    }

    let examId = null;
    let match = path.match(/practice-test\/(\d+)\//);
    if (match && match[1]) {
      examId = match[1];
    } else {
      match = path.match(/\/quiz\/(\d+)\//);
      if (match && match[1]) {
        examId = match[1];
      }
    }

    const examAttemptKey = `review-${examId || "unknown"}-attempt-${
      attemptOrdinal || "unknown"
    }`;

    const ctx = {
      examId,
      examTitle,
      attemptOrdinal,
      examAttemptKey
    };

    log("ReviewMode", "getExamContext:", ctx);
    return ctx;
  }

  function parseExamStats() {
    const pillSpans = Array.from(
      document.querySelectorAll(
        ".pill-group-module--pill-group--q7hFg .ud-btn-label"
      )
    );

    function parseStat(label) {
      const span = pillSpans.find((el) =>
        el.innerText.toLowerCase().includes(label)
      );
      if (!span) return null;
      const m = span.innerText.match(/(\d+)/);
      if (!m || !m[1]) return null;
      const n = parseInt(m[1], 10);
      return Number.isNaN(n) ? null : n;
    }

    const totalQuestions = parseStat("all");
    const correctCount = parseStat("correct");
    const incorrectCount = parseStat("incorrect");
    const skippedCount = parseStat("skipped");
    const markedCount = parseStat("marked");

    return {
      totalQuestions,
      correctCount,
      incorrectCount,
      skippedCount,
      markedCount,
      completedAt: null
    };
  }

  function getReviewQuestionId(block) {
    if (questionHelpers.getReviewQuestionId) {
      return questionHelpers.getReviewQuestionId(block);
    }

    // Very defensive fallback: hash stem + choices
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
    const hashString =
      (window.czCore && window.czCore.hashString) || null;
    return hashString ? hashString(rawKey) : rawKey;
  }

  function extractQuestionImportPayload(block, examCtx, completedAtTs) {
    if (!block || !examCtx) return null;

    const questionId = getReviewQuestionId(block);
    if (!questionId) return null;

    const promptEl = findPromptEl(block);
    const stemText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";

    // Choices
    let answerBlocks = block.querySelectorAll('[data-purpose="answer"]');
    if (!answerBlocks.length) {
      answerBlocks = block.querySelectorAll(
        ".answer-result-pane--answer-body--cDGY6"
      );
    }

    const choices = [];
    Array.from(answerBlocks).forEach((answerBlock, idx) => {
      const textEl =
        answerBlock.querySelector(
          ".answer-result-pane--answer-body--cDGY6"
        ) || answerBlock;
      const text = normalizeWhitespace(textEl.innerText || "");
      const label = String.fromCharCode(65 + idx);
      choices.push({ index: idx, label, text });
    });

    const chosenIndices = [];
    const correctIndices = [];

    Array.from(answerBlocks).forEach((ab, idx) => {
      const isCorrect = ab.classList.contains(
        "answer-result-pane--answer-correct--PLOEU"
      );
      const userLabel = ab.querySelector(
        '[data-purpose="answer-result-header-user-label"]'
      );

      if (isCorrect) correctIndices.push(idx);
      if (userLabel) chosenIndices.push(idx);
    });

    let isCorrect = null;
    if (chosenIndices.length && correctIndices.length) {
      const chosenSet = new Set(chosenIndices);
      const correctSet = new Set(correctIndices);
      isCorrect =
        chosenSet.size === correctSet.size &&
        [...chosenSet].every((i) => correctSet.has(i));
    }

    const domainEl = block.querySelector(
      '[data-purpose="domain-pane"] .ud-text-md'
    );
    const domainLabel = domainEl
      ? normalizeWhitespace(domainEl.innerText || "")
      : null;

    const explContainer =
      block.querySelector(
        ".overall-explanation-pane--overall-explanation--G-hLQ .ud-text-md.rt-scaffolding"
      ) || block.querySelector("#overall-explanation");

    const officialExplanationHtml = explContainer
      ? (explContainer.innerHTML || "").trim()
      : null;

    const referenceLinks = [];
    if (explContainer) {
      const anchors = explContainer.querySelectorAll("a[href]");
      anchors.forEach((a) => {
        const url = a.getAttribute("href");
        if (!url) return;
        let kind = "other";
        if (url.includes("docs.aws.amazon.com")) kind = "aws_docs";
        else if (url.includes("tutorialsdojo.com")) kind = "td_cheat_sheet";
        else if (url.includes("udemy.com")) kind = "udemy_internal";
        referenceLinks.push({ url, kind });
      });
    }

    const now = Date.now();

    const questionMeta = {
      questionId,
      examId: examCtx.examId,
      examTitle: examCtx.examTitle,
      stemText,
      choices,
      domainLabel,
      officialExplanationHtml,
      referenceLinks,
      firstSeenAt: now,
      lastSeenAt: now
    };

    const attempt = {
      attemptId: generateUuid(),
      questionId,
      examId: examCtx.examId,
      examTitle: examCtx.examTitle,
      attemptOrdinal: examCtx.attemptOrdinal,
      examAttemptKey: examCtx.examAttemptKey,
      mode: "review",
      source: "review-import",
      timestamp: completedAtTs || now,
      stemText,
      choices,
      chosenIndices,
      correctIndices,
      isCorrect,
      confidence: null
    };

    return { questionMeta, attempt };
  }

  function importExamAttempt(examCtx) {
    if (!chrome?.storage?.local) {
      log("ReviewMode", "chrome.storage.local not available – UC1-B skipped.");
      return;
    }

    const blocks = document.querySelectorAll(REVIEW_BLOCK_SELECTOR);
    if (!blocks.length) {
      log(
        "ReviewMode",
        "UC1-B: no review blocks found for full exam import."
      );
      return;
    }

    const stats = parseExamStats();
    const now = Date.now();

    const examAttemptMeta = {
      examAttemptKey: examCtx.examAttemptKey,
      examId: examCtx.examId,
      examTitle: examCtx.examTitle,
      attemptOrdinal: examCtx.attemptOrdinal,
      mode: "review-only",
      totalQuestions: stats.totalQuestions,
      correctCount: stats.correctCount,
      incorrectCount: stats.incorrectCount,
      skippedCount: stats.skippedCount,
      markedCount: stats.markedCount,
      completedAt: stats.completedAt || null,
      importedAt: now,
      source: "review-import"
    };

    const attempts = [];
    const metas = [];

    Array.from(blocks).forEach((block) => {
      const payload = extractQuestionImportPayload(
        block,
        examCtx,
        stats.completedAt || now
      );
      if (!payload) return;
      attempts.push(payload.attempt);
      metas.push(payload.questionMeta);
    });

    if (!attempts.length) {
      log("ReviewMode", "UC1-B: no questions parsed, skipping import.");
      return;
    }

    chrome.storage.local.get(
      [
        "czExamAttempts",
        "czQuestionBank",
        "czQuestionAttempts",
        "czQuestionStats"
      ],
      (res) => {
        const examAttempts = res.czExamAttempts || {};
        const questionBank = res.czQuestionBank || {};
        const questionAttempts = res.czQuestionAttempts || {};
        const questionStats = res.czQuestionStats || {};

        if (examAttempts[examAttemptMeta.examAttemptKey]) {
          log(
            "ReviewMode",
            "UC1-B: examAttempt already present, not overwriting:",
            examAttemptMeta.examAttemptKey
          );
          return;
        }

        examAttempts[examAttemptMeta.examAttemptKey] =
          examAttemptMeta;

        metas.forEach((metaEntry) => {
          const key = String(metaEntry.questionId);
          const existing = questionBank[key];

          if (existing) {
            const mergedLinks = [];
            const seen = new Set();

            function addLinks(list) {
              (list || []).forEach((link) => {
                if (!link || !link.url) return;
                if (seen.has(link.url)) return;
                seen.add(link.url);
                mergedLinks.push(link);
              });
            }

            addLinks(existing.referenceLinks || []);
            addLinks(metaEntry.referenceLinks || []);

            questionBank[key] = {
              questionId: key,
              examId: existing.examId || metaEntry.examId || null,
              examTitle: existing.examTitle || metaEntry.examTitle || null,
              stemText: existing.stemText || metaEntry.stemText,
              choices:
                (existing.choices && existing.choices.length
                  ? existing.choices
                  : metaEntry.choices) || [],
              domainLabel:
                existing.domainLabel || metaEntry.domainLabel || null,
              officialExplanationHtml:
                existing.officialExplanationHtml ||
                metaEntry.officialExplanationHtml ||
                null,
              referenceLinks: mergedLinks,
              firstSeenAt: existing.firstSeenAt || metaEntry.firstSeenAt,
              lastSeenAt: now
            };
          } else {
            questionBank[key] = metaEntry;
          }
        });

        attempts.forEach((att) => {
          questionAttempts[att.attemptId] = att;
        });

        // UC1-C: update per-question ground-truth stats from the new attempts
        const qsHelper =
          (window.czCore && window.czCore.questionStats) || null;
        const updatedStats =
          qsHelper && typeof qsHelper.applyAttemptsArray === "function"
            ? qsHelper.applyAttemptsArray(questionStats, attempts)
            : questionStats;

        chrome.storage.local.set(
          {
            czExamAttempts: examAttempts,
            czQuestionBank: questionBank,
            czQuestionAttempts: questionAttempts,
            czQuestionStats: updatedStats
          },
          () => {
            log(
              "ReviewMode",
              "UC1-B imported exam attempt",
              examAttemptMeta.examAttemptKey,
              "questions:",
              attempts.length
            );
          }
        );
      }
    );
  }

  function ensureReviewImportOnce() {
    if (uc1bImportTriggered) return;
    const examCtx = getExamContext();
    if (!examCtx) {
      log(
        "ReviewMode",
        "ensureReviewImportOnce: no exam context, skipping UC1-B."
      );
      return;
    }

    uc1bImportTriggered = true;

    if (!chrome?.storage?.local) {
      log("ReviewMode", "chrome.storage.local not available – UC1-B skipped.");
      return;
    }

    chrome.storage.local.get(["czExamAttempts"], (res) => {
      const examAttempts = res.czExamAttempts || {};
      if (examAttempts[examCtx.examAttemptKey]) {
        log(
          "ReviewMode",
          "UC1-B: exam attempt already imported:",
          examCtx.examAttemptKey
        );
        return;
      }
      importExamAttempt(examCtx);
    });
  }

  ns.ensureReviewImportOnce = ensureReviewImportOnce;
  ns.getExamContext = getExamContext;
  ns.parseExamStats = parseExamStats;
  ns.extractQuestionImportPayload = extractQuestionImportPayload;
  ns.importExamAttempt = importExamAttempt;
})();
