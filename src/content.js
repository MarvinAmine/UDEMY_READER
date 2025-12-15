// /src/content.js
// Question Insight feature wiring (LLM analysis -> Analysis Panel)

(function () {
  if (!window) return;
  if (!window.czFeatures) window.czFeatures = {};
  if (window.czFeatures.questionInsight) return;

  const log = (window.czCore && window.czCore.log) || (() => {});
  const analysis = window.czEngines && window.czEngines.analysis;
  const analysisPanel =
    window.czUI && window.czUI.analysisPanel;
  const HIGHLIGHT_KEY = "czHighlightEnabled";
  const WHY_KEY = "czWhyEnabled";
  let highlightEnabled = true;
  let whyEnabled = true;
  const analysisCache = new Map(); // Weak keys: analysisRoot -> {analysis, config}

  function clearAllHighlights() {
    const spans = document.querySelectorAll(
      ".cz-key-phrase, .cz-key-phrase-good, .cz-key-phrase-bad"
    );
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent || ""), span);
      parent.normalize();
    });
  }

  function clearAllWhyPills() {
    const pills = document.querySelectorAll(".cz-why-pill, .cz-why-bubble");
    pills.forEach((node) => {
      const parent = node.parentNode;
      if (parent) parent.removeChild(node);
    });
    document
      .querySelectorAll(".cz-answer-why-wrapper")
      .forEach((el) => el.classList.remove("cz-answer-why-wrapper"));
  }

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("QuestionInsight", "config fn error", e);
      return "";
    }
  }

  function setBodyHtml(bodyEl, html) {
    bodyEl.innerHTML = html;
  }

  function setAnalyzedLabel(analysisRoot, hasAnalysis) {
    if (!analysisRoot) return;
    analysisRoot.dataset.czAnalyzed = hasAnalysis ? "1" : "0";
    const btn = analysisRoot.querySelector(
      "button.cz-tts-btn[data-action='analyze-question']"
    );
    if (!btn) return;
    btn.textContent = hasAnalysis
      ? "↻ Re-analyze question"
      : "🧠 Analyze question";
  }

  function setAnalysisCollapsed(analysisRoot, collapsed) {
    if (!analysisRoot) return;
    const isCollapsed = !!collapsed;
    analysisRoot.classList.toggle(
      "cz-tts-analysis-collapsed",
      isCollapsed
    );
    const toggleBtn = analysisRoot.querySelector(
      "button.cz-tts-btn[data-action='toggle-analysis-collapse']"
    );
    if (toggleBtn) {
      toggleBtn.textContent = isCollapsed ? "▸" : "▾";
      toggleBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      toggleBtn.setAttribute(
        "aria-label",
        isCollapsed ? "Expand analysis" : "Collapse analysis"
      );
    }
  }

  function normalizePhraseList(raw, allowShort) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw
        .map((x) => String(x || "").trim())
        .filter((x) => (allowShort ? x.length > 0 : x.length > 1));
    }
    const s = String(raw || "").trim();
    if (!s) return [];
    if (!allowShort && s.length <= 1) return [];
    return [s];
  }

  function escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function clearExistingHighlights(root) {
    if (!root) return;
    const spans = root.querySelectorAll(
      ".cz-key-phrase, .cz-key-phrase-good, .cz-key-phrase-bad"
    );
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent || ""), span);
      parent.normalize();
    });
  }

  function highlightPhrasesInElement(
    root,
    phrases,
    className,
    maxPerPhrase = 3
  ) {
    if (!root || !phrases.length) return false;

    clearExistingHighlights(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const phraseState = phrases.map((p) => ({
      phrase: p,
      phraseLower: p.toLowerCase(),
      len: p.length,
      remaining: maxPerPhrase
    }));

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      if (!phraseState.some((p) => p.remaining > 0)) return;
      const text = node.nodeValue || "";
      if (!text.trim()) return;

      const lower = text.toLowerCase();
      let cursor = 0;
      const parts = [];
      let hasMatch = false;

      while (cursor < text.length) {
        let bestIdx = -1;
        let best = null;

        phraseState.forEach((state) => {
          if (state.remaining <= 0) return;
          const idx = lower.indexOf(state.phraseLower, cursor);
          if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) {
            bestIdx = idx;
            best = state;
          }
        });

        if (bestIdx === -1 || !best) {
          parts.push(document.createTextNode(text.slice(cursor)));
          break;
        }

        if (bestIdx > cursor) {
          parts.push(document.createTextNode(text.slice(cursor, bestIdx)));
        }

        const matched = text.slice(bestIdx, bestIdx + best.len);
        const span = document.createElement("span");
        span.className = className;
        span.textContent = matched;
        parts.push(span);

        cursor = bestIdx + best.len;
        best.remaining -= 1;
        hasMatch = true;
      }

      if (hasMatch && node.parentNode) {
        const frag = document.createDocumentFragment();
        parts.forEach((p) => frag.appendChild(p));
        node.parentNode.replaceChild(frag, node);
      }
    });

    return phraseState.some((p) => p.remaining < maxPerPhrase);
  }

  function applyHighlightsFromAnalysis(analysisJson, config) {
    if (!analysisJson || !config) return;

    const keyPhrases = normalizePhraseList(analysisJson.key_triggers);
    if (!keyPhrases.length) return;

    const promptTargets = [];
    if (typeof config.getPromptElement === "function") {
      const promptEl = safeCall(config.getPromptElement);
      if (promptEl) promptTargets.push(promptEl);
    }

    const answerTargets = [];
    if (typeof config.getAnswerElements === "function") {
      const ans = safeCall(config.getAnswerElements) || [];
      if (Array.isArray(ans)) answerTargets.push(...ans.filter(Boolean));
    }

    // Neutral highlight on prompt
    if (highlightEnabled) {
      promptTargets.forEach((el) => {
        try {
          highlightPhrasesInElement(el, keyPhrases, "cz-key-phrase", 3);
        } catch (e) {
          log("QuestionInsight", "highlight prompt error", e);
        }
      });
    }

    // Answers: color-coded by correctness when available
    if (answerTargets.length) {
      const optionLetters = normalizePhraseList(
        safeCall(config.getOptionLetters),
        true
      );
      const correctChoices = normalizePhraseList(
        analysisJson.correct_choices || analysisJson.correct_choice,
        true
      ).map((c) => c.toUpperCase());
      const correctSet = new Set(correctChoices);
      const haveCorrect = correctSet.size > 0;

      // Build eliminate phrases per option if present
      const eliminateMap = {};
    const eliminateRules = analysisJson.eliminate_rules || {};
    const badPhrasesTop = analysisJson.bad_phrases || {};

      // First, honor top-level bad_phrases map if provided
      if (badPhrasesTop && typeof badPhrasesTop === "object") {
        Object.entries(badPhrasesTop).forEach(([optRaw, arr]) => {
          const opt = String(optRaw || "").trim().toUpperCase();
          if (!opt) return;
          const phrases = normalizePhraseList(arr, true);
          if (phrases.length) {
            eliminateMap[opt] = phrases;
          }
        });
      }

      // Then, fall back to eliminate_rules content if needed
      if (Array.isArray(eliminateRules)) {
        eliminateRules.forEach((item) => {
          if (!item) return;
          const opt = (item.option || item.choice || "")
            .toString()
            .trim()
            .toUpperCase();
          const reason = item.reason || item.explanation || "";
          if (!opt) return;
          if (eliminateMap[opt]?.length) return; // already set from bad_phrases
          const badPhrases =
            normalizePhraseList(item.bad_phrases, true) ||
            normalizePhraseList(reason, true);
          if (badPhrases.length) {
            eliminateMap[opt] = badPhrases;
          }
        });
      } else if (typeof eliminateRules === "object" && eliminateRules !== null) {
        Object.entries(eliminateRules).forEach(([optRaw, reason]) => {
          const opt = String(optRaw || "").trim().toUpperCase();
          if (!opt) return;
          if (eliminateMap[opt]?.length) return;
          let phrases = [];
          if (reason && typeof reason === "object" && reason.bad_phrases) {
            phrases = normalizePhraseList(reason.bad_phrases, true);
          }
          if (!phrases.length && reason) {
            phrases = normalizePhraseList(reason, true);
          }
          if (phrases.length) {
            eliminateMap[opt] = phrases;
          }
        });
      }

      // Highlight answers when enabled
      if (highlightEnabled) {
        answerTargets.forEach((el, idx) => {
          let cls = "cz-key-phrase";
          if (haveCorrect) {
            const letter = (optionLetters[idx] || "").toUpperCase();
            cls = letter && correctSet.has(letter)
              ? "cz-key-phrase-good"
              : "cz-key-phrase-bad";
          }
          const letter = (optionLetters[idx] || "").toUpperCase();
          const phrasesForAnswer =
            cls === "cz-key-phrase-bad" && letter && eliminateMap[letter]
              ? eliminateMap[letter]
              : keyPhrases;
          try {
            highlightPhrasesInElement(el, phrasesForAnswer, cls, 3);
          } catch (e) {
            log("QuestionInsight", "highlight answer error", e);
          }
        });
      }

      if (whyEnabled) {
        // Remove any existing pills before adding new ones
        clearWhyPills(answerTargets);

        // Add "Why?" pills with reasons
        const elimReasons = {};
        if (Array.isArray(eliminateRules)) {
          eliminateRules.forEach((item) => {
            if (!item) return;
            const opt = (item.option || item.choice || "")
              .toString()
              .trim()
              .toUpperCase();
            if (!opt || elimReasons[opt]) return;
            elimReasons[opt] = item.reason || item.explanation || "";
          });
        } else if (
          typeof eliminateRules === "object" &&
          eliminateRules !== null
        ) {
          Object.entries(eliminateRules).forEach(([optRaw, val]) => {
            const opt = String(optRaw || "").trim().toUpperCase();
            if (!opt || elimReasons[opt]) return;
            if (val && typeof val === "object" && val.reason) {
              elimReasons[opt] = val.reason;
            } else {
              elimReasons[opt] = String(val || "");
            }
          });
        }

        const elimMapWithText = {};
        Object.keys(eliminateMap).forEach((k) => {
          const phrases = eliminateMap[k];
          if (phrases && phrases.length) {
            elimMapWithText[k] = phrases;
          } else if (elimReasons[k]) {
            elimMapWithText[k] = [elimReasons[k]];
          }
        });

        addWhyPills(
          answerTargets,
          optionLetters,
          correctSet,
          elimMapWithText,
          elimReasons,
          analysisJson.correct_reason || ""
        );
      } else {
        clearWhyPills(answerTargets);
      }
    }
  }

  function rememberAnalysis(analysisRoot, analysisJson, config) {
    if (!analysisRoot || !analysisJson) return;
    analysisCache.set(analysisRoot, { analysis: analysisJson, config });
  }

  function reapplyAllHighlights() {
    if (!analysisCache.size) return;
    analysisCache.forEach((entry, root) => {
      if (!root || !entry) return;
      try {
        applyHighlightsFromAnalysis(entry.analysis, entry.config);
      } catch (e) {
        log("QuestionInsight", "reapply highlight error", e);
      }
    });
  }

  function refreshHighlightFlag() {
    if (!chrome?.storage?.sync) return;
    chrome.storage.sync.get([HIGHLIGHT_KEY, WHY_KEY], (res) => {
      const hVal = res[HIGHLIGHT_KEY];
      const wVal = res[WHY_KEY];
      highlightEnabled = hVal === undefined ? true : !!hVal;
      const prevWhy = whyEnabled;
      whyEnabled = wVal === undefined ? true : !!wVal;
      if (!highlightEnabled) {
        clearAllHighlights();
      }
      if (!whyEnabled) {
        clearAllWhyPills();
      }
      reapplyAllHighlights(); // reapply highlights and/or pills as permitted
    });
  }

  function checkIfFirstAnalysis(questionId, cb) {
    if (!questionId || !chrome?.storage?.local) {
      cb && cb(false);
      return;
    }

    try {
      chrome.storage.local.get(["czQuestionMeta"], (res) => {
        const meta = res.czQuestionMeta || {};
        const entry = meta[String(questionId)];
        const isFirst =
          !entry || !entry.lastAnalysisAt || entry.lastAnalysisAt === 0;
        cb && cb(isFirst);
      });
    } catch (e) {
      cb && cb(false);
    }
  }

  function insertFirstAnalysisDisclaimer(bodyEl) {
    if (!bodyEl) return;
    if (bodyEl.querySelector(".cz-tts-analysis-disclaimer")) return;
    const note = document.createElement("div");
    note.className = "cz-tts-analysis-disclaimer";
    note.textContent =
      "LLM answers can be wrong. Always re-verify responses first.";
    bodyEl.appendChild(note);
  }

  function analyzeQuestion(
    text,
    questionId,
    bodyEl,
    config,
    analysisRoot
  ) {
    const trimmed = (text || "").trim();
    const explanationText = safeCall(config.getExplanationText);
    const combinedText =
      explanationText && String(explanationText).trim().length
        ? trimmed +
          "\n\nOfficial explanation:\n" +
          String(explanationText).trim()
        : trimmed;
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

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_ANALYZE_QUESTION",
          text: combinedText,
          questionId: questionId || null
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            const msg =
              chrome.runtime.lastError.message || "Unknown error";
            const escapeHtml =
              analysis && analysis.escapeHtml
                ? analysis.escapeHtml
                : (x) => String(x);
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
            const escapeHtml =
              analysis && analysis.escapeHtml
                ? analysis.escapeHtml
                : (x) => String(x);
            setBodyHtml(
              bodyEl,
              `<em>Analysis failed: ${escapeHtml(
                String(msg)
              )}</em><br><small>Check your LLM API key in the extension popup.</small>`
            );
            return;
          }

          const anay = resp.analysis || {};
          if (analysisRoot) {
            setAnalyzedLabel(analysisRoot, true);
          }
          if (analysisPanel && analysisPanel.applyAnalysisToBody) {
            analysisPanel.applyAnalysisToBody(bodyEl, anay, config);
          }
          if (analysisRoot) {
            rememberAnalysis(analysisRoot, anay, config);
          }

          checkIfFirstAnalysis(questionId, (isFirst) => {
            if (isFirst) {
              insertFirstAnalysisDisclaimer(bodyEl);
            }
          });
        applyHighlightsFromAnalysis(anay, config);

          // CU1-A: persist question metadata + stats when we have an ID
          if (analysisPanel && analysisPanel.recordQuestionAnalysis) {
            const mode =
              config && config.mode
                ? String(config.mode)
                : "unknown";

            const extras = {
              mode,
              fullText: trimmed,
              source: "analysis"
            };

            if (questionId) {
              analysisPanel.recordQuestionAnalysis(
                questionId,
                anay,
                extras
              );
            }
          }
        }
      );
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const escapeHtml =
        analysis && analysis.escapeHtml
          ? analysis.escapeHtml
          : (x) => String(x);
      setBodyHtml(
        bodyEl,
        `<em>Extension error: ${escapeHtml(
          msg
        )}</em><br><small>Reload the Udemy page and try again.</small>`
      );
    }
  }

  function mount(analysisRoot, config) {
    if (!analysisRoot || !config) return;

    const bodyEl = analysisRoot.querySelector(".cz-tts-analysis-body");
    if (!bodyEl) return;

    // Initialize label based on prior state if any
    setAnalyzedLabel(analysisRoot, analysisRoot.dataset.czAnalyzed === "1");
    setAnalysisCollapsed(
      analysisRoot,
      analysisRoot.classList.contains("cz-tts-analysis-collapsed")
    );

    analysisRoot.addEventListener("click", (evt) => {
      const collapseBtn = evt.target.closest(
        "button.cz-tts-btn[data-action='toggle-analysis-collapse']"
      );
      if (collapseBtn) {
        const shouldCollapse = !analysisRoot.classList.contains(
          "cz-tts-analysis-collapsed"
        );
        setAnalysisCollapsed(analysisRoot, shouldCollapse);
        return;
      }

      const btn = evt.target.closest(
        "button.cz-tts-btn[data-action='analyze-question']"
      );
      if (!btn) return;
      setAnalysisCollapsed(analysisRoot, false);

      const text = safeCall(config.getQuestionText);
      const qid = safeCall(config.getQuestionId) || null;
      analyzeQuestion(text, qid, bodyEl, config, analysisRoot);
    });
  }

  const questionInsight = {
    mount,
    applyAnalysisToBody:
      analysisPanel && analysisPanel.applyAnalysisToBody
        ? analysisPanel.applyAnalysisToBody
        : function () {},
    markAnalyzed: setAnalyzedLabel,
    applyHighlightsFromAnalysis,
    rememberAnalysis
  };

  window.czFeatures.questionInsight = questionInsight;
  refreshHighlightFlag();
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const hasHighlight = Object.prototype.hasOwnProperty.call(
        changes,
        HIGHLIGHT_KEY
      );
      const hasWhy = Object.prototype.hasOwnProperty.call(changes, WHY_KEY);

      if (hasHighlight) {
        const val = changes[HIGHLIGHT_KEY].newValue;
        highlightEnabled = val === undefined ? true : !!val;
        if (!highlightEnabled) {
          clearAllHighlights();
        }
      }

      if (hasWhy) {
        const val = changes[WHY_KEY].newValue;
        const prev = whyEnabled;
        whyEnabled = val === undefined ? true : !!val;
        if (!whyEnabled) {
          clearAllWhyPills();
        }
      }

      if (hasHighlight || hasWhy) {
        reapplyAllHighlights(); // rebuild whatever is allowed
      }
    });
  }
})();
  function clearWhyPills(answerTargets) {
    (answerTargets || []).forEach((el) => {
      if (!el) return;
      el.classList.remove("cz-answer-why-wrapper");
      const pills = el.querySelectorAll(".cz-why-pill, .cz-why-bubble");
      pills.forEach((node) => node.remove());
    });
  }

  function addWhyPills(
    answerTargets,
    optionLetters,
    correctSet,
    eliminateMap,
    elimReasons,
    correctReason
  ) {
    if (!answerTargets || !answerTargets.length) return;

    answerTargets.forEach((el, idx) => {
      if (!el) return;
      const letter = (optionLetters[idx] || "").toUpperCase();
      const isCorrect = letter && correctSet.has(letter);
      const rawReason = isCorrect
        ? correctReason || ""
        : (letter && elimReasons[letter]) || "";
      const whyText = rawReason ||
        (letter &&
          eliminateMap[letter] &&
          eliminateMap[letter].filter(Boolean).join("; ")) ||
        "";
      if (!whyText) return;

      el.classList.add("cz-answer-why-wrapper");
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "cz-why-pill";
      pill.textContent = "Why?";

      const bubble = document.createElement("div");
      bubble.className = "cz-why-bubble";
      bubble.textContent = whyText;

      pill.addEventListener("click", () => {
        const isVisible = bubble.classList.contains("cz-why-visible");
        bubble.classList.toggle("cz-why-visible", !isVisible);
      });

      el.appendChild(pill);
      el.appendChild(bubble);
    });
  }
