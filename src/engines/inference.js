// /src/engines/inference.js
(function () {
  window.czEngines = window.czEngines || {};
  if (window.czEngines.inference) return;

  /**
   * Try to infer the single correct choice letter from eliminate_rules
   * when the model did not explicitly give correct_choice / correct_choices.
   * This is ONLY a fallback for single-answer questions.
   */
  function inferCorrectChoiceFromEliminateRules(eliminateRules) {
    const eliminated = new Set();

    if (Array.isArray(eliminateRules)) {
      eliminateRules.forEach((item) => {
        if (!item) return;
        const opt = String(item.option || item.choice || "")
          .trim()
          .toUpperCase();
        if (/^[A-Z]$/.test(opt)) eliminated.add(opt);
      });
    } else if (
      typeof eliminateRules === "object" &&
      eliminateRules !== null
    ) {
      Object.keys(eliminateRules).forEach((k) => {
        const opt = String(k || "").trim().toUpperCase();
        if (/^[A-Z]$/.test(opt)) eliminated.add(opt);
      });
    }

    if (!eliminated.size) return "";

    let minCode = Infinity;
    let maxCode = -Infinity;
    eliminated.forEach((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        if (code < minCode) minCode = code;
        if (code > maxCode) maxCode = code;
      }
    });

    if (!isFinite(minCode) || !isFinite(maxCode)) return "";
    if (maxCode - minCode > 6) return ""; // more than 7 options = strange

    const all = [];
    for (let c = minCode; c <= maxCode; c += 1) {
      all.push(String.fromCharCode(c));
    }

    const missing = all.filter((ch) => !eliminated.has(ch));
    if (missing.length === 1) {
      return missing[0];
    }

    return "";
  }

  window.czEngines.inference = {
    inferCorrectChoiceFromEliminateRules
  };
})();
