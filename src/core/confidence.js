// File: /src/core/confidence.js
// UC2 – Confidence & Meta-Input capture.
//
// Persists confidence for a given QuestionAttempt and recomputes
// per-question stats using UC1-C (questionStats.recomputeFromAllAttempts).

(function () {
  if (window.czCore && window.czCore.confidence) return;

  const log = (window.czCore && window.czCore.log) || (() => {});
  const qsHelper =
    (window.czCore && window.czCore.questionStats) || null;

  function normalizeConfidence(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (v === "sure" || v === "unsure" || v === "guess") return v;
    return null;
  }

  /**
   * Set confidence for a specific attemptId and recompute stats.
   *
   * - Updates czQuestionAttempts[attemptId].confidence
   * - Rebuilds czQuestionStats using UC1-C.recomputeFromAllAttempts
   */
  function setConfidenceForAttempt(attemptId, confidence, cb) {
    const conf = normalizeConfidence(confidence);
    if (!attemptId || !conf) {
      cb && cb({ ok: false, error: "BAD_INPUT" });
      return;
    }

    if (!chrome?.storage?.local) {
      log("Confidence", "chrome.storage.local not available");
      cb && cb({ ok: false, error: "NO_STORAGE" });
      return;
    }

    chrome.storage.local.get(
      ["czQuestionAttempts", "czQuestionStats"],
      (res) => {
        const questionAttempts = res.czQuestionAttempts || {};
        const questionStats = res.czQuestionStats || {};

        const attempt = questionAttempts[attemptId];
        if (!attempt) {
          log("Confidence", "Attempt not found for id:", attemptId);
          cb && cb({ ok: false, error: "ATTEMPT_NOT_FOUND" });
          return;
        }

        const prevConf = attempt.confidence || null;
        if (prevConf === conf) {
          cb && cb({ ok: true, unchanged: true });
          return;
        }

        attempt.confidence = conf;
        questionAttempts[attemptId] = attempt;

        let updatedStats = questionStats;
        if (
          qsHelper &&
          typeof qsHelper.recomputeFromAllAttempts === "function"
        ) {
          try {
            updatedStats =
              qsHelper.recomputeFromAllAttempts(questionAttempts);
          } catch (e) {
            log(
              "Confidence",
              "recomputeFromAllAttempts error",
              e
            );
          }
        }

        chrome.storage.local.set(
          {
            czQuestionAttempts: questionAttempts,
            czQuestionStats: updatedStats
          },
          () => {
            cb && cb({ ok: true });
          }
        );
      }
    );
  }

  window.czCore = window.czCore || {};
  window.czCore.confidence = {
    setConfidenceForAttempt
  };
})();
