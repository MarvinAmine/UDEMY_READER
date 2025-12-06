// File: /src/ui/confidenceInline.js
//
// CU2 – Small inline confidence UI on the cz-tts-wrapper.
// - Practice mode: interactive Guess / Unsure / Sure chooser.
// - Review mode: also editable.
// - Confidence choice is persisted per question in chrome.storage.local.
// - Question ID is derived from the DOM question text, so it stays stable
//   between practice and review (including the AWS CLF practice exam page).

(function () {
  window.czUI = window.czUI || {};
  if (window.czUI.confidenceInline) return;

  const log = (window.czCore && window.czCore.log) || function () {};
  const coreStorage = (window.czCore && window.czCore.storage) || null;

  const CONFIDENCE_STATS_KEY = "cz-v1-confidenceStats";
  const CONFIDENCE_PICKS_KEY = "cz-v1-confidencePicks";

  // In-memory fallbacks (used if chrome.storage is unavailable)
  let inMemoryStats = {
    questions: {},
    updatedAt: 0
  };
  let inMemoryPicks = {}; // { [qid]: "guess" | "unsure" | "sure" }

  /**
   * Find the DOM element that contains the question text.
   * We try near the wrapper first (ancestors), then fall back to the document.
   * This covers both practice and review pages, including:
   *   id="question-prompt"
   *   data-purpose="question-prompt"
   */
  function findQuestionTextElement(wrapper) {
    const selectors = [
      "#question-prompt",
      '[data-purpose="question-prompt"]',
      '[data-purpose^="question-prompt"]',
      // Fallback: main rich text viewer for the question, often used by Udemy
      '[data-purpose^="safely-set-inner-html:rich-text-viewer:html"]'
    ];

    // 1) Try searching within ancestors of the wrapper
    if (wrapper && wrapper.parentElement) {
      let node = wrapper.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        for (const sel of selectors) {
          const el = node.querySelector(sel);
          if (el) return el;
        }
        node = node.parentElement;
      }
    }

    // 2) Fallback: search the entire document (there is typically only one visible question)
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    return null;
  }

  /**
   * Very simple stable hash of text -> "q_<hex>".
   * This is enough to distinguish questions for local storage usage.
   */
  function hashQuestionText(text) {
    if (!text) return null;
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) return null;

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0; // unsigned 32-bit
    }
    return "q_" + hash.toString(16);
  }

  function normalizeConfidenceValue(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (v === "guess" || v === "unsure" || v === "sure") return v;
    return null;
  }

  /**
   * Derive or reuse a stable question id for a wrapper.
   * We ignore adapter-provided IDs and always use a hash of the question text
   * so it is guaranteed to stay the same in practice + review.
   */
  function getOrInitQuestionId(wrapper) {
    if (!wrapper) return null;

    if (wrapper.dataset && wrapper.dataset.czQuestionId) {
      return String(wrapper.dataset.czQuestionId);
    }

    const el = findQuestionTextElement(wrapper);
    if (!el) {
      log("ConfidenceInline", "No question text element found for wrapper");
      return null;
    }

    const rawText = (el.innerText || el.textContent || "").trim();
    const qid = hashQuestionText(rawText);

    if (qid && wrapper.dataset) {
      wrapper.dataset.czQuestionId = String(qid);
    }

    return qid || null;
  }

  /**
   * STATS (attempts + correctness)
   * Shape:
   * {
   *   questions: {
   *     [questionId]: {
   *       totalAttempts,
   *       correctAttempts,
   *       wrongAttempts,
   *       guessAttempts,
   *       unsureAttempts,
   *       sureAttempts,
   *       lastConfidence,
   *       lastResult
   *     },
   *   },
   *   updatedAt
   * }
   */
  function getLocalStats(cb) {
    if (!coreStorage || typeof coreStorage.getLocal !== "function") {
      cb(inMemoryStats);
      return;
    }

    try {
      const obj = {};
      obj[CONFIDENCE_STATS_KEY] = null;

      coreStorage.getLocal(obj, function (items) {
        let stats = items && items[CONFIDENCE_STATS_KEY];

        if (!stats || typeof stats !== "object") {
          stats = {
            questions: {},
            updatedAt: Date.now()
          };
        } else {
          if (!stats.questions || typeof stats.questions !== "object") {
            stats.questions = {};
          }
          if (typeof stats.updatedAt !== "number") {
            stats.updatedAt = Date.now();
          }
        }

        inMemoryStats = stats;
        cb(stats);
      });
    } catch (err) {
      log("ConfidenceInline", "getLocalStats error", err);
      cb(inMemoryStats);
    }
  }

  function saveLocalStats(stats, cb) {
    if (!stats || typeof stats !== "object") {
      stats = {
        questions: {},
        updatedAt: Date.now()
      };
    }
    if (!stats.questions || typeof stats.questions !== "object") {
      stats.questions = {};
    }
    if (typeof stats.updatedAt !== "number") {
      stats.updatedAt = Date.now();
    }

    inMemoryStats = stats;

    if (!coreStorage || typeof coreStorage.setLocal !== "function") {
      cb && cb();
      return;
    }

    try {
      const obj = {};
      obj[CONFIDENCE_STATS_KEY] = inMemoryStats;

      coreStorage.setLocal(obj, function () {
        cb && cb();
      });
    } catch (err) {
      log("ConfidenceInline", "saveLocalStats error", err);
      cb && cb();
    }
  }

  function applyAttemptToStats(stats, qid, isCorrect, confidence) {
    if (!qid) return stats;

    const key = String(qid);
    const now = Date.now();

    if (!stats || typeof stats !== "object") {
      stats = { questions: {}, updatedAt: now };
    }
    if (!stats.questions || typeof stats.questions !== "object") {
      stats.questions = {};
    }

    const questions = stats.questions;
    let entry = questions[key];

    if (!entry) {
      entry = {
        totalAttempts: 0,
        correctAttempts: 0,
        wrongAttempts: 0,
        guessAttempts: 0,
        unsureAttempts: 0,
        sureAttempts: 0,
        lastConfidence: null,
        lastResult: null
      };
    }

    entry.totalAttempts += 1;

    if (isCorrect === true) {
      entry.correctAttempts += 1;
      entry.lastResult = "correct";
    } else if (isCorrect === false) {
      entry.wrongAttempts += 1;
      entry.lastResult = "wrong";
    } else {
      entry.lastResult = null;
    }

    const conf = (confidence || "").trim();
    if (conf) {
      entry.lastConfidence = conf;
      if (conf === "guess") entry.guessAttempts += 1;
      else if (conf === "unsure") entry.unsureAttempts += 1;
      else if (conf === "sure") entry.sureAttempts += 1;
    }

    questions[key] = entry;

    return {
      questions: questions,
      updatedAt: now
    };
  }

  /**
   * PICKS (editable, persistent per question)
   * Shape: { [qid]: "guess" | "unsure" | "sure" }
   */
  function getLocalPicks(cb) {
    if (!coreStorage || typeof coreStorage.getLocal !== "function") {
      cb(inMemoryPicks);
      return;
    }

    try {
      const obj = {};
      obj[CONFIDENCE_PICKS_KEY] = null;

      coreStorage.getLocal(obj, function (items) {
        let picks = items && items[CONFIDENCE_PICKS_KEY];
        if (!picks || typeof picks !== "object") {
          picks = {};
        }

        inMemoryPicks = picks;
        cb(picks);
      });
    } catch (err) {
      log("ConfidenceInline", "getLocalPicks error", err);
      cb(inMemoryPicks);
    }
  }

  function saveLocalPicks(picks, cb) {
    if (!picks || typeof picks !== "object") {
      picks = {};
    }
    inMemoryPicks = picks;

    if (!coreStorage || typeof coreStorage.setLocal !== "function") {
      cb && cb();
      return;
    }

    try {
      const obj = {};
      obj[CONFIDENCE_PICKS_KEY] = inMemoryPicks;

      coreStorage.setLocal(obj, function () {
        cb && cb();
      });
    } catch (err) {
      log("ConfidenceInline", "saveLocalPicks error", err);
      cb && cb();
    }
  }

  function setPickForQuestion(qid, value, cb) {
    if (!qid) {
      cb && cb();
      return;
    }
    const key = String(qid);

    getLocalPicks(function (picks) {
      if (value) {
        picks[key] = value;
      } else {
        delete picks[key];
      }
      saveLocalPicks(picks, cb);
    });
  }

  function pickLatestAttemptConfidence(attemptsMap, qid) {
    if (!attemptsMap || !qid)
      return { confidence: null, attemptId: null, latestAttemptId: null };

    let latest = { ts: -Infinity, attemptId: null, confidence: null };
    let latestAny = { ts: -Infinity, attemptId: null };

    Object.values(attemptsMap || {}).forEach((att) => {
      if (!att || att.questionId !== qid) return;

      const ts =
        typeof att.timestamp === "number" && !Number.isNaN(att.timestamp)
          ? att.timestamp
          : 0;

      if (ts >= latestAny.ts) {
        latestAny = { ts, attemptId: att.attemptId || null };
      }

      const conf = normalizeConfidenceValue(att.confidence);
      if (!conf) return;

      if (ts >= latest.ts) {
        latest = { ts, attemptId: att.attemptId || null, confidence: conf };
      }
    });

    return {
      confidence: latest.confidence || null,
      attemptId: latest.attemptId || null,
      latestAttemptId: latestAny.attemptId || null
    };
  }

  function getModelConfidence(qid, cb) {
    if (!qid) {
      cb({
        confidence: null,
        statsEntry: null,
        attemptId: null
      });
      return;
    }

    if (!chrome?.storage?.local) {
      cb({
        confidence: null,
        statsEntry: null,
        attemptId: null
      });
      return;
    }

    chrome.storage.local.get(
      ["czQuestionStats", "czQuestionAttempts"],
      (res) => {
        const statsMap = res.czQuestionStats || {};
        const statsEntry =
          (statsMap && typeof statsMap === "object" && statsMap[qid]) || null;

        let confidence = null;
        if (statsEntry && statsEntry.lastConfidence) {
          confidence = normalizeConfidenceValue(statsEntry.lastConfidence);
        }

        const attempts = res.czQuestionAttempts || {};
        const latest = pickLatestAttemptConfidence(attempts, qid);

        if (!confidence && latest.confidence) {
          confidence = latest.confidence;
        }

        cb({
          confidence: confidence || null,
          statsEntry: statsEntry || null,
          attemptId: latest.attemptId || null,
          latestAttemptId: latest.latestAttemptId || null
        });
      }
    );
  }

  function pushConfidenceToModels(qid, value) {
    const conf = normalizeConfidenceValue(value);
    if (!qid || !conf) return;

    const setConfidence =
      window.czCore &&
      window.czCore.confidence &&
      typeof window.czCore.confidence.setConfidenceForAttempt === "function"
        ? window.czCore.confidence.setConfidenceForAttempt
        : null;

    if (!setConfidence || !chrome?.storage?.local) {
      log(
        "ConfidenceInline",
        "pushConfidenceToModels: setConfidenceForAttempt unavailable"
      );
      return;
    }

    chrome.storage.local.get(["czQuestionAttempts"], (res) => {
      const attempts = res.czQuestionAttempts || {};
      const latest = pickLatestAttemptConfidence(attempts, qid);
      const attemptId = latest.attemptId || latest.latestAttemptId;
      if (!attemptId) {
        log(
          "ConfidenceInline",
          "pushConfidenceToModels: no attempt found for question",
          qid
        );
        return;
      }

      setConfidence(attemptId, conf, function (resp) {
        log(
          "ConfidenceInline",
          "pushConfidenceToModels: setConfidenceForAttempt",
          attemptId,
          "->",
          conf,
          resp || {}
        );
      });
    });
  }

  /**
   * Public helper that the practice adapter can call after
   * a "Check answer" event.
   *
   * Example usage from practice adapter:
   *   czUI.confidenceInline.recordAttempt(myQid, isCorrect, confidence);
   *
   * Here myQid can be:
   *   - the same DOM-derived ID (recommended),
   *   - or any other key (stats only; picks are bound to DOM ID via clicks).
   */
  function recordAttempt(qid, isCorrect, confidence, cb) {
    if (!qid) {
      cb && cb();
      return;
    }

    const conf = (confidence || "").trim() || null;

    getLocalStats(function (current) {
      const next = applyAttemptToStats(current, qid, isCorrect, conf);
      saveLocalStats(next, function () {
        // Also keep the editable pick in sync if we have a confidence
        if (conf) {
          setPickForQuestion(qid, conf, function () {
            cb && cb(next);
          });
        } else {
          cb && cb(next);
        }
      });
    });
  }

  function updateSelectedPills(root, value) {
    const pills = root.querySelectorAll(".cz-tts-confidence-pill");
    pills.forEach(function (btn) {
      const v = (btn.dataset.czConfidence || "").trim();
      if (value && v === value) {
        btn.classList.add("cz-tts-confidence-pill-selected");
      } else {
        btn.classList.remove("cz-tts-confidence-pill-selected");
      }
    });
  }

  function renderSummary(root, statsEntry) {
    const summaryEl = root.querySelector(".cz-tts-confidence-summary");
    if (!summaryEl) return;

    if (!statsEntry || !statsEntry.totalAttempts) {
      summaryEl.textContent = "";
      return;
    }

    const parts = [];
    parts.push("Attempts: " + statsEntry.totalAttempts);

    if (statsEntry.correctAttempts) {
      parts.push("Correct: " + statsEntry.correctAttempts);
    }
    if (statsEntry.wrongAttempts) {
      parts.push("Wrong: " + statsEntry.wrongAttempts);
    }

    const confParts = [];
    if (statsEntry.guessAttempts) {
      confParts.push("Guess: " + statsEntry.guessAttempts);
    }
    if (statsEntry.unsureAttempts) {
      confParts.push("Unsure: " + statsEntry.unsureAttempts);
    }
    if (statsEntry.sureAttempts) {
      confParts.push("Sure: " + statsEntry.sureAttempts);
    }

    if (confParts.length) {
      parts.push("Confidence – " + confParts.join(", "));
    }

    summaryEl.textContent = parts.join(" · ");
  }

  /**
   * Refresh selection + summary for a given wrapper.
   * Uses precedence:
   *   1) wrapper.dataset.czConfidence (current session)
   *   2) persisted pick (CONFIDENCE_PICKS_KEY, DOM-based question ID)
   *   3) lastConfidence from inline stats
   *   4) lastConfidence from QuestionStats / QuestionAttempts
   */
  function refreshForWrapper(wrapper, explicitQuestionId) {
    if (!wrapper) return;
    const root = wrapper.querySelector(".cz-tts-confidence-root");
    if (!root) return;

    let qid =
      explicitQuestionId ||
      (wrapper.dataset && wrapper.dataset.czQuestionId) ||
      null;

    if (!qid) {
      qid = getOrInitQuestionId(wrapper);
    }

    const selectedFromDataset =
      (wrapper.dataset && wrapper.dataset.czConfidence) || "";

    // If we still do not have a question id, do not hit storage.
    if (!qid) {
      const value = (selectedFromDataset || "").trim();
      updateSelectedPills(root, value || null);
      renderSummary(root, null);
      return;
    }

    const key = String(qid);

    getLocalPicks(function (picks) {
      const pickValue = (picks && picks[key]) || "";

      getLocalStats(function (stats) {
        const questionsMap = (stats && stats.questions) || {};
        const entry = questionsMap[key] || null;

        getModelConfidence(key, function (model) {
          let effectiveConfidence = (selectedFromDataset || "").trim();

          if (!effectiveConfidence && pickValue) {
            effectiveConfidence = String(pickValue).trim();
          }

          if (
            !effectiveConfidence &&
            entry &&
            entry.lastConfidence
          ) {
            effectiveConfidence = String(entry.lastConfidence).trim();
          }

          if (
            !effectiveConfidence &&
            model &&
            model.confidence
          ) {
            effectiveConfidence = model.confidence;
          }

          if (wrapper.dataset) {
            if (effectiveConfidence) {
              wrapper.dataset.czConfidence = effectiveConfidence;
            } else {
              delete wrapper.dataset.czConfidence;
            }
          }

          const summaryEntry = entry || (model && model.statsEntry) || null;

          // Backfill pick cache so subsequent renders do not rely on storage scans.
          if (
            !selectedFromDataset &&
            !pickValue &&
            effectiveConfidence &&
            key
          ) {
            setPickForQuestion(key, effectiveConfidence);
          }

          updateSelectedPills(root, effectiveConfidence || null);
          renderSummary(root, summaryEntry);
        });
      });
    });
  }

  /**
   * Mount the inline confidence UI into a cz-tts-wrapper.
   * config: {
   *   mode: "practice" | "review"
   * }
   *
   * Note: we ignore adapter-provided getQuestionId and always derive an ID
   *       from the question text so it's stable between practice and review.
   */
  function mount(wrapper, config) {
    if (!wrapper || !config) return;

    const root = wrapper.querySelector(".cz-tts-confidence-root");
    if (!root) return;

    const mode = config.mode ? String(config.mode) : "unknown";
    const isPractice = mode === "practice";
    const cfgQuestionId =
      config && typeof config.getQuestionId === "function"
        ? config.getQuestionId()
        : null;

    const alreadyMounted = root.dataset.czConfidenceMounted === "1";

    if (!alreadyMounted) {
      root.classList.add("cz-tts-confidence");
      if (!isPractice) {
        // Stylistic marker; still editable in review
        root.classList.add("cz-tts-confidence-readonly");
      }

      root.innerHTML =
        '<div class="cz-tts-confidence-pills">' +
        '<span class="cz-tts-confidence-label">Confidence:</span>' +
        '<button type="button" class="cz-tts-confidence-pill" data-cz-confidence="guess">Guess</button>' +
        '<button type="button" class="cz-tts-confidence-pill" data-cz-confidence="unsure">Unsure</button>' +
        '<button type="button" class="cz-tts-confidence-pill" data-cz-confidence="sure">Sure</button>' +
        "</div>" +
        '<div class="cz-tts-confidence-summary"></div>';

      // Editable in BOTH practice + review
      root.addEventListener("click", function (evt) {
        const btn = evt.target.closest(".cz-tts-confidence-pill");
        if (!btn) return;
        const value = normalizeConfidenceValue(btn.dataset.czConfidence);
        if (!value) return;
        if (!wrapper.dataset) return;

        const currentQid =
          wrapper.dataset.czQuestionId ||
          getOrInitQuestionId(wrapper) ||
          null;

        wrapper.dataset.czConfidence = value;
        updateSelectedPills(root, value);

        if (currentQid) {
          setPickForQuestion(currentQid, value);
          pushConfidenceToModels(currentQid, value);
        }
      });

      root.dataset.czConfidenceMounted = "1";
    }

    // If adapter provides a stable questionId, persist it on the wrapper first.
    if (cfgQuestionId && wrapper.dataset && !wrapper.dataset.czQuestionId) {
      wrapper.dataset.czQuestionId = String(cfgQuestionId);
    }

    const qid =
      (cfgQuestionId && String(cfgQuestionId)) ||
      getOrInitQuestionId(wrapper);
    refreshForWrapper(wrapper, qid || null);
  }

  window.czUI.confidenceInline = {
    mount: mount,
    refreshForWrapper: refreshForWrapper,
    recordAttempt: recordAttempt
  };
})();
