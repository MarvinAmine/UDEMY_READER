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
      "You are an AWS certification exam coach. " +
      "The user will send you a multiple-choice question (stem + options). " +
      "You must respond with a single JSON object only, no extra text. " +
      "Fields: " +
      "short_stem (array of 1-3 bullet strings summarizing the scenario), " +
      "key_triggers (array of 2-4 short phrases from the stem that determine the correct answer), " +
      "eliminate_rules (either an object mapping option letters to reasons, or an array of {option, reason}), " +
      "topic_tags (array of 2-6 tags like ['VPC endpoints','NAT gateway','S3 access']), " +
      "correct_choice (the single best option letter, for example 'A' or 'C'), " +
      "correct_reason (1-3 short sentences explaining why that option is correct). " +
      "If you are unsure, choose the most defensible answer and state your reasoning in correct_reason. " +
      "Focus on clarity and correctness. Temperature should be low. Do not include explanations outside the JSON.";

    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Analyze this AWS exam question. Return only JSON as described:\n\n" +
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
