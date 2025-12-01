// background.js
// Service worker for LLM analysis (Exam Copilot)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "CZ_ANALYZE_QUESTION") {
    handleAnalyzeQuestion(msg, sendResponse);
    return true; // keep message channel open for async response
  }
});

async function handleAnalyzeQuestion(msg, sendResponse) {
  try {
    const text = (msg.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "EMPTY_TEXT" });
      return;
    }

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
      "topic_tags (array of 2-6 tags like ['VPC endpoints','NAT gateway','S3 access']). " +
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
    const content =
      data?.choices?.[0]?.message?.content ||
      "{}";

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

    sendResponse({ ok: true, analysis: parsed });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}
