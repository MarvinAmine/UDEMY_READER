// /src/engines/analysisFormatter.js
(function () {
  window.czEngines = window.czEngines || {};
  if (window.czEngines.analysis) return;

  const infer =
    window.czEngines.inference &&
    window.czEngines.inference.inferCorrectChoiceFromEliminateRules;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Render the JSON analysis into HTML string only.
   *
   * Expected fields:
   *  - short_stem: string | string[]
   *  - key_triggers: string[]
   *  - eliminate_rules: object | array
   *  - topic_tags: string[]
   *  - correct_choice / correct_choices
   *  - correct_reason
   */
  function renderAnalysis(analysis, optionLetters) {
    const shortStem = analysis.short_stem;
    const keyTriggers = Array.isArray(analysis.key_triggers)
      ? analysis.key_triggers
      : [];
    const topicTags = Array.isArray(analysis.topic_tags)
      ? analysis.topic_tags
      : [];
    const eliminateRules = analysis.eliminate_rules || {};

    const correctChoicesRaw = Array.isArray(analysis.correct_choices)
      ? analysis.correct_choices
      : [];

    const correctChoiceRaw =
      analysis.correct_choice ||
      analysis.correct_answer ||
      analysis.best_choice ||
      analysis.best_answer ||
      "";

    let singleChoice = String(correctChoiceRaw || "").trim().toUpperCase();

    let correctChoices = correctChoicesRaw
      .map((c) => String(c || "").trim().toUpperCase())
      .filter((c) => /^[A-Z]$/.test(c));

    if (!correctChoices.length && singleChoice) {
      correctChoices = [singleChoice];
    }

    if (!correctChoices.length && infer) {
      const inferred = infer(eliminateRules);
      if (inferred) {
        correctChoices = [inferred];
      }
    }

    const isMulti = correctChoices.length > 1;
    const primaryChoice = correctChoices[0] || "";

    const correctReasonRaw =
      analysis.correct_reason ||
      analysis.correct_explanation ||
      analysis.reason_correct ||
      "";

    let correctReason = String(correctReasonRaw || "").trim();

    if (!correctReason && correctChoices.length) {
      if (keyTriggers.length) {
        const triggersStr = keyTriggers.join(", ");
        if (isMulti) {
          correctReason =
            "These options together directly address the key triggers: " +
            triggersStr +
            ".";
        } else {
          correctReason =
            "This option is the one that directly addresses the key triggers: " +
            triggersStr +
            ".";
        }
      } else if (
        (Array.isArray(shortStem) && shortStem.length) ||
        (typeof shortStem === "string" && shortStem.trim())
      ) {
        const stemSummary = Array.isArray(shortStem)
          ? shortStem.join("; ")
          : shortStem;
        if (isMulti) {
          correctReason =
            "This set of options best matches the short version of the question: " +
            stemSummary +
            ".";
        } else {
          correctReason =
            "This option best matches the short version of the question: " +
            stemSummary +
            ".";
        }
      } else {
        correctReason =
          "This selection best satisfies what the question is asking.";
      }
    }

    const correctSet = new Set(
      correctChoices.map((c) => String(c || "").trim().toUpperCase())
    );

    let html = "";

    // Best answer(s)
    if (correctChoices.length || correctReason) {
      if (isMulti) {
        html += "<strong>Best answers:</strong><ul>";
        correctChoices.forEach((c) => {
          html += `<li><strong>Option:</strong> ${escapeHtml(c)}</li>`;
        });
        if (correctReason) {
          html += `<li><strong>Why (set):</strong> ${escapeHtml(
            correctReason
          )}</li>`;
        }
        html += "</ul>";
      } else {
        html += "<strong>Best answer:</strong><ul>";
        if (primaryChoice) {
          html += `<li><strong>Option:</strong> ${escapeHtml(
            primaryChoice
          )}</li>`;
        }
        if (correctReason) {
          html += `<li><strong>Why:</strong> ${escapeHtml(correctReason)}</li>`;
        }
        html += "</ul>";
      }
    }

    // Short stem
    if (Array.isArray(shortStem)) {
      html += "<strong>Short version:</strong><ul>";
      shortStem.forEach((line) => {
        html += `<li>${escapeHtml(String(line))}</li>`;
      });
      html += "</ul>";
    } else if (typeof shortStem === "string" && shortStem.trim()) {
      html += "<strong>Short version:</strong><ul>";
      html += `<li>${escapeHtml(shortStem.trim())}</li>`;
      html += "</ul>";
    }

    // Key triggers
    if (keyTriggers.length) {
      html += "<strong>Key triggers:</strong><ul>";
      keyTriggers.forEach((t) => {
        html += `<li>${escapeHtml(String(t))}</li>`;
      });
      html += "</ul>";
    }

    // Eliminate rules
    const rulesArray = [];
    if (Array.isArray(eliminateRules)) {
      eliminateRules.forEach((item) => {
        if (!item) return;
        const optRaw = item.option || item.choice || "";
        const opt = String(optRaw || "").trim().toUpperCase();
        const reason = item.reason || item.explanation || "";
        if (!opt || !reason) return;
        if (correctSet.has(opt)) return;
        rulesArray.push({ opt, reason });
      });
    } else if (typeof eliminateRules === "object" && eliminateRules !== null) {
      Object.entries(eliminateRules).forEach(([k, v]) => {
        if (!v) return;
        const opt = String(k || "").trim().toUpperCase();
        if (correctSet.has(opt)) return;
        rulesArray.push({
          opt,
          reason: String(v)
        });
      });
    }

    if (rulesArray.length) {
      html += "<strong>Why other options are wrong:</strong><ul>";
      rulesArray.forEach(({ opt, reason }) => {
        html += `<li><strong>${escapeHtml(
          String(opt)
        )}:</strong> ${escapeHtml(String(reason))}</li>`;
      });
      html += "</ul>";
    }

    // Uncovered wrong options
    if (Array.isArray(optionLetters) && optionLetters.length) {
      const knownWrong = new Set(
        rulesArray.map((r) => String(r.opt || "").trim().toUpperCase())
      );
      const missingWrong = optionLetters
        .map((l) => String(l || "").trim().toUpperCase())
        .filter(
          (l) =>
            /^[A-Z]$/.test(l) &&
            !correctSet.has(l) &&
            !knownWrong.has(l)
        );

      if (missingWrong.length) {
        html += "<strong>Other options not covered by analysis:</strong><ul>";
        missingWrong.forEach((l) => {
          html += `<li><strong>${escapeHtml(
            l
          )}:</strong> No explanation returned by the model.</li>`;
        });
        html += "</ul>";
      }
    }

    // Topic tags
    if (topicTags.length) {
      html += `<div class="cz-tts-analysis-tags">Tags: ${topicTags
        .map((t) => escapeHtml(String(t)))
        .join(", ")}</div>`;
    }

    if (!html) {
      html =
        "<em>Analysis did not return structured data. Check your prompt or try again.</em>";
    }

    return html;
  }

  window.czEngines.analysis = {
    renderAnalysis,
    escapeHtml
  };
})();
