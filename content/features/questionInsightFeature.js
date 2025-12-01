// content/features/questionInsightFeature.js
// Shared Question Insight feature (LLM analysis + weak-topic stats)
// Shows the best answer(s) and why they are correct.

(function () {
  if (window.czFeatures && window.czFeatures.questionInsight) return;

  function log(...args) {
    console.log("[UdemyReader][QuestionInsight]", ...args);
  }

  /**
   * Mount Question Insight on a given analysis card.
   *
   * @param {HTMLElement} analysisRoot  - The `.cz-tts-analysis` container.
   * @param {Object} config
   *   getQuestionText: () => string
   *   getQuestionId?: () => string | null
   *   getOptionLetters?: () => string[]   // optional: ['A','B','C',...]
   */
  function mount(analysisRoot, config) {
    if (!analysisRoot || !config) return;

    const bodyEl = analysisRoot.querySelector(".cz-tts-analysis-body");
    if (!bodyEl) return;

    analysisRoot.addEventListener("click", (evt) => {
      const btn = evt.target.closest(
        "button.cz-tts-btn[data-action='analyze-question']"
      );
      if (!btn) return;

      const text = safeCall(config.getQuestionText);
      const qid = safeCall(config.getQuestionId) || null;
      analyzeQuestion(text, qid, bodyEl, config);
    });
  }

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("config fn error", e);
      return "";
    }
  }

  function safeGetOptionLetters(config) {
    if (!config || typeof config.getOptionLetters !== "function") return [];
    try {
      const raw = config.getOptionLetters();
      if (!Array.isArray(raw)) return [];
      return raw
        .map((x) => String(x || "").trim().toUpperCase())
        .filter((x) => /^[A-Z]$/.test(x));
    } catch (e) {
      log("getOptionLetters error", e);
      return [];
    }
  }

  function setBodyHtml(bodyEl, html) {
    bodyEl.innerHTML = html;
  }

  function analyzeQuestion(text, questionId, bodyEl, config) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setBodyHtml(
        bodyEl,
        "<em>Could not detect question text. Are you on a Udemy exam question?</em>"
      );
      return;
    }

    if (!chrome?.runtime?.sendMessage) {
      setBodyHtml(bodyEl, "<em>Chrome runtime messaging not available.</em>");
      return;
    }

    setBodyHtml(bodyEl, "<em>Analyzing question with AI…</em>");

    // The call to chrome.runtime.sendMessage can throw if the extension
    // context was invalidated (e.g. extension reloaded while this tab is open).
    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_ANALYZE_QUESTION",
          text: trimmed,
          questionId: questionId || null
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "Unknown error";
            setBodyHtml(
              bodyEl,
              `<em>Extension error: ${escapeHtml(
                msg
              )}</em><br><small>If you just reloaded the extension, reload the Udemy tab and try again.</small>`
            );
            return;
          }

          if (!resp || !resp.ok) {
            const msg =
              resp && resp.error
                ? resp.error
                : "Unknown error from analysis background.";
            setBodyHtml(
              bodyEl,
              `<em>Analysis failed: ${escapeHtml(
                String(msg)
              )}</em><br><small>Check your LLM API key in the extension popup.</small>`
            );
            return;
          }

          const analysis = resp.analysis || {};
          const optionLetters = safeGetOptionLetters(config);
          const html = renderAnalysis(analysis, optionLetters);
          setBodyHtml(bodyEl, html);

          if (questionId) {
            recordQuestionAnalysis(questionId, analysis);
          }
        }
      );
    } catch (err) {
      // This is where "Extension context invalidated." is caught.
      const msg = err && err.message ? err.message : String(err);
      setBodyHtml(
        bodyEl,
        `<em>Extension error: ${escapeHtml(
          msg
        )}</em><br><small>Reload the Udemy page and try again.</small>`
      );
    }
  }

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
        const opt = String(item.option || item.choice || "").trim().toUpperCase();
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

  /**
   * Render the JSON analysis into HTML.
   *
   * Expected fields:
   *  - short_stem: string | string[]
   *  - key_triggers: string[]
   *  - eliminate_rules: object | array
   *  - topic_tags: string[]
   *  - correct_choice: string (e.g. "B")  (single-answer)
   *  - correct_choices: string[] (e.g. ["B","E"]) (multi-answer)
   *  - correct_reason: string
   *
   * @param {Object} analysis
   * @param {string[]} optionLetters  e.g. ['A','B','C','D','E'] from DOM (optional)
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

    // Collect correct choice(s)
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

    // If no array was provided but we have a single correct_choice, use that.
    if (!correctChoices.length && singleChoice) {
      correctChoices = [singleChoice];
    }

    // If still nothing, try to infer a single answer from eliminate_rules
    if (!correctChoices.length) {
      const inferred = inferCorrectChoiceFromEliminateRules(eliminateRules);
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

    // If we have choice(s) but no reason, synthesize a short explanation
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

    // Best answer(s) section
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
          html += `<li><strong>Why:</strong> ${escapeHtml(
            correctReason
          )}</li>`;
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

    // Eliminate rules (why other options are wrong)
    const rulesArray = [];
    if (Array.isArray(eliminateRules)) {
      eliminateRules.forEach((item) => {
        if (!item) return;
        const optRaw = item.option || item.choice || "";
        const opt = String(optRaw || "").trim().toUpperCase();
        const reason = item.reason || item.explanation || "";
        if (!opt || !reason) return;
        if (correctSet.has(opt)) return; // don't show correct options as wrong
        rulesArray.push({ opt, reason });
      });
    } else if (typeof eliminateRules === "object" && eliminateRules !== null) {
      Object.entries(eliminateRules).forEach(([k, v]) => {
        if (!v) return;
        const opt = String(k || "").trim().toUpperCase();
        if (correctSet.has(opt)) return; // skip correct ones
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

    // If we know all option letters from the DOM, check if some wrong options
    // are not covered at all by the model (rare with the new prompt, but possible).
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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Weak-topic stats in chrome.storage.local
  function recordQuestionAnalysis(questionId, analysis) {
    if (!chrome?.storage?.local || !questionId) return;

    const tags = Array.isArray(analysis.topic_tags) ? analysis.topic_tags : [];

    chrome.storage.local.get(["czQuestionStats"], (res) => {
      const stats = res.czQuestionStats || {};
      const key = String(questionId);

      const existing = stats[key] || {
        attempts: 0,
        wrong: 0,
        tags: {},
        lastSeen: 0
      };

      existing.attempts = (existing.attempts || 0) + 1;
      existing.lastSeen = Date.now();

      tags.forEach((t) => {
        const tag = String(t || "").trim();
        if (!tag) return;
        existing.tags[tag] = (existing.tags[tag] || 0) + 1;
      });

      stats[key] = existing;
      chrome.storage.local.set({ czQuestionStats: stats });
    });
  }

  const questionInsight = { mount };

  window.czFeatures = window.czFeatures || {};
  window.czFeatures.questionInsight = questionInsight;
})();
