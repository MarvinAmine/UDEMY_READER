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

  function getExplanationElementPractice() {
    const selectors = [
      "#overall-explanation",
      '[data-purpose="overall-explanation"]',
      ".question-explanation--container--",
      ".question-explanation--question-explanation--"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
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

  // UC6 – Explanation compression (Summarize pill)
  function attachExplanationSummarizer(form, targetEl) {
    const expl = getExplanationElementPractice();
    if (!expl || expl.dataset.czExplainMounted === "1") return;

    const stemText = extractPracticeQuestionText() || "";
    const optionLetters = getOptionLettersPractice();
    const answerEls = getAnswerElementsPractice();
    const choices = answerEls.map((el, idx) => ({
      label:
        optionLetters[idx] ||
        String.fromCharCode("A".charCodeAt(0) + idx),
      text: (el && el.innerText) || ""
    }));

    const context = {
      questionId: getQuestionIdPractice(form) || null,
      stemText,
      choices,
      chosenIndices: [],
      correctIndices: [],
      explanationText: expl.innerText || "",
      confidence: getCurrentConfidence(form),
      conceptIds: []
    };

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function renderMdBold(str) {
      // Escape everything, then allow markdown-style **bold**.
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
      let userWrong = s.user_choice_summary || "";
      if (/no answer was selected/i.test(userWrong)) {
        userWrong = "";
      }
      if (!userWrong) {
        userWrong = "We couldn't capture your selection.";
      }

      bubble.innerHTML =
        renderLine("Why your choice was wrong:", userWrong) +
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

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;
    if (analysisRoot) {
      analysisRoot.dataset.czAnalyzed = "0";
      const analyzeBtn = analysisRoot.querySelector(
        "button.cz-tts-btn[data-action='analyze-question']"
      );
      if (analyzeBtn) {
        analyzeBtn.textContent = "🧠 Analyze question";
      }
      if (insightFeature && typeof insightFeature.markAnalyzed === "function") {
        insightFeature.markAnalyzed(analysisRoot, false);
      }
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
            insightFeature.rememberAnalysis(
              analysisRoot,
              resp.analysis,
              insightConfig
            );
            if (
              analysisRoot &&
              typeof insightFeature.markAnalyzed === "function"
            ) {
              insightFeature.markAnalyzed(analysisRoot, true);
            }
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
      const qid = wrapper.dataset.czQuestionId;
      if (qid) return String(qid);
      const existing = wrapper.dataset.czConfidenceCacheKey;
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
      ["czQuestionAttempts", "czQuestionStats", "czRevisionQueue"],
      (res) => {
        const questionAttempts = res.czQuestionAttempts || {};
        const questionStats = res.czQuestionStats || {};
        let revisionQueue = res.czRevisionQueue || {};

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

        const rqHelper = window.czCore && window.czCore.revisionQueue;
        if (
          rqHelper &&
          typeof rqHelper.applyAttempt === "function" &&
          rqHelper.shouldQueueAttempt &&
          rqHelper.shouldQueueAttempt(attempt)
        ) {
          try {
            revisionQueue = rqHelper.applyAttempt(revisionQueue, attempt);
          } catch (e) {
            log("revisionQueue.applyAttempt error", e);
          }
        }

        chrome.storage.local.set(
          {
            czQuestionAttempts: questionAttempts,
            czQuestionStats: updatedStats,
            czRevisionQueue: revisionQueue
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
        <div class="cz-tts-confidence-row">
          <button type="button" class="cz-tts-btn cz-tts-confidence-btn" data-confidence="guess" aria-pressed="false">
            Guess
          </button>
          <button type="button" class="cz-tts-btn cz-tts-confidence-btn" data-confidence="unsure" aria-pressed="false">
            Unsure
          </button>
          <button type="button" class="cz-tts-btn cz-tts-confidence-btn" data-confidence="sure" aria-pressed="false">
            Sure
          </button>
          <div class="cz-explain-container"></div>
          <button type="button" class="cz-tts-btn cz-tts-collapse-toggle" data-action="toggle-collapse">▾ Hide all</button>
        </div>
        <div class="cz-tts-analysis">
          <div class="cz-tts-analysis-header">
            <span class="cz-tts-analysis-title">Question Insight</span>
            <div class="cz-tts-analysis-actions">
              <button type="button" class="cz-tts-btn" data-action="analyze-question">🧠 Analyze question</button>
              <button type="button" class="cz-tts-btn" data-action="toggle-analysis-collapse" aria-expanded="true" aria-label="Collapse analysis">▾</button>
            </div>
          </div>
          <div class="cz-tts-analysis-body">
            Click “Analyze question” to see a simplified stem, key triggers, and topic tags.
          </div>
        </div>
        <div class="cz-tts-toolbar">
          <button type="button" class="cz-tts-btn" data-action="play-question">▶ Play Q + answers</button>
          <button type="button" class="cz-tts-btn" data-action="play-selection">▶ Play selection</button>
          <button type="button" class="cz-tts-btn" data-action="stop" disabled>⏹ Stop</button>
        </div>
        <div class="cz-tts-status">
          Ready. Use “Play Q + answers” or select some text and use “Play selection”.
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
        wrapper.dataset.czConfidenceCacheKey = currentId;
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

    const explainTarget = wrapper.querySelector(".cz-explain-container");
    attachExplanationSummarizer(form, explainTarget || null);
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
