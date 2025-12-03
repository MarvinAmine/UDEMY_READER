## Glossary (shared across all use cases)

**Environment**

* Browser: Chrome (or Chromium-based).
* Context: Udemy practice exams / quizzes.
* Components:

  * **Content script**: runs on `udemy.com`, reads DOM, injects UI.
  * **Background / service worker**: storage, API calls if needed.
  * **Popup / dashboard**: for “Review” and “Weakness overview”.

**Core data models (high-level)**

```ts
type QuestionAttempt = {
  id: string;                  // stable id per question (e.g. Udemy question-id + course-id)
  timestamp: number;           // when attempt was made (ms)
  rawQuestionHtml: string;     // original HTML of question stem
  rawAnswersHtml: string[];    // original HTML of each answer
  questionText: string;        // plain text stem
  answerOptions: string[];     // A, B, C, D text
  correctIndex: number | null; // if known from Udemy review
  chosenIndex: number | null;  // what user picked
  isCorrect: boolean | null;

  timeToAnswerMs: number;      // duration from load to submit (best-effort)

  confidence: "sure" | "unsure" | "guess" | null;
  confusionType: "confused-options" | "didnt-understand-stem" | "dont-know-service" | "other" | null;
  confusedPairIndices?: [number, number];  // e.g. [0,2] = confused A and C

  starred: boolean;            // “I want to master this one”

  llmAnalysis?: LlmAnalysis;
};

type LlmAnalysis = {
  area: string;                // e.g. "Networking", "Storage", "Security"
  services: string[];          // e.g. ["S3", "VPC Endpoint", "NAT Gateway"]
  scenario: string;            // short id, e.g. "private-subnets-need-outbound-access"
  decisionAxis: string;        // e.g. "internet_vs_private_access"
  simplifiedStem: string[];    // array of 1–3 bullet points
  keyTriggers: string[];       // decisive keywords/phrases
  wrongWhy: string | null;     // why the chosen option is wrong
  correctWhy: string | null;   // why the correct option is right
  stickyRule: string | null;   // 1-line rule to remember
};

type PatternSummary = {
  patternId: string;           // `${area}::${scenario}::${decisionAxis}`
  area: string;
  scenario: string;
  decisionAxis: string;

  questionCount: number;
  wrongCount: number;
  lowConfidenceCount: number;  // unsure + guess
  lastSeenAt: number;

  stickyRule: string | null;   // most recent / best rule
};
```

---

## UC1 – Detect & Parse Question on Udemy

**Goal**
Detect when a new Udemy question is shown and extract its content into a normalized `QuestionAttempt` skeleton.

**Trigger**

* Udemy loads / changes question content (e.g. Next/Previous question, new page load).

**Preconditions**

* Content script is active on a Udemy quiz URL.
* User has granted basic extension permissions.

**Main Flow**

1. Content script observes DOM (MutationObserver) for:

   * `form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]`.
2. When a new question form appears:

   1. Grab:

      * `data-question-id` from the form.
      * `question-prompt` HTML (`#question-prompt`).
      * All `.mc-quiz-answer--answer-body--V-o8d` HTMLs.
   2. Normalize the text:

      * `questionText = innerText(question-prompt)` trimmed & normalized.
      * `answerOptions = innerText` of each answer.
   3. Create a **temporary** `QuestionAttempt` with:

      * Generated `id` (e.g. `${courseId}:${questionId}` if course id is available, or fallback).
      * `timestamp = Date.now()`
      * `rawQuestionHtml`, `rawAnswersHtml[]`, `questionText`, `answerOptions[]`.
      * `correctIndex = null`, `chosenIndex = null`, `isCorrect = null`.
      * `timeToAnswerMs = 0` (to be updated later).
      * `confidence = null`, `confusionType = null`, etc.
   4. Store this temporary attempt in memory (content script) and/or background storage.
   5. Start a timer for `timeToAnswerMs` (record `startTime`).

**Postconditions**

* Current question is known and tracked as an object, ready to be updated when user answers.
* No UI is shown yet beyond your existing “Quiz Reader” bar.

---

## UC2 – Capture Answer Submission + Time

**Goal**
Record which answer the user chose, whether it was correct (if visible), and how long it took.

**Trigger**

* User clicks “Check” / “Submit” / next-question button on Udemy (depends on Udemy exam type).

**Preconditions**

* UC1 has created a `QuestionAttempt` for the current question.
* `startTime` is known.

**Main Flow (minimal version)**

1. Content script hooks into:

   * Clicks on “Check answer”, “Next”, or quiz navigation buttons, or
   * Form submission events for the question form.
2. On submit:

   1. Inspect which radio input is selected:

      * `input[name="answer"][data-index="X"]`.
   2. Set `chosenIndex` to the selected option index.
   3. Compute `timeToAnswerMs = Date.now() - startTime`.
   4. If Udemy UI reveals correct answer (e.g., after pressing “Check”):

      * Detect which answer is marked as correct (by CSS class or aria attribute).
      * Set `correctIndex` and `isCorrect`.
3. Persist this updated `QuestionAttempt` to extension storage (e.g. `chrome.storage.local`).

**Alternatives**

* If correct answer is not visible in real-time:

  * Only store `chosenIndex` and `timeToAnswerMs`.
  * `isCorrect` and `correctIndex` will be filled later in **UC6** (during explanation/review screen).

**Postconditions**

* A complete base record exists for the attempt: choice + timing.

---

## UC3 – Capture Confidence & Confusion Type

**Goal**
Let the user explicitly tell the system how confident they were and what made the question hard, with minimal friction.

**Trigger**

* After answer submission (UC2), when the result is visible or immediately after click.

**Preconditions**

* `QuestionAttempt` has `chosenIndex` set.

**Main Flow**

1. Content script injects a **small inline widget** under the question (or near your “Quiz Reader” bar):

   * “How did this question feel?”

     * Radio buttons or pill buttons:

       * “✅ I was sure”
       * “🤔 I was unsure”
       * “🎯 I guessed”
   * Optional second question (only if user clicks “more” or if they were wrong/unsure/guess):

     * “What made it hard?”

       * “☐ I confused two answers”
       * “☐ I didn’t understand part of the question”
       * “☐ I don’t know this service well”
       * “☐ Other”

2. If user selects “I confused two answers”:

   * Show the 4 answers as clickable chips (A, B, C, D).
   * Let the user select exactly 2.
   * Store their indices as `confusedPairIndices`.

3. Update and persist `QuestionAttempt` with:

   * `confidence`, `confusionType`, `confusedPairIndices?`.

**Postconditions**

* You now have explicit human signals about confusion, not just correctness.

---

## UC4 – Star / Mark Question for Deeper Review

**Goal**
Let the user explicitly say “I want to master this one later”.

**Trigger**

* Any time after the question is shown (before or after answer).

**Preconditions**

* UC1 has identified current question and stored `QuestionAttempt`.

**Main Flow**

1. Content script adds a star button: `⭐ Master this question later`.
2. If clicked:

   * Toggle `starred = true` for that attempt.
   * If clicked again, set `starred = false`.
3. Persist update.

**Postconditions**

* Question is flagged for priority in review sessions and pattern detection.

---

## UC5 – On-the-Fly Stem Simplification & Keyword Highlight (During Exam)

**Goal**
Simplify the question stem and visually highlight decisive keywords **while** the student is answering.

**Trigger**

* User clicks a “Simplify question” button next to the question, or the extension auto-runs for every question (configurable).

**Preconditions**

* `QuestionAttempt.questionText` and `answerOptions` are already captured.
* LLM API is available (backend or direct).

**Main Flow**

1. Content script sends a request to background (or directly to API) with:

   * `questionText`, `answerOptions[]`.
2. Background calls LLM with a strict JSON prompt that returns an `LlmAnalysis` object, especially:

   * `simplifiedStem` (1–3 bullets),
   * `keyTriggers[]`,
   * `area`, `services[]`, `scenario`, `decisionAxis`.
3. Content script:

   * Displays `simplifiedStem` above or below the question in a small box.
   * Highlights `keyTriggers` inside the original stem using `<mark>` or `span.cz-aws-keyword`.
4. Store `llmAnalysis` in `QuestionAttempt.llmAnalysis`.

**Postconditions**

* User sees:

  * A short version of the question.
  * Visual emphasis on the few words that matter.

---

## UC6 – Post-Question Explanation Compression & Rule Extraction

**Goal**
When the user reviews answers, compress the explanation into a short “why you were wrong” and a **sticky rule**, connected to a pattern.

**Trigger**

* Udemy shows the explanation after submitting (review screen).
* Or user opens a dedicated “Review last test” view in the popup/dashboard.

**Preconditions**

* `QuestionAttempt` exists with `chosenIndex`, possibly `isCorrect`.
* Raw explanation text is available in the DOM (or not; then skip that part).

**Main Flow**

1. When the explanation is visible, content script:

   * Scrapes explanation text (if available).
   * Sends to background/LLM:

     * `questionText`
     * `answerOptions`, `correctIndex`, `chosenIndex`
     * explanation (if any)
     * previous `llmAnalysis` (if UC5 already ran) to reuse.

2. LLM returns updated `LlmAnalysis` with at least:

   * `area`, `services[]`, `scenario`, `decisionAxis`
   * `simplifiedStem` (if not already present)
   * `keyTriggers[]`
   * `wrongWhy` and `correctWhy`
   * `stickyRule` → a single memorable rule, e.g.

     > “If private subnets need *only S3*, use VPC endpoint, not NAT gateway.”

3. Content script:

   * Shows a compact block under the explanation with:

     * “Why your choice is wrong”
     * “Why correct answer is right”
     * The **sticky rule** in bold.

4. Persist updated `llmAnalysis` into `QuestionAttempt`.

**Postconditions**

* Every “reviewed” question now has a compact cognitive summary and 1 key rule.

---

## UC7 – Build & Update Weakness Patterns

**Goal**
Aggregate individual attempts into higher-level patterns like “private access to AWS services” or “SQS vs SNS vs EventBridge”.

**Trigger**

* After each question analysis (UC6), or periodically when user opens the dashboard.

**Preconditions**

* Several `QuestionAttempt` entries exist with populated `llmAnalysis` and correctness.

**Main Flow**

1. Background script iterates over stored `QuestionAttempt`s.

2. For each with `llmAnalysis`:

   * Build `patternId = area + "::" + scenario + "::" + decisionAxis`.
   * Find or create a `PatternSummary` for that `patternId`.
   * Update aggregates:

     * `questionCount++`
     * If `isCorrect === false`, `wrongCount++`
     * If `confidence` is `"unsure"` or `"guess"`, `lowConfidenceCount++`
     * `lastSeenAt = max(lastSeenAt, attempt.timestamp)`
   * Optionally, set or refine `stickyRule` with the latest LLM rule (or the one from a question the user explicitly marked useful).

3. Store all `PatternSummary` objects in storage.

**Postconditions**

* System maintains a compact list of patterns, ranked by “how much you struggle here”.

---

## UC8 – Weakness Dashboard Overview

**Goal**
Show the student **where they’re actually struggling**, in a way that’s not overwhelming.

**Trigger**

* User opens the extension popup and clicks “Weaknesses” / “My weak spots”.

**Preconditions**

* `PatternSummary` data exists.

**Main Flow**

1. Popup requests `PatternSummary[]` from background.
2. Background returns sorted list, by default sorted by:

   * `wrongCount + lowConfidenceCount` (descending).
3. Popup displays top N patterns (e.g. 3–5), each showing:

   * Title: `area` – short description of `scenario`.
   * Example:

     > “Networking – Private subnets need outbound access to AWS services”
   * Stats:

     * “7 questions”, “5 wrong”, “2 unsure/guess”
   * Most recent `stickyRule`.
   * “Drill this” button.

**Postconditions**

* User has a **small set of clear weak areas** instead of 130 services.

---

## UC9 – Focused Drill on a Pattern

**Goal**
Let the user practice only the questions linked to a specific weak pattern, with compressed rules and quick rechecks.

**Trigger**

* User clicks “Drill this pattern” in dashboard (UC8).

**Preconditions**

* At least 1 `QuestionAttempt` exists for that `patternId`.

**Main Flow**

1. Popup or a new side panel shows a simple drill interface:

   * For pattern `patternId`, load all associated `QuestionAttempt` ids (wrong or low-confidence first).

2. For each drill item:

   1. Show:

      * Simplified stem (`llmAnalysis.simplifiedStem`),
      * Answer options (possibly shortened by LLM),
      * The key triggers (optionally hidden at first).
   2. Ask user: “Which is correct?” (they choose again, like a mini quiz).
   3. Immediately show:

      * Correct answer,
      * Short `correctWhy`,
      * The `stickyRule`.
   4. Ask: “Is this clear now?” ✔/✖

      * If ✖, mark this question as still confusing → keep in future rounds.
      * If ✔, reduce weight of this question in future drills.

3. Optionally, log a new `QuestionAttempt` or “reviewAttempt” type to track improvement.

**Postconditions**

* Pattern gets repeatedly hammered until user marks the rules as clear.
* System can gradually show fewer questions from a pattern once the user stabilizes.

---

## UC10 – Export / Reset Study Data (Optional, but Practical)

**Goal**
Allow user to export their data or reset it without breaking the extension.

**Trigger**

* User clicks “Export my data” or “Reset progress” in advanced settings.

**Preconditions**

* Extension has stored attempts and patterns.

**Main Flow**

1. Export:

   * Background collects all `QuestionAttempt` & `PatternSummary`.
   * Generates a JSON file and triggers download.
2. Reset:

   * Confirm with user.
   * Clear relevant storage keys.

**Postconditions**

* User can back up or wipe their history safely.

---

If you give these 10 use cases + the data model to another LLM and say:

> “Implement the extension architecture, storage, and UI flows that satisfy these use cases.”

it will have enough structure to generate:

* Content script logic,
* Background storage and LLM calls,
* Popup/dashboard React/Vue/plain JS UI,
* And even testing scenarios.

If you want, next we can do **a minimal JSON API spec for the LLM calls** (prompts + expected outputs) so the other LLM has zero ambiguity on that part too.
