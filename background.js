// background.js
// Service worker for LLM analysis (Exam Copilot)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "CZ_ANALYZE_QUESTION") {
    handleAnalyzeQuestion(msg, sendResponse);
    return true; // keep message channel open for async response
  }

  if (msg.type === "CZ_GET_CACHED_ANALYSIS") {
    handleGetCachedAnalysis(msg, sendResponse);
    return true;
  }

  if (msg.type === "CZ_EXPLAIN_HIGHLIGHT") {
    handleExplainHighlight(msg, sendResponse);
    return true;
  }
});

async function handleAnalyzeQuestion(msg, sendResponse) {
  try {
    const text = (msg.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "EMPTY_TEXT" });
      return;
    }

    const questionId = msg.questionId ? String(msg.questionId) : null;

    // Build cache keys:
    //  - Prefer a stable questionId when provided by the content script
    //  - Always also use the canonical text key
    const cacheKeys = [];
    if (questionId) cacheKeys.push("qid:" + questionId);
    cacheKeys.push("text:" + text);

    // 1) Try cache first (chrome.storage.local)
    let cache = {};
    if (chrome?.storage?.local) {
      try {
        const cacheRes = await new Promise((resolve) => {
          chrome.storage.local.get(["czQuestionCache"], resolve);
        });
        cache = cacheRes.czQuestionCache || {};
      } catch (e) {
        // Cache problems shouldn't break the feature; just log and continue.
        console.warn("[UdemyReader][Background] Cache read error:", e);
      }
    }

    let cachedEntry = null;
    for (const key of cacheKeys) {
      const entry = cache[key];
      if (entry && entry.analysis) {
        cachedEntry = entry;
        break;
      }
    }

    if (cachedEntry) {
      // Immediate return from cache
      sendResponse({
        ok: true,
        analysis: cachedEntry.analysis,
        cached: true
      });
      return;
    }

    // 2) No cache hit → call LLM
    const cfg = await new Promise((resolve) => {
      chrome.storage.sync.get(["czLlmApiKey", "czLlmModel"], resolve);
    });

    const apiKey = (cfg.czLlmApiKey || "").trim();
    const model = (cfg.czLlmModel || "gpt-4o-mini").trim();

    if (!apiKey) {
      sendResponse({ ok: false, error: "No LLM API key configured." });
      return;
    }

    const systemPrompt =
      "You are an AWS certification exam coach. The user will send you a multiple-choice question (stem + options). " +
      "Respond with a single JSON object only, no extra text. Fields: " +
      "short_stem (array of 1-3 bullet strings summarizing the scenario), " +
      "key_triggers (array of 3-5 exact keywords or very short 1-3 word snippets copied verbatim from the question or answers that capture the core ask—actors, constraints, and goal; at least one must appear in a correct option; avoid full sentences, do NOT paraphrase), " +
      "eliminate_rules (object mapping option letters to reasons; keep reasons concise), " +
      "bad_phrases (object mapping option letters to an array of 1-4 exact phrases copied from that option/stem that justify eliminating it; do NOT paraphrase), " +
      "topic_tags (array of 2-6 tags like ['VPC endpoints','NAT gateway','S3 access']), " +
      "correct_choices (array of 1..4 option letters), " +
      "correct_choice (the single best option letter OR the first element of correct_choices), " +
      "correct_reason (1-3 short sentences explaining why the option(s) are correct). " +
      "IMPORTANT: If the question is multi-select (e.g., says 'Select TWO', 'Choose 3', 'Select all that apply'), return ALL correct options in correct_choices (do not collapse to one). " +
      "Never invent extra fields. Temperature low. Return JSON only.";

    const isMulti = /select\s+(all|both|two|three|four|five|[0-9]+)/i.test(text) ||
      /choose\s+(all|both|two|three|four|five|[0-9]+)/i.test(text) ||
      /select\s+the\s+two/i.test(text) ||
      /select\s+the\s+three/i.test(text);

    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Analyze this AWS exam question. Return only JSON as described." +
            (isMulti
              ? " This appears to be MULTI-SELECT; return ALL correct options in correct_choices."
              : "") +
            "\n\n" +
            text
        }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      sendResponse({
        ok: false,
        error: "HTTP " + resp.status + " " + resp.statusText + " – " + txt
      });
      return;
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      sendResponse({
        ok: false,
        error: "LLM did not return valid JSON.",
        raw: content
      });
      return;
    }

    // 3) Store in cache for future calls under all relevant keys
    if (chrome?.storage?.local) {
      try {
        // Reuse previously loaded cache object to avoid a second read.
        const entry = {
          analysis: parsed,
          createdAt: Date.now()
        };

        cacheKeys.forEach((key) => {
          cache[key] = entry;
        });

        chrome.storage.local.set({ czQuestionCache: cache });
      } catch (e) {
        console.warn("[UdemyReader][Background] Cache write error:", e);
      }
    }

    // 4) Return fresh analysis
    sendResponse({ ok: true, analysis: parsed });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

// Lightweight helper: just check the cache using questionId + text,
// no LLM call. Used by practiceMode/reviewMode to restore previously
// fetched insight when revisiting a question.
async function handleGetCachedAnalysis(msg, sendResponse) {
  try {
    const text = (msg.text || "").trim();
    const questionId = msg.questionId ? String(msg.questionId) : null;

    const cacheKeys = [];
    if (questionId) cacheKeys.push("qid:" + questionId);
    if (text) cacheKeys.push("text:" + text);

    if (!cacheKeys.length) {
      sendResponse({ ok: false, error: "NO_KEY" });
      return;
    }

    let cache = {};
    if (chrome?.storage?.local) {
      try {
        const cacheRes = await new Promise((resolve) => {
          chrome.storage.local.get(["czQuestionCache"], resolve);
        });
        cache = cacheRes.czQuestionCache || {};
      } catch (e) {
        console.warn("[UdemyReader][Background] Cache read error:", e);
      }
    }

    for (const key of cacheKeys) {
      const entry = cache[key];
      if (entry && entry.analysis) {
        sendResponse({
          ok: true,
          analysis: entry.analysis,
          cached: true,
          key
        });
        return;
      }
    }

    sendResponse({ ok: false, notFound: true });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function generateUuid() {
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  }

async function handleExplainHighlight(msg, sendResponse) {
  try {
    const highlighted = (msg.highlightedText || "").trim();
    const context = (msg.contextText || "").trim();

    if (!highlighted || highlighted.length < 2) {
      sendResponse({ ok: false, error: "EMPTY_SELECTION" });
      return;
    }

    if (!context) {
      sendResponse({ ok: false, error: "NO_CONTEXT" });
      return;
    }

    const cfg = await new Promise((resolve) => {
      chrome.storage.sync.get(["czLlmApiKey", "czLlmModel"], resolve);
    });

    const apiKey = (cfg.czLlmApiKey || "").trim();
    const model = (cfg.czLlmModel || "gpt-4o-mini").trim();

    if (!apiKey) {
      // Still log an event stub so user sees something during dev.
      const event = {
        id: generateUuid(),
        questionId: msg.questionId || null,
        attemptId: msg.attemptId || null,
        conceptId: null,
        highlightedText: highlighted,
        mode: msg.mode || "unknown",
        timestamp: Date.now(),
        savedForReview: !!msg.saveForReview,
        url: msg.url || null,
        error: "No LLM API key configured."
      };
      await persistConceptHelpEvent(event);
      console.warn("[UdemyReader][Background][UC3] No API key");
      sendResponse({ ok: false, error: "No LLM API key configured.", event });
      return;
    }

    const prompt =
      "You are an AWS certification coach. The user highlighted a phrase inside an exam question. " +
      "Return ONLY JSON with fields: concept_id, concept_name, short_definition, when_to_use (array), " +
      "when_not_to_use (array), common_confusions (array), sticky_rule. Keep it concise and exam-focused.";

    const body = {
      model,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            "Question context:\n" +
            context +
            "\n\nHighlighted text:\n" +
            highlighted +
            "\n\nRespond with JSON only."
        }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      const error =
        "HTTP " + resp.status + " " + resp.statusText + " – " + txt;
      const event = {
        id: generateUuid(),
        questionId: msg.questionId || null,
        attemptId: msg.attemptId || null,
        conceptId: null,
        highlightedText: highlighted,
        mode: msg.mode || "unknown",
        timestamp: Date.now(),
        savedForReview: !!msg.saveForReview,
        url: msg.url || null,
        error
      };
      await persistConceptHelpEvent(event);
      sendResponse({
        ok: false,
        error,
        event
      });
      return;
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.warn("[UdemyReader][Background][UC3] JSON parse error", content);
      sendResponse({
        ok: false,
        error: "LLM JSON parse error",
        raw: content
      });
      return;
    }

    // Persist ConceptHelpEvent
    const event = {
      id: generateUuid(),
      questionId: msg.questionId || null,
      attemptId: msg.attemptId || null,
      conceptId: parsed.concept_id || null,
      highlightedText: highlighted,
      mode: msg.mode || "unknown",
      timestamp: Date.now(),
      savedForReview: !!msg.saveForReview,
      url: msg.url || null
    };

    await persistConceptHelpEvent(event);

    sendResponse({ ok: true, explanation: parsed, event });
  } catch (err) {
    console.warn("[UdemyReader][Background][UC3] Error", err);
    sendResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

async function persistConceptHelpEvent(event) {
  if (!chrome?.storage?.local) return;
  try {
    const state = await new Promise((resolve) => {
      chrome.storage.local.get(["czConceptHelpEvents"], resolve);
    });
    const events = state.czConceptHelpEvents || [];
    events.push(event);
    chrome.storage.local.set({ czConceptHelpEvents: events });
  } catch (e) {
    console.warn("[UdemyReader][Background] ConceptHelpEvents write error:", e);
  }
}
