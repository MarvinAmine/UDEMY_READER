// /src/core/questionStats.js
// UC1-C – Per-question ground-truth stats aggregated from QuestionAttempts.
// Extended for CU2 – track confidence buckets + lastConfidence.

(function () {
  if (window.czCore && window.czCore.questionStats) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  /**
   * Apply a single QuestionAttempt to the in-memory stats object.
   *
   * Stats shape per questionId (fields are additive):
   * {
   *   questionId: string,
   *   totalAttempts: number,
   *   correctAttempts: number,
   *   wrongAttempts: number,
   *   guessAttempts: number,
   *   unsureAttempts: number,
   *   sureAttempts: number,
   *   lastAttemptAt: number,
   *   lastCorrectAt: number | undefined,
   *   lastWrongAt: number | undefined,
   *   lastConfidence: "guess" | "unsure" | "sure" | undefined,
   *   lastMode: string | undefined,
   *   // Plus any fields written by CU1-A (tags, analyzeInvocationCount, etc.)
   * }
   */
  function applyAttemptToStats(stats, attempt) {
    if (!attempt || !attempt.questionId) return stats || {};

    const out = stats || {};
    const key = String(attempt.questionId);
    const existing = out[key] || {};
    const entry = Object.assign({}, existing);

    const tsRaw = attempt.timestamp;
    const ts =
      typeof tsRaw === "number" && !Number.isNaN(tsRaw) ? tsRaw : Date.now();

    entry.questionId = key;

    // Global attempts
    entry.totalAttempts = (entry.totalAttempts || 0) + 1;

    // Correct / wrong splits
    if (attempt.isCorrect === true) {
      entry.correctAttempts = (entry.correctAttempts || 0) + 1;
    } else if (attempt.isCorrect === false) {
      entry.wrongAttempts = (entry.wrongAttempts || 0) + 1;
    }

    // Confidence buckets (CU2)
    const conf = attempt.confidence;
    if (conf === "guess") {
      entry.guessAttempts = (entry.guessAttempts || 0) + 1;
      entry.lastConfidence = "guess";
    } else if (conf === "unsure") {
      entry.unsureAttempts = (entry.unsureAttempts || 0) + 1;
      entry.lastConfidence = "unsure";
    } else if (conf === "sure") {
      entry.sureAttempts = (entry.sureAttempts || 0) + 1;
      entry.lastConfidence = "sure";
    }

    if (attempt.mode) {
      entry.lastMode = String(attempt.mode);
    }

    // Recency
    const prevLastAttempt =
      typeof entry.lastAttemptAt === "number" && !Number.isNaN(entry.lastAttemptAt)
        ? entry.lastAttemptAt
        : 0;

    entry.lastAttemptAt = prevLastAttempt > 0 ? Math.max(prevLastAttempt, ts) : ts;

    if (attempt.isCorrect === true) {
      const prevLastCorrect =
        typeof entry.lastCorrectAt === "number" && !Number.isNaN(entry.lastCorrectAt)
          ? entry.lastCorrectAt
          : 0;
      entry.lastCorrectAt =
        prevLastCorrect > 0 ? Math.max(prevLastCorrect, ts) : ts;
    } else if (attempt.isCorrect === false) {
      const prevLastWrong =
        typeof entry.lastWrongAt === "number" && !Number.isNaN(entry.lastWrongAt)
          ? entry.lastWrongAt
          : 0;
      entry.lastWrongAt =
        prevLastWrong > 0 ? Math.max(prevLastWrong, ts) : ts;
    }

    out[key] = entry;
    return out;
  }

  /**
   * Apply an array of attempts to the stats object.
   */
  function applyAttemptsArray(stats, attempts) {
    let out = stats || {};
    (attempts || []).forEach((att) => {
      out = applyAttemptToStats(out, att);
    });
    return out;
  }

  /**
   * Full recompute helper from all QuestionAttempts (not used yet, but handy).
   */
  function recomputeFromAllAttempts(questionAttempts) {
    const stats = {};
    Object.values(questionAttempts || {}).forEach((att) => {
      applyAttemptToStats(stats, att);
    });
    log(
      "QuestionStats",
      "Recomputed stats from",
      Object.keys(questionAttempts || {}).length,
      "attempt(s)"
    );
    return stats;
  }

  window.czCore = window.czCore || {};
  window.czCore.questionStats = {
    applyAttemptToStats,
    applyAttemptsArray,
    recomputeFromAllAttempts
  };
})();
