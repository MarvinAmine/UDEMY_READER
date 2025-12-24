// /src/core/revisionQueue.js
// Minimal revision queue helper: keeps a rolling list of questions that
// should be revisited (wrong or low-confidence attempts).

(function () {
  if (window.czCore && window.czCore.revisionQueue) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  function normalizeConfidence(conf) {
    const c = (conf || "").toLowerCase().trim();
    return c === "guess" || c === "unsure" || c === "sure" ? c : null;
  }

  function classifyReason(attempt) {
    if (!attempt) return null;
    if (attempt.isCorrect === false) return "wrong";
    const conf = normalizeConfidence(attempt.confidence);
    if (conf === "guess" || conf === "unsure") return "low-confidence";
    return null;
  }

  function shouldQueueAttempt(attempt) {
    return !!classifyReason(attempt);
  }

  function upsertRevision(queue, attempt) {
    if (!attempt || !attempt.questionId) return queue || {};
    const reason = classifyReason(attempt);
    if (!reason) return queue || {};

    const now = Date.now();
    const out = queue || {};
    const key = String(attempt.questionId);
    const existing = out[key] || {};

    const mergedChoices =
      (attempt.choices && attempt.choices.length && attempt.choices) ||
      existing.choices ||
      [];

    const lastResult =
      attempt.isCorrect === true
        ? "correct"
        : attempt.isCorrect === false
          ? "wrong"
          : "unknown";

    const entry = {
      questionId: key,
      stemText: attempt.stemText || existing.stemText || "",
      choices: mergedChoices,
      lastConfidence: normalizeConfidence(attempt.confidence) || existing.lastConfidence || null,
      lastResult,
      lastReason: reason,
      lastMode: attempt.mode || existing.lastMode || null,
      lastAttemptId: attempt.attemptId || existing.lastAttemptId || null,
      lastExamId:
        attempt.examId !== undefined ? attempt.examId : existing.lastExamId || null,
      lastExamTitle:
        attempt.examTitle !== undefined
          ? attempt.examTitle
          : existing.lastExamTitle || null,
      lastSeenAt: now,
      firstSeenAt: existing.firstSeenAt || now,
      totalAdds: (existing.totalAdds || 0) + 1,
      wrongAdds: existing.wrongAdds || 0,
      lowConfidenceAdds: existing.lowConfidenceAdds || 0,
      lastChosenIndices:
        (Array.isArray(attempt.chosenIndices) && attempt.chosenIndices) ||
        existing.lastChosenIndices ||
        [],
      lastCorrectIndices:
        (Array.isArray(attempt.correctIndices) && attempt.correctIndices) ||
        existing.lastCorrectIndices ||
        []
    };

    if (reason === "wrong") entry.wrongAdds += 1;
    if (reason === "low-confidence") entry.lowConfidenceAdds += 1;

    out[key] = entry;
    return out;
  }

  function applyAttempt(queue, attempt) {
    try {
      return upsertRevision(queue, attempt);
    } catch (e) {
      log("RevisionQueue", "applyAttempt error", e);
      return queue || {};
    }
  }

  window.czCore = window.czCore || {};
  window.czCore.revisionQueue = {
    shouldQueueAttempt,
    upsertRevision,
    applyAttempt
  };
})();
