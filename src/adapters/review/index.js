// File: /src/adapters/review/index.js
//
// Review mode adapter: mounts Quiz Reader + Question Insight and triggers UC1-B import.
// CU2: mounts the inline confidence strip on the same cz-tts-wrapper, linked by questionId.

(function () {
  if (typeof window === "undefined") return;
  if (!window.czLocations) window.czLocations = {};
  if (window.czLocations.reviewMode) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  const dom =
    (window.czAdapters && window.czAdapters.reviewDom) || {};
  const questionHelpers =
    (window.czAdapters && window.czAdapters.reviewQuestionId) || {};
  const importHelpers =
    (window.czAdapters && window.czAdapters.reviewImport) || {};
  const confidenceInline =
    window.czUI && window.czUI.confidenceInline;

  const REVIEW_BLOCK_SELECTOR =
    dom.REVIEW_BLOCK_SELECTOR ||
    ".result-pane--question-result-pane-wrapper--2bGiz";
  const INLINE_RESULT_SELECTOR =
    dom.INLINE_RESULT_SELECTOR ||
    ".question-result--question-result--LWiOB";

  let hasLoggedImportSkip = false;

  function isReviewPageUrl() {
    const path = window.location.pathname || "";
    return /\/quiz\/\d+\/(result|review)\//.test(path);
  }

  function isInlinePracticeResult() {
    // Practice mode "review-like" panel shown immediately after validation.
    return !!document.querySelector(INLINE_RESULT_SELECTOR);
  }

  function getReviewQuestionId(block) {
    if (questionHelpers.getReviewQuestionId) {
      return questionHelpers.getReviewQuestionId(block);
    }
    return null;
  }

  function getQuestionText(block) {
    if (dom.extractReviewQuestionStemAndAnswers) {
      return dom.extractReviewQuestionStemAndAnswers(block);
    }
    return "";
  }

  function getQuestionTextWithExplanation(block) {
    if (dom.extractReviewExplanation) {
      const expl = dom.extractReviewExplanation(block);
      if (expl && expl.trim()) {
        return getQuestionText(block) + "\n\nExplanation:\n" + expl;
      }
    }
    return getQuestionText(block);
  }

  function getExplanationText(block) {
    if (dom.extractReviewExplanation) {
      return dom.extractReviewExplanation(block) || "";
    }
    return "";
  }

  function getHighlightRoots(block, action) {
    if (dom.getHighlightRootsReview) {
      return dom.getHighlightRootsReview(block, action);
    }
    return [];
  }

  function getOptionLetters(block) {
    if (dom.getOptionLettersReview) {
      return dom.getOptionLettersReview(block);
    }
    return [];
  }

  function getAnswerElements(block) {
    if (!block) return [];
    const answers = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    return Array.from(answers);
  }

  function getExplanationElement(block) {
    if (!block) return null;
    const selectors = [
      "#overall-explanation",
      '[data-purpose="overall-explanation"]',
      ".question-explanation--container--",
      ".question-explanation--question-explanation--"
    ];
    for (const sel of selectors) {
      const el = block.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function deriveAnswerIndices(block, answerEls) {
    const chosen = [];
    const correct = [];

    (answerEls || []).forEach((answerEl, idx) => {
      const pane =
        answerEl.closest("[data-purpose='answer']") ||
        answerEl.closest(".result-pane--answer-result-pane--Niazi") ||
        answerEl.parentElement;
      if (!pane) return;

      const className = pane.className || "";
      if (/answer-result-pane--answer-correct--/i.test(className)) {
        correct.push(idx);
      }

      const userLabel = pane.querySelector(
        "[data-purpose='answer-result-header-user-label']"
      );
      const labelText = (userLabel && userLabel.textContent) || "";
      const isUserSelection =
        /your/i.test(labelText) || /selected/i.test(labelText);
      if (isUserSelection) {
        chosen.push(idx);
      }
    });

    return { chosenIndices: chosen, correctIndices: correct };
  }

  function findPromptEl(block) {
    if (dom.findPromptEl) return dom.findPromptEl(block);
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

  // UC6 – Explanation compression (Summarize pill)
  function attachExplanationSummarizer(block, targetEl) {
    const expl = getExplanationElement(block);
    if (!expl || expl.dataset.czExplainMounted === "1") return;

    const stemText = getQuestionText(block) || "";
    const optionLetters = getOptionLetters(block);
    const answerEls = getAnswerElements(block);
    const { chosenIndices, correctIndices } = deriveAnswerIndices(
      block,
      answerEls
    );
    const choices = answerEls.map((el, idx) => ({
      label:
        optionLetters[idx] ||
        String.fromCharCode("A".charCodeAt(0) + idx),
      text: (el && el.innerText) || ""
    }));

    function computeIsCorrect() {
      if (!chosenIndices.length || !correctIndices.length) return null;
      const chosenSet = new Set(chosenIndices);
      const correctSet = new Set(correctIndices);
      if (chosenSet.size !== correctSet.size) return false;
      for (const v of chosenSet) {
        if (!correctSet.has(v)) return false;
      }
      return true;
    }

    function extractContextAndAsk(text) {
      const EMPTY = { context: "", ask: "" };
      if (!text) return EMPTY;

      const normalized = String(text).replace(/\s+/g, " ").trim();
      if (!normalized) return EMPTY;

      const sentences = normalized
        .split(/(?<=[\.\?\!])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!sentences.length) return EMPTY;

      const questionIdx = sentences.findIndex((s) =>
        /(\?|^which\b|^what\b|^how\b|^select\b|^choose\b|^identify\b)/i.test(s)
      );

      let ask = "";
      let contextStr = "";

      if (questionIdx >= 0) {
        ask = sentences[questionIdx];
        contextStr = sentences
          .filter((_, idx) => idx !== questionIdx)
          .slice(0, 2)
          .join(" ");
      } else {
        // Fallback: last sentence is treated as the ask if it looks imperative.
        const last = sentences[sentences.length - 1] || "";
        const looksLikeAsk = /should|which|what|how|select|choose/i.test(last);
        ask = looksLikeAsk ? last : "";
        contextStr = sentences.slice(0, 2).join(" ");
      }

      return {
        context: contextStr || "",
        ask: ask || ""
      };
    }

    const context = {
      questionId: getReviewQuestionId(block) || null,
      stemText,
      choices,
      chosenIndices,
      correctIndices,
      explanationText: getExplanationText(block) || expl.innerText || "",
      confidence: null,
      conceptIds: []
    };

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function renderMdBold(str) {
      // Escape untrusted text, then re-enable markdown-style **bold**.
      const safe = escapeHtml(str);
      return safe.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    }

    function renderLine(label, text) {
      const lbl = escapeHtml(label);
      const val = renderMdBold(text);
      const spacer = val ? " " : "";
      return `<div class="cz-explain-line"><strong>${lbl}</strong>${spacer}${val}</div>`;
    }

    function shorten(text, max = 140, allowTruncate = true) {
      const t = String(text || "");
      if (!allowTruncate) return t;
      if (t.length <= max) return t;
      return t.slice(0, max - 1).trimEnd() + "…";
    }

    const STOP_WORDS = new Set(
      "the a an and or but for nor with without in on at to of from by as is are was were this that these those you your our their its it's can't couldnt wouldnt shouldn't should have has had do does did be been being if then else when where which what why how who whose whom can could may might must will would should".split(
        " "
      )
    );

    function extractKeyTerms(summary, limit = 8) {
      const s = summary || {};
      const textParts = [
        s.sticky_rule,
        s.correct_choice_summary,
        s.user_choice_summary,
        ...(Array.isArray(s.elimination_clues) ? s.elimination_clues : [])
      ]
        .filter(Boolean)
        .join(" ");

      const tokens = (textParts.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || []).map((t) =>
        t.trim()
      );
      const seen = new Set();
      const freq = [];

      tokens.forEach((tok) => {
        const lower = tok.toLowerCase();
        if (STOP_WORDS.has(lower)) return;
        if (seen.has(lower)) return;
        seen.add(lower);
        freq.push(tok);
      });

      return freq.slice(0, limit);
    }

    function firstTerm(text) {
      const tokens = (String(text || "").match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || []).map((t) =>
        t.trim()
      );
      for (const tok of tokens) {
        if (!STOP_WORDS.has(tok.toLowerCase())) return tok;
      }
      return "";
    }

    function buildSuggestions() {
      // Fallback, used if AI suggestion generation fails; keep generic but varied.
      return [
        "What's the tricky part?",
        "What's a common mistake here?",
        "Give me the quick rule of thumb.",
        "Where do people usually mess this up?",
        "What's the fastest sanity check?",
        "What's the gotcha to watch for?"
      ];
    }

    function buildSummaryCorpus(summary, questionContext) {
      const s = summary || {};
      const parts = [
        s.sticky_rule,
        s.correct_choice_summary,
        s.user_choice_summary,
        ...(Array.isArray(s.elimination_clues) ? s.elimination_clues : []),
        (questionContext && questionContext.stemText) || "",
        JSON.stringify((questionContext && questionContext.choices) || [])
      ];
      const raw = parts.filter(Boolean).join(" ");
      return raw
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function isEcho(candidate, corpus) {
      if (!candidate) return false;
      const norm = String(candidate)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!norm) return false;
      if (norm.length > 6 && corpus.includes(norm)) return true;
      const words = norm.split(" ").filter((w) => w.length > 3);
      if (!words.length) return false;
      const hits = words.filter((w) => corpus.includes(w)).length;
      return hits / words.length >= 0.6;
    }

    function requestAiSuggestions(summary, questionContext, onDone) {
      const s = summary || {};
      const clues = Array.isArray(s.elimination_clues) ? s.elimination_clues : [];
      const corpus = buildSummaryCorpus(summary, questionContext);
      const prompt =
        "Find 3 very short, human questions about the tricky parts students usually miss. " +
        "Do NOT copy wording from the summary. Paraphrase and focus on subtle confusions or gotchas.";
      const context = {
        rule: s.sticky_rule || "",
        correct: s.correct_choice_summary || "",
        wrong: s.user_choice_summary || "",
        clues,
        question: (questionContext && questionContext.stemText) || "",
        choices: (questionContext && questionContext.choices) || []
      };

      if (!chrome?.runtime?.sendMessage) {
        onDone(null);
        return;
      }

      try {
        chrome.runtime.sendMessage(
          {
            type: "CZ_GENERATE_SUGGESTIONS",
            prompt,
            context
          },
          (resp) => {
            if (!resp || !resp.ok || !Array.isArray(resp.suggestions)) {
              onDone(null);
              return;
            }
            const cleaned = resp.suggestions
              .filter(Boolean)
              .map((x) => String(x).trim())
              .filter(Boolean)
              .filter((x) => !isEcho(x, corpus))
              .slice(0, 6);
            onDone(cleaned.length ? cleaned : null);
          }
        );
      } catch (_) {
        onDone(null);
      }
    }

    function requestAiReply(questionText, summary, questionContext, onDone) {
      const s = summary || {};
      const prompt =
        "Answer in up to 3 concise sentences (max ~70 words). If it is a yes/no question, start with Yes or No and then a brief reason. " +
        "Do NOT copy the summary verbatim. Address the question directly. Use the provided context (rule/correct/wrong/clues/question/choices) only to craft a helpful hint or mini-explanation.";
      const payload = {
        type: "CZ_CHAT_REPLY",
        prompt,
        question: questionText || "",
        summary: s,
        context: questionContext || {}
      };

      if (!chrome?.runtime?.sendMessage) {
        onDone(null);
        return;
      }

      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          if (!resp || !resp.ok || !resp.reply) {
            onDone(null);
            return;
          }
          const reply = String(resp.reply || "").trim();
          if (!reply) {
            onDone(null);
            return;
          }
          onDone(reply);
        });
      } catch (_) {
        onDone(null);
      }
    }

    function makeBotReply(question, summary) {
      const s = summary || {};
      const clues = Array.isArray(s.elimination_clues) ? s.elimination_clues : [];
      const q = (question || "").toLowerCase();

      const candidates = [
        ...(clues || []).map((c) => `Pitfall: ${String(c || "")}`),
        s.sticky_rule ? `Rule: ${s.sticky_rule}` : "",
        s.correct_choice_summary ? `Why right: ${s.correct_choice_summary}` : "",
        s.user_choice_summary ? `Why wrong: ${s.user_choice_summary}` : "",
        "Use the rule, then apply the clues."
      ]
        .map((c) => String(c || "").trim())
        .filter(Boolean);

      const pickClue = () => {
        if (!candidates.length) return "Focus on the rule, then apply the clues.";
        const idx =
          (question || "")
            .split("")
            .reduce((a, c) => a + c.charCodeAt(0), 0) % candidates.length;
        return candidates[idx];
      };

      const trapHint = pickClue();

      const ruleLine = s.sticky_rule ? `Rule: ${s.sticky_rule}` : "";
      const clueLine = trapHint ? `Watch out: ${trapHint}` : "";
      const rightLine = s.correct_choice_summary
        ? `Why right: ${s.correct_choice_summary}`
        : "";

      if (/rule|guideline|remember/.test(q)) {
        return [ruleLine || clueLine, rightLine].filter(Boolean).join(" ");
      }
      if (/wrong|eliminate|avoid|trap/.test(q) && pickClue()) {
        return `${clueLine || trapHint} ${rightLine}`.trim();
      }
      if (/right|correct|why/.test(q) && s.correct_choice_summary) {
        return `Key: ${s.correct_choice_summary}`;
      }
      if (/short|summary|takeaway/.test(q)) {
        return (
          ruleLine ||
          rightLine ||
          clueLine ||
          "Focus on the rule and clues; avoid options that violate them."
        );
      }
      const core =
        ruleLine ||
        rightLine ||
        clueLine ||
        "Use the rule, then apply the clues; ignore options that contradict them.";
      return shorten(core, 200);
    }

    function mountChat(bubble, summary, providedSuggestions, questionContext) {
      const chat = document.createElement("div");
      chat.className = "cz-explain-chat";
      let suggestionsQueue =
        providedSuggestions && providedSuggestions.length
          ? [...providedSuggestions]
          : buildSuggestions();

      const takeFromQueue = () => {
        while (suggestionsQueue.length) {
          const cand = suggestionsQueue.shift();
          if (!cand) continue;
          return cand;
        }
        return null;
      };

      function takeNextSuggestion(cb) {
        const local = takeFromQueue();
        if (local) {
          cb(local);
          return;
        }
        requestAiSuggestions(summary, questionContext, (aiSuggestions) => {
          suggestionsQueue =
            (aiSuggestions && aiSuggestions.length && [...aiSuggestions]) ||
            buildSuggestions();
          const fromAi = takeFromQueue();
          cb(fromAi || null);
        });
      }

      const initialButtons = [];
      for (let i = 0; i < 3; i++) {
        const sug = takeFromQueue();
        if (!sug) break;
        initialButtons.push(sug);
      }
      chat.innerHTML =
        `<div class="cz-explain-chat-header">Chat</div>` +
        `<div class="cz-explain-chat-suggestions">` +
        initialButtons
          .map(
            (q) =>
              `<button type="button" class="cz-explain-chat-suggestion" data-question="${escapeHtml(
                q
              )}">${escapeHtml(q)}</button>`
          )
          .join("") +
        `</div>` +
        `<div class="cz-explain-chat-log" aria-live="polite"></div>` +
        `<form class="cz-explain-chat-form">` +
        `<input type="text" name="q" placeholder="Ask in one line" aria-label="Ask a quick question" maxlength="200" />` +
        `<button type="submit">Send</button>` +
        `</form>`;

      const log = chat.querySelector(".cz-explain-chat-log");
      const form = chat.querySelector(".cz-explain-chat-form");
      const input = chat.querySelector('input[name="q"]');

      function addMsg(role, text) {
        const row = document.createElement("div");
        row.className = `cz-explain-chat-msg cz-explain-chat-${role}`;
        row.innerHTML = `<span>${renderMdBold(shorten(text, 420, false))}</span>`;
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
      }

      function handleQuestion(qText) {
        const qClean = (qText || "").trim();
        if (!qClean) return;
        addMsg("user", qClean);
        requestAiReply(qClean, summary, questionContext, (aiReply) => {
          const reply = aiReply || makeBotReply(qClean, summary);
          addMsg("bot", reply);
        });
      }

      form.addEventListener("submit", (evt) => {
        evt.preventDefault();
        const val = input.value;
        input.value = "";
        handleQuestion(val);
      });

      chat.querySelectorAll(".cz-explain-chat-suggestion").forEach((btn) => {
        btn.addEventListener("click", () => {
          const q = btn.dataset.question || "";
          handleQuestion(q);
          takeNextSuggestion((next) => {
            if (next) {
              btn.dataset.question = next;
              btn.textContent = next;
            } else {
              btn.remove();
            }
          });
        });
      });

      bubble.appendChild(chat);
    }

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "cz-explain-pill";
    pill.textContent = "Summarize";

    const bubble = document.createElement("div");
    bubble.className = "cz-explain-bubble-inline";

    function renderSummary(summary) {
      const s = summary || {};
      const clues = Array.isArray(s.elimination_clues)
        ? s.elimination_clues
        : [];
      const isCorrect = computeIsCorrect();
      const { context: ctxText, ask: askText } = extractContextAndAsk(stemText);

      // Derive a friendly user-choice blurb as fallback
      let userChoiceText = "";

      if (chosenIndices.length) {
        const firstIdx = chosenIndices[0];
        const choice = choices[firstIdx];
        if (choice && choice.text) {
          userChoiceText = `You chose ${choice.label || ""}: ${choice.text}`;
        }
      }

      if (
        !userChoiceText &&
        s.user_choice_summary &&
        !/no answer was selected/i.test(s.user_choice_summary)
      ) {
        userChoiceText = s.user_choice_summary;
      }

      if (!userChoiceText) {
        userChoiceText = isCorrect ? "You chose the correct answer." : "We couldn't capture your selection.";
      }

      const userHeading = isCorrect
        ? "Why your choice was right:"
        : "Why your choice was wrong:";

      bubble.innerHTML =
        renderLine("Question context:", ctxText || "Context unavailable.") +
        renderLine("Question asks:", askText || "Could not detect the specific ask.") +
        renderLine(userHeading, userChoiceText) +
        renderLine("Why correct is right:", s.correct_choice_summary || "N/A") +
        `<strong>How to eliminate:</strong><ul>${clues
          .map((c) => `<li>${renderMdBold(String(c))}</li>`)
          .join("")}</ul>` +
        renderLine("Rule:", s.sticky_rule || "N/A");

      requestAiSuggestions(s, context, (aiSuggestions) => {
        mountChat(bubble, s, aiSuggestions || null, context);
      });
    }

    let cachedSummary = null;

    pill.addEventListener("click", () => {
      const visible = bubble.classList.contains("cz-explain-visible");
      if (visible) {
        bubble.classList.remove("cz-explain-visible");
        return;
      }

      if (cachedSummary) {
        renderSummary(cachedSummary);
        bubble.classList.add("cz-explain-visible");
        return;
      }

      bubble.textContent = "Summarizing explanation…";
      bubble.classList.add("cz-explain-visible");
      try {
        chrome.runtime.sendMessage(
          { type: "CZ_COMPRESS_EXPLANATION", context },
          (resp) => {
            if (!resp || !resp.ok || !resp.summary) {
              bubble.textContent =
                (resp && resp.error) ||
                "Could not summarize. Check API key.";
              return;
            }
            cachedSummary = resp.summary;
            renderSummary(cachedSummary);
          }
        );
      } catch (e) {
        bubble.textContent = "Summarize failed.";
      }
    });

    const wrap = targetEl || document.createElement("div");
    if (!targetEl) {
      wrap.className = "cz-explain-container";
    }
    wrap.appendChild(pill);
    wrap.appendChild(bubble);

    expl.dataset.czExplainMounted = "1";
    if (!targetEl && expl.parentElement) {
      expl.parentElement.appendChild(wrap);
    }
  }

  function restoreCachedInsightForBlock(block, wrapper, insightConfig) {
    if (!chrome?.runtime?.sendMessage) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (!analysisBody) return;

    const textRaw = insightConfig.getQuestionText
      ? insightConfig.getQuestionText()
      : "";
    const text = (textRaw || "").trim();
    const questionId = getReviewQuestionId(block) || null;

    if (!text && !questionId) return;

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_GET_CACHED_ANALYSIS",
          text,
          questionId
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
            insightFeature.rememberAnalysis(
              analysisRoot,
              resp.analysis,
              insightConfig
            );
          }
        }
      );
    } catch (e) {
      log("ReviewMode", "restoreCachedInsightForBlock error", e);
    }
  }

  function injectCardForBlock(block, logInjection) {
    if (!block || block.dataset.czTtsInjected === "1") return;

    const promptEl = findPromptEl(block);
    if (!promptEl) return;

    const quizFeature =
      window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature || !insightFeature) {
      log(
        "ReviewMode",
        "Missing feature(s): quiz=",
        !!quizFeature,
        "insight=",
        !!insightFeature
      );
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "cz-tts-wrapper cz-tts-review";
    wrapper.innerHTML =
      '<div class="cz-tts-confidence-row">' +
      '<div class="cz-tts-confidence-root"></div>' +
      '<div class="cz-explain-container"></div>' +
      '<button type="button" class="cz-tts-btn cz-tts-collapse-toggle" data-action="toggle-collapse">' +
      "▾ Hide all" +
      "</button>" +
      "</div>" +
      '<div class="cz-tts-summary-row">' +
      '<div class="cz-tts-confidence-summary"></div>' +
      "</div>" +
      '<div class="cz-tts-analysis">' +
      '<div class="cz-tts-analysis-header">' +
      '<span class="cz-tts-analysis-title">Question Insight</span>' +
      '<div class="cz-tts-analysis-actions">' +
      '<button type="button" class="cz-tts-btn" data-action="analyze-question">' +
      "🧠 Re-analyze question" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="toggle-analysis-collapse" aria-expanded="true" aria-label="Collapse analysis">' +
      "▾" +
      "</button>" +
      "</div>" +
      "</div>" +
      '<div class="cz-tts-analysis-body">' +
      "Click “Analyze question” to see a simplified stem, key triggers, and topic tags." +
      "</div>" +
      "</div>" +
      '<div class="cz-tts-toolbar">' +
      '<button type="button" class="cz-tts-btn" data-action="play-question">' +
      "▶ Play Q + answers" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="play-question-expl">' +
      "▶ Play explanation" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="play-selection">' +
      "▶ Play selection" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="stop" disabled>' +
      "⏹ Stop" +
      "</button>" +
      "</div>" +
      '<div class="cz-tts-status">' +
      'Ready. Use “Play Q + answers” or “Play explanation”, or select text and use “Play selection”.' +
      "</div>";

    promptEl.insertAdjacentElement("afterend", wrapper);
    block.dataset.czTtsInjected = "1";

    const insightConfig = {
      getQuestionText: () => getQuestionText(block),
      getExplanationText: () => getExplanationText(block),
      getQuestionId: () => getReviewQuestionId(block),
      getOptionLetters: () => getOptionLetters(block),
      getPromptElement: () => findPromptEl(block),
      getAnswerElements: () => getAnswerElements(block),
      mode: "review"
    };

    // Store questionId on wrapper for CU2 / stats
    const qid = getReviewQuestionId(block);
    if (qid && wrapper.dataset) {
      wrapper.dataset.czQuestionId = String(qid);
    }

    quizFeature.mount(wrapper, {
      getText: () => getQuestionText(block),
      getTextWithExplanation: () => getQuestionTextWithExplanation(block),
      getHighlightRoots: (action) => getHighlightRoots(block, action)
    });

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (analysisRoot) {
      insightFeature.mount(analysisRoot, insightConfig);
    }

    // CU2 – mount inline confidence (read-only in review mode)
    if (confidenceInline && typeof confidenceInline.mount === "function") {
      confidenceInline.mount(wrapper, {
        getQuestionId: () => getReviewQuestionId(block),
        mode: "review"
      });
    }

    let explainTarget = wrapper.querySelector(".cz-explain-container");
    if (!explainTarget) {
      const pills = wrapper.querySelector(".cz-tts-confidence-pills");
      explainTarget = document.createElement("div");
      explainTarget.className = "cz-explain-container";
      if (pills) {
        pills.appendChild(explainTarget);
      } else {
        const confRoot = wrapper.querySelector(".cz-tts-confidence-root");
        if (confRoot) {
          confRoot.appendChild(explainTarget);
        }
      }
    }

    attachExplanationSummarizer(block, explainTarget || null);

    restoreCachedInsightForBlock(block, wrapper, insightConfig);

    // Move confidence summary into the dedicated summary row, if present.
    const summaryRow = wrapper.querySelector(".cz-tts-summary-row");
    const summaryEl = wrapper.querySelector(
      ".cz-tts-confidence-summary"
    );
    if (summaryRow && summaryEl && summaryEl.parentElement !== summaryRow) {
      summaryRow.appendChild(summaryEl);
    }

    if (logInjection) {
      log(
        "ReviewMode",
        "Injected Quiz Reader + Question Insight into review block"
      );
    }
  }

  function scanAndInjectAll() {
    const inReviewUrl = isReviewPageUrl();
    const inPracticeInline = !inReviewUrl && isInlinePracticeResult();
    if (!inReviewUrl && !inPracticeInline) return;

    let blocks = document.querySelectorAll(REVIEW_BLOCK_SELECTOR);
    if (!blocks.length) {
      blocks = document.querySelectorAll(INLINE_RESULT_SELECTOR);
    }
    if (!blocks.length) return;

    // Only trigger UC1-B import on true review pages.
    if (inReviewUrl && typeof importHelpers.ensureReviewImportOnce === "function") {
      importHelpers.ensureReviewImportOnce();
    } else if (inPracticeInline && !hasLoggedImportSkip) {
      hasLoggedImportSkip = true;
    }

    blocks.forEach((block) => injectCardForBlock(block, inReviewUrl));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanAndInjectAll);
  } else {
    scanAndInjectAll();
  }

  const observer = new MutationObserver(() => {
    scanAndInjectAll();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  window.czLocations.reviewMode = {
    rescan: scanAndInjectAll
  };
})();
