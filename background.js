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
      "Fields:\n" +
      "  - short_stem: array of 1-3 bullet strings summarizing the scenario.\n" +
      "  - key_triggers: array of 2-4 short phrases from the stem that determine the correct answer.\n" +
      "  - eliminate_rules: an OBJECT mapping option letters (e.g. 'A','B','C') to short explanations. " +
      "    Include EVERY option letter that appears in the question (A, B, C, etc.), including correct ones. " +
      "    For each option, say clearly whether it is correct or incorrect and why.\n" +
      "  - topic_tags: array of 2-6 tags like ['VPC endpoints','NAT gateway','S3 access'].\n" +
      "  - correct_choice: for SINGLE-answer questions, the single best option letter, for example 'A' or 'C'. " +
      "    If the question expects multiple correct answers (e.g. it says 'Select TWO', 'Select TWO answers', " +
      "    'Select all that apply', etc.), then set correct_choice to null and use correct_choices instead.\n" +
      "  - correct_choices: for MULTI-ANSWER questions, an array of all correct option letters, e.g. ['B','E']. " +
      "    For single-answer questions, you may omit this field or use an empty array.\n" +
      "  - correct_reason: 1-3 short sentences explaining why the chosen option (or set of options) is correct.\n" +
      "\n" +
      "If the question clearly asks for multiple answers (for example, 'Select TWO', 'Select TWO options', " +
      "'Select all that apply', 'Choose TWO'), treat it as a multi-answer question and use correct_choices. " +
      "Otherwise, treat it as a single-answer question and use correct_choice.\n" +
      "\n" +
      "eliminate_rules MUST have one entry for every option letter that appears in the question. " +
      "Do not omit any options. For correct options, explain that they are correct. " +
      "For incorrect options, explain briefly why they are wrong or less suitable.\n" +
      "\n" +
      "Return ONLY JSON as described, no additional commentary or text outside the JSON.";

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
      temperature: 0,
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

    sendResponse({ ok: true, analysis: parsed });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}
