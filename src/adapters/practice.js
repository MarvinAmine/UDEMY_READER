// File: /src/adapters/practice.js
// Practice/Test mode (1 question per page) adapter.
//
// - Mounts Quiz Reader + Question Insight on practice questions.
// - Provides a small inline confidence UI (guess / unsure / sure) under the status line.
// - Logs a QuestionAttempt to chrome.storage.local whenever the user clicks
//   Udemy's "Check answer" button (data-purpose="check-answer").
//   The snapshot includes the selected confidence level.
//
// NOTE: Udemy replaces the <form> with a result view after clicking "Check answer".
//       So we must build & log the attempt *before* the DOM is replaced.

(function () {
  if (typeof window === "undefined") return;
  if (!window.czLocations) window.czLocations = {};
  if (window.czLocations.practiceMode) return;

  const log =
    (window.czCore && window.czCore.log) ||
    function (...args) {
      console.log("[UdemyReader][PracticeMode]", ...args);
    };

  const hashString = window.czCore && window.czCore.hashString;
  const qsHelper = window.czCore && window.czCore.questionStats;

  // Udemy practice question container
  const QUIZ_FORM_SELECTOR =
    'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"], ' +
    'div.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]';

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

  function generateUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // Fallback UUID v4
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function findPromptElPractice(form) {
    if (!form) return null;
    // Matches DOM like: div#question-prompt.ud-text-bold.mc-quiz-question--question-prompt--9cMw2
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
      const label = String.fromCharCode(65 + idx); // A, B, C...
      const text = normalizeWhitespace(el.innerText || "");
      return `${label}. ${text}`;
    });

    return questionText + (answers.length ? `\n\n${answers.join("\n")}` : "");
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

  function getAnswerElementsPractice() {
    const form = getQuestionForm();
    if (!form) return [];
    const answers = form.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d"
    );
    return Array.from(answers);
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

  function getQuestionIdPractice(formOverride) {
    const form = formOverride || getQuestionForm();
    if (!form) return null;

    const nativeId =
      (form && form.dataset && form.dataset.questionId) || null;
    if (nativeId) return nativeId;

    // Fallback: hash of stem + choices
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
    if (!wrapper) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    if (analysisBody) {
      analysisBody.innerHTML =
        'Click “Analyze question” to see a simplified stem, key triggers, and topic tags.';
    }

    const statusEl = wrapper.querySelector(".cz-tts-status");
    if (statusEl) {
      statusEl.textContent =
        'Ready. Use “Play Q + answers” or select some text and use “Play selection”.';
    }
  }

  function restoreCachedInsightIfAny(wrapper, insightConfig) {
    if (!chrome?.runtime?.sendMessage) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
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
      if (analysisRoot && insightFeature.markAnalyzed) {
        insightFeature.markAnalyzed(analysisRoot, true);
      }
      if (insightFeature.applyHighlightsFromAnalysis) {
        insightFeature.applyHighlightsFromAnalysis(
          resp.analysis,
          insightConfig
        );
      }
      if (analysisRoot && insightFeature.rememberAnalysis) {
        insightFeature.rememberAnalysis(analysisRoot, resp.analysis, insightConfig);
      }
    }
  );
} catch (e) {
  log("restoreCachedInsightIfAny error", e);
}
  }

  // ---------------- Confidence helpers (CU2) ----------------

  function getCardWrapper(formOverride) {
    const form = formOverride || getQuestionForm();
    if (!form) return null;
    return form.querySelector(".cz-tts-wrapper");
  }

  function getCurrentConfidence(formOverride) {
    const wrapper = getCardWrapper(formOverride);
    if (!wrapper) return null;

    const activeBtn = wrapper.querySelector(
      ".cz-tts-confidence-btn.cz-tts-confidence-btn-active"
    );

    let value = null;
    if (activeBtn) {
      value = activeBtn.dataset.confidence || "";
    } else if (wrapper.dataset && wrapper.dataset.czConfidence) {
      value = wrapper.dataset.czConfidence;
    }

    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (v === "guess" || v === "unsure" || v === "sure") {
      return v;
    }
    return null;
  }

  // In-memory cache so the confidence pill stays highlighted even if Udemy
  // re-renders the form after validation.
  const confidenceCache = {};

  function getConfidenceCacheKey(wrapper) {
    if (!wrapper) return null;
    if (wrapper.dataset) {
      const existing =
        wrapper.dataset.czConfidenceCacheKey ||
        wrapper.dataset.czQuestionId;
      if (existing) return String(existing);
    }

    const form = wrapper.closest(QUIZ_FORM_SELECTOR);
    if (form) {
      const qid = getQuestionIdPractice(form);
      if (qid) return qid;

      const promptEl = findPromptElPractice(form);
      const promptText = normalizeWhitespace(
        (promptEl && promptEl.innerText) || ""
      );
      if (promptText) {
        if (hashString) {
          return "prompt_" + hashString(promptText);
        }
        return "prompt_" + promptText.toLowerCase().slice(0, 200);
      }
    }

    return null;
  }

  function applyConfidenceSelection(wrapper, value) {
    if (!wrapper) return;
    const normalized = value ? String(value).trim().toLowerCase() : "";

    if (wrapper.dataset) {
      if (normalized) {
        wrapper.dataset.czConfidence = normalized;
      } else {
        delete wrapper.dataset.czConfidence;
      }
    }

    const btns = wrapper.querySelectorAll(".cz-tts-confidence-btn");
    btns.forEach((btn) => {
      const btnVal = String(btn.dataset.confidence || "")
        .trim()
        .toLowerCase();
      const isActive = normalized && btnVal === normalized;
      btn.classList.toggle("cz-tts-confidence-btn-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function hydrateConfidenceFromMemory(wrapper, questionId) {
    const key =
      questionId ||
      (wrapper.dataset && wrapper.dataset.czConfidenceCacheKey) ||
      getConfidenceCacheKey(wrapper);
    const cached = key ? confidenceCache[key] : null;
    applyConfidenceSelection(wrapper, cached || null);
  }

  function clearConfidenceUI(wrapper) {
    if (!wrapper) return;
    applyConfidenceSelection(wrapper, null);
  }

  function attachConfidenceHandlers(wrapper) {
    if (!wrapper) return;
    const btns = wrapper.querySelectorAll(".cz-tts-confidence-btn");
    if (!btns.length) return;

    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const raw = btn.dataset.confidence || "";
        const v = String(raw).trim().toLowerCase();
        if (!v) return;

        btns.forEach((b) => {
          b.classList.remove("cz-tts-confidence-btn-active");
          b.setAttribute("aria-pressed", "false");
        });

        applyConfidenceSelection(wrapper, v);

        const cacheKey = getConfidenceCacheKey(wrapper);
        if (cacheKey) {
          confidenceCache[cacheKey] = v;
          if (wrapper.dataset) {
            wrapper.dataset.czConfidenceCacheKey = cacheKey;
          }
        }
      });
    });
  }

  // ---------------- Attempt snapshot + logging ----------------

  /**
   * Build a QuestionAttempt from the current practice form.
   * Includes the current confidence selection ("guess" | "unsure" | "sure").
   * This MUST be called *before* Udemy replaces the form with the result view.
   */
  function buildPracticeAttemptFromForm(formOverride) {
    const form = formOverride || getQuestionForm();
    if (!form) {
      log("buildPracticeAttemptFromForm: no form");
      return null;
    }

    const questionId = getQuestionIdPractice(form);
    if (!questionId) {
      log("buildPracticeAttemptFromForm: no questionId");
      return null;
    }

    const confidence = getCurrentConfidence(form);

    const promptEl = findPromptElPractice(form);
    const stemText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";

    const answerBodies = form.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d"
    );
    if (!answerBodies.length) {
      log("buildPracticeAttemptFromForm: no answers");
      return null;
    }

    const choices = [];
    const chosenIndices = [];
    const correctIndices = []; // we usually don't know this at click time

    Array.from(answerBodies).forEach((bodyEl, idx) => {
      const label = String.fromCharCode(65 + idx);
      const text = normalizeWhitespace(bodyEl.innerText || "") || "";
      choices.push({ index: idx, label, text });

      const root =
        bodyEl.closest("label") ||
        bodyEl.closest("div") ||
        bodyEl.parentElement;

      let isChosen = false;
      if (root) {
        const input = root.querySelector(
          'input[type="radio"], input[type="checkbox"]'
        );
        if (input && input.checked) {
          isChosen = true;
        }
      }

      if (isChosen) {
        chosenIndices.push(idx);
      }
    });

    // At click time we don't yet know if it is correct; keep it tri-state null.
    const isCorrect = null;
    const now = Date.now();

    const attempt = {
      attemptId: generateUuid(),
      questionId,
      examId: null, // practice mode, not tied to a specific exam
      examTitle: null,
      attemptOrdinal: null,
      examAttemptKey: null,
      mode: "practice",
      source: "practice-check-answer",
      timestamp: now,
      stemText,
      choices,
      chosenIndices,
      correctIndices,
      isCorrect,
      confidence: confidence || null
    };

    log("buildPracticeAttemptFromForm: snapshot", {
      questionId,
      chosenIndicesCount: chosenIndices.length,
      confidence: attempt.confidence
    });

    return attempt;
  }

  /**
   * Persist the attempt snapshot into chrome.storage.local:
   *   czQuestionAttempts[attemptId] = attempt
   *   czQuestionStats updated via questionStats.applyAttemptToStats
   */
  function logPracticeAttemptSnapshot(attempt) {
    if (!attempt) {
      log("logPracticeAttemptSnapshot: no attempt provided");
      return;
    }
    if (!chrome?.storage?.local) {
      log(
        "logPracticeAttemptSnapshot: chrome.storage.local not available",
        attempt
      );
      return;
    }

    chrome.storage.local.get(
      ["czQuestionAttempts", "czQuestionStats"],
      (res) => {
        const questionAttempts = res.czQuestionAttempts || {};
        const questionStats = res.czQuestionStats || {};

        questionAttempts[attempt.attemptId] = attempt;

        let updatedStats = questionStats;
        if (qsHelper && typeof qsHelper.applyAttemptToStats === "function") {
          try {
            updatedStats = qsHelper.applyAttemptToStats(
              questionStats,
              attempt
            );
          } catch (e) {
            log("applyAttemptToStats error", e);
          }
        }

        chrome.storage.local.set(
          {
            czQuestionAttempts: questionAttempts,
            czQuestionStats: updatedStats
          },
          () => {
            log(
              "Logged practice attempt snapshot",
              attempt.questionId,
              "isCorrect=",
              attempt.isCorrect,
              "confidence=",
              attempt.confidence
            );
          }
        );
      }
    );
  }

  // ---------------- Hook the "Check answer" button ----------------

  function getCheckAnswerButton() {
    // Matches your footer:
    // <button type="button" data-purpose="check-answer" ...>
    return document.querySelector('button[data-purpose="check-answer"]');
  }

  function attachCheckAnswerListener() {
    const btn = getCheckAnswerButton();
    if (!btn) {
      return; // no option selected yet -> button not present
    }
    if (btn.dataset.czTtsAttemptHooked === "1") {
      return;
    }
    btn.dataset.czTtsAttemptHooked = "1";

    log(
      'attachCheckAnswerListener: hooked button[data-purpose="check-answer"]'
    );

    btn.addEventListener("click", () => {
      // IMPORTANT: Udemy will replace the form with the result view immediately
      // after this click. We must snapshot the attempt now.
      const form = getQuestionForm();
      const attempt = buildPracticeAttemptFromForm(form);
      if (!attempt) {
        log("click handler: no attempt snapshot built");
        return;
      }

      // Persist confidence pick so the inline pills on the result page stay
      // highlighted (uses the same question hash as review mode).
      try {
        const confidenceInline =
          window.czUI && window.czUI.confidenceInline;
        if (
          confidenceInline &&
          typeof confidenceInline.recordAttempt === "function" &&
          attempt.questionId
        ) {
          confidenceInline.recordAttempt(
            attempt.questionId,
            null,
            attempt.confidence || null
          );
        }
      } catch (e) {
        log("confidenceInline.recordAttempt error", e);
      }

      logPracticeAttemptSnapshot(attempt);
    });
  }

  // ---------------- Main UI wiring ----------------

  function syncCardToCurrentQuestion() {
    const form = getQuestionForm();
    if (!form) {
      return;
    }

    const quizFeature = window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature || !insightFeature) {
      log(
        "syncCardToCurrentQuestion: missing feature(s)",
        "quiz=",
        !!quizFeature,
        "insight=",
        !!insightFeature
      );
      return;
    }

    const insightConfig = {
      getQuestionText: extractPracticeQuestionText,
      getQuestionId: getQuestionIdPractice,
      getOptionLetters: getOptionLettersPractice,
      getPromptElement: () => findPromptElPractice(getQuestionForm()),
      getAnswerElements: getAnswerElementsPractice,
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
        <div class="cz-tts-confidence-row">
          <span class="cz-tts-confidence-label">Confidence:</span>
          <button type="button" class="cz-tts-btn cz-tts-confidence-btn" data-confidence="guess" aria-pressed="false">
            Guess
          </button>
          <button type="button" class="cz-tts-btn cz-tts-confidence-btn" data-confidence="unsure" aria-pressed="false">
            Unsure
          </button>
          <button type="button" class="cz-tts-btn cz-tts-confidence-btn" data-confidence="sure" aria-pressed="false">
            Sure
          </button>
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

      attachConfidenceHandlers(wrapper);

      isNewWrapper = true;
    }

    const knownId = wrapper.dataset.czQuestionId || "";
    if (isNewWrapper || (currentId && knownId !== currentId)) {
      if (currentId) {
        wrapper.dataset.czQuestionId = currentId;
      }
      resetAnalysis(wrapper);
      restoreCachedInsightIfAny(wrapper, insightConfig);
    }

    // Keep confidence pill highlight persistent across validation/re-renders.
    const hydrateKey =
      currentId ||
      knownId ||
      (wrapper.dataset && wrapper.dataset.czConfidenceCacheKey) ||
      null;
    hydrateConfidenceFromMemory(wrapper, hydrateKey);

    // And make sure footer "Check answer" has our listener.
    attachCheckAnswerListener();
  }

  function setupObserver() {
    const target =
      document.querySelector(".quiz-page-content") || document.body;

    const obs = new MutationObserver(() => {
      // Any time Udemy swaps questions / DOM changes, re-sync.
      syncCardToCurrentQuestion();
    });

    obs.observe(target, { childList: true, subtree: true });
  }

  log("practice.js booting");
  syncCardToCurrentQuestion();
  setupObserver();

  window.czLocations.practiceMode = {
    resync: syncCardToCurrentQuestion
  };
})();
