# 0. Overall Assumptions

  

* Platform: **Chrome extension**.

* Target site: **Udemy practice exams / quizzes** (AWS SAA/SAP etc.).

* Modes you care about:

* **Timed exam mode** (simulates real exam; minimal help, logging allowed).

* **Practice mode** (no timer / relaxed; full help).

* **Review mode** (post-exam review; full help).

* Storage: all data is **local to the user**:

* Prefer **IndexedDB** (or equivalent) via a small data access layer.

* LLM: you’ll call some API (OpenAI, Claude, etc.) via:

* Background script → remote API; content script only sends context.

* Static knowledge base:

* A curated JSON graph built from TD cheat sheets + Stephane Maarek mindmaps (and maybe others).

* Used to anchor concepts (ids, names, domains).

  

---

  

## 0.1 Shared Data Model

  

These are the canonical types used across all UCs.

  

```ts

// Core per-attempt record (live or imported)

type QuestionAttempt = {

attemptId: string; // UUID v4

questionId: string; // Udemy ID OR stable hash

examId: string | null; // Udemy practice test id if detectable

examTitle: string | null; // e.g. "AWS CSA Practice Test 5"

attemptOrdinal: number | null; // 1, 2, 3... ("Attempt X" on Udemy result page)

examAttemptKey: string | null; // e.g. "review-<examId>-attempt-2"

  

mode: "timed" | "practice" | "review" | "unknown";

source: "live" | "review-import"; // UC1-A sets "live", UC1-B sets "review-import"

  

timestamp: number; // Date.now() or parsed completion time

  

stemText: string; // raw stem

choices: {

index: number; // 0-based

label: string; // "A", "B", "C", ...

text: string;

}[];

  

chosenIndices: number[]; // selected options

correctIndices: number[]; // ground truth from DOM, if available

isCorrect: boolean | null; // null if we can’t infer correctness

  

// Enriched later by UC2 for live attempts

confidence?: "sure" | "unsure" | "guess" | null;

};

  

// Stable, de-duplicated question info (stem, choices, explanation, links)

type QuestionMeta = {

questionId: string;

examId: string | null;

examTitle: string | null;

  

stemText: string;

choices: {

index: number;

label: string;

text: string;

}[];

  

domainLabel: string | null; // e.g. "Design High-Performing Architectures"

  

officialExplanationHtml: string | null; // raw innerHTML from Udemy "Overall explanation"

referenceLinks: {

url: string;

kind: "aws_docs" | "td_cheat_sheet" | "udemy_internal" | "other";

}[];

  

firstSeenAt: number;

lastSeenAt: number;

};

  

// NEW: Aggregated, ground-truth stats per question (no AI here)

type QuestionStats = {

questionId: string;

  

totalAttempts: number; // all attempts (live + imports)

correctAttempts: number;

wrongAttempts: number;

  

guessAttempts: number;

unsureAttempts: number;

sureAttempts: number;

  

lastAttemptAt: number | null;

lastCorrectAt: number | null;

lastWrongAt: number | null;

  

// How many times the user invoked AI "Analyze"/Insight on this question

analyzeInvocationCount: number;

lastAnalyzedAt: number | null;

};

  

// Per exam attempt (e.g. "Practice Test 5 – Attempt 2")

type ExamAttemptMeta = {

examAttemptKey: string; // e.g. "review-<examId>-attempt-2"

examId: string | null;

examTitle: string | null;

attemptOrdinal: number | null;

mode: "timed" | "practice" | "review-only" | "unknown";

  

totalQuestions: number | null;

correctCount: number | null;

incorrectCount: number | null;

skippedCount: number | null;

markedCount: number | null;

  

completedAt: number | null; // if parsable from Udemy

importedAt: number; // when stored

source: "live" | "review-import"; // here: usually "review-import"

};

  

// Concept tags per question (AI overlay → stable concept graph)

type QuestionConcept = {

questionId: string;

conceptId: string;

confidence: number; // 0..1

};

  

// Help events (UC3)

type ConceptHelpEvent = {

id: string;

questionId: string;

attemptId: string | null;

conceptId: string | null;

highlightedText: string;

mode: "practice" | "review" | "timed" | "unknown";

timestamp: number;

savedForReview: boolean;

};

  

// Explanation summaries (UC6)

type ExplanationSummary = {

attemptId: string;

questionId: string;

conceptIds: string[];

stickyRule: string;

eliminationClues: string[];

userChoiceSummary: string;

correctChoiceSummary: string;

createdAt: number;

};

  

// Concept stats (UC7)

type ConceptStats = {

conceptId: string;

totalAttempts: number;

correctAttempts: number;

wrongAttempts: number;

guessAttempts: number;

unsureAttempts: number;

sureAttempts: number;

helpRequests: number; // from UC3

lastSeenAt: number | null;

lastWrongAt: number | null;

masteryScore: number; // 0..100

priorityScore: number; // 0..100

};

  

// Review interactions inside guided sessions (UC9)

type ReviewInteraction = {

id: string;

questionId: string;

conceptIds: string[];

timestamp: number;

selfReportedRecall: "remembered" | "fuzzy" | "dont_remember";

postReviewConfidence: "sure" | "unsure" | "guess" | null;

};

````

  

**IndexedDB logical stores:**

  

* `Attempts` → `QuestionAttempt`

* `QuestionMeta` → `QuestionMeta`

* `QuestionStats` → `QuestionStats` ← NEW store

* `ExamAttempts` → `ExamAttemptMeta`

* `QuestionConcepts` → `QuestionConcept`

* `ConceptHelpEvents` → `ConceptHelpEvent`

* `ExplanationSummaries` → `ExplanationSummary`

* `ConceptStats` → `ConceptStats`

* (optional) `ReviewInteractions` → `ReviewInteraction`

  

---

  

## 0.2 Design Principles: Ground Truth vs AI Overlay

  

These principles guide all later UCs:

  

1. **Ground truth = what actually happened on real questions.**

  

* Attempts, correctness, confidence, timestamps.

* Aggregated into `QuestionStats` and then into `ConceptStats`.

  

2. **AI overlay = interpretation and grouping.**

  

* Concept tags, summaries, rules, topic labels.

* Stored in `QuestionConcepts`, `ExplanationSummaries`, and used in UC3/UC5/UC6/UC8/UC9.

  

3. **Mastery is never granted directly by the AI.**

  

* `masteryScore` and `priorityScore` are computed from real attempts + help usage + recency.

* AI only helps to map questions to concepts and explain why things are right or wrong.

  

4. **Analyze / Question Insight is additive.**

  

* When the user clicks “Analyze question”, the system:

  

* Updates **question-level real stats** (`QuestionStats`).

* Adds or updates **concept-level overlay** (`QuestionConcepts`, `ExplanationSummaries`).

  

* It does not magically mark a concept as mastered.

  

---

  

# UC1-A – Question Attempt Capture (Core Live Logging)

  

**Priority:** P1 (must-have; everything else builds on it)

**Depends on:** basic storage layer (`Attempts`, `QuestionMeta`, `QuestionStats`)

  

### Goal

  

For **live usage** (while answering questions), record every submitted attempt as a `QuestionAttempt`, keep `QuestionMeta` up to date, and immediately update per-question `QuestionStats`.

  

### Trigger

  

* User **submits** an answer OR Udemy reveals correctness (green/red states) in:

  

* Timed mode

* Practice mode

* Review mode (if Udemy allows re-answering inline)

  

### Flow

  

1. **Detect Question Context (Live question page)**

  

In content script:

  

```js

const form = document.querySelector(

'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]'

);

if (!form) return;

```

  

Extract:

  

* `questionId` from dataset if present:

  

```js

const nativeQuestionId = form.dataset.questionId || null; // e.g. "134499133"

```

  

* `examId` from URL:

  

```js

const match = window.location.pathname.match(/practice-test\/(\d+)\//);

const examId = match ? match[1] : null;

```

  

* `examTitle` if visible on page (optional).

  

If there is no native id, you’ll fall back later to `computeQuestionHash(stemText, choices)`; this **must be the same** function used in UC1-B.

  

2. **Extract Stem and Choices**

  

```js

const promptEl = form.querySelector(".mc-quiz-question--question-prompt--9cMw2");

const stemText = promptEl ? promptEl.innerText.trim() : "";

  

const answerBlocks = form.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d");

const choices = [];

answerBlocks.forEach((block, idx) => {

const text = block.innerText.trim();

const label = String.fromCharCode("A".charCodeAt(0) + idx);

choices.push({ index: idx, label, text });

});

```

  

If `nativeQuestionId` is missing:

  

```js

const rawKey = stemText + "||" + choices.map(c => c.text).join("||");

const hashedId = hashString(rawKey);

const questionId = nativeQuestionId || hashedId;

```

  

3. **Detect Submission / Result**

  

Detect when evaluation is done:

  

* Attach listener to submit/check button:

  

```js

const submitBtn = form.querySelector(

"button[type='submit'], button[data-purpose='submit-btn']"

);

if (submitBtn) {

submitBtn.addEventListener("click", () => {

// Later, after DOM update, read correctness

});

}

```

  

* Or use a MutationObserver to watch for classes/icons indicating evaluation.

  

Detect chosen options:

  

```js

const chosenIndices = [];

const inputEls = form.querySelectorAll("input[type='radio'], input[type='checkbox']");

inputEls.forEach((input, idx) => {

if (input.checked) chosenIndices.push(idx);

});

```

  

4. **Detect Correctness**

  

After Udemy paints correctness:

  

```js

const correctIndices = [];

answerBlocks.forEach((block, idx) => {

const isCorrect =

block.classList.contains("mc-quiz-answer--correct--...") ||

block.querySelector("svg[data-purpose='correct-icon']");

if (isCorrect) correctIndices.push(idx);

});

  

let isCorrect = null;

if (chosenIndices.length && correctIndices.length) {

const chosenSet = new Set(chosenIndices);

const correctSet = new Set(correctIndices);

isCorrect =

chosenSet.size === correctSet.size &&

[...chosenSet].every(i => correctSet.has(i));

}

```

  

If Udemy doesn’t expose correct answers yet (for example, in a pure timed run where answers are only revealed at the end):

  

```ts

const correctIndices: number[] = [];

const isCorrect: boolean | null = null;

```

  

5. **Detect Mode (Best Effort v1)**

  

Heuristic:

  

* Visible countdown / “Remaining time” → `"timed"`.

* “Practice mode” label → `"practice"`.

* Inline review question with explanation visible → `"review"`.

* Else → `"unknown"`.

  

6. **Build Live `QuestionAttempt`**

  

Content script builds:

  

```ts

const attempt: QuestionAttempt = {

attemptId: generateUuid(),

questionId,

examId,

examTitle: null, // or extracted title if available

attemptOrdinal: null, // live question; full exam summary owned by UC1-B

examAttemptKey: null, // same reason

  

mode, // "timed" | "practice" | "review" | "unknown"

source: "live",

timestamp: Date.now(),

  

stemText,

choices,

chosenIndices,

correctIndices,

isCorrect,

confidence: null // will be updated by UC2

};

```

  

7. **Upsert `QuestionMeta` From Live View**

  

```ts

const now = Date.now();

  

const metaPatch: Partial<QuestionMeta> = {

questionId,

examId,

examTitle: null, // fill if you can see it on the page

stemText,

choices,

lastSeenAt: now

};

```

  

In background:

  

* If no `QuestionMeta` exists:

  

* Create with `firstSeenAt = now`, `lastSeenAt = now`,

`domainLabel = null`, `officialExplanationHtml = null`,

`referenceLinks = []`.

* If exists:

  

* Update `lastSeenAt`, and optionally update missing fields.

  

8. **Persist Live Attempt & Update QuestionStats**

  

* Send `attempt` to background via `chrome.runtime.sendMessage`.

* Background:

  

* Inserts into `Attempts`.

* Invokes UC1-C logic to update `QuestionStats` for this `questionId` using this new attempt.

  

### Edge Cases

  

* If correctness can’t be detected (`correctIndices` empty), store `isCorrect: null`; `QuestionStats` still updates counts (e.g. `totalAttempts++`).

* If Udemy DOM changes, wrap selectors with defensive checks and short-circuit without breaking the page.

* The hash function used when `questionId` is missing **must be identical** between UC1-A and UC1-B to avoid split identities.

  

---

  

# UC1-B – Historical Attempt Import from Review (Backfill After Install)

  

**Priority:** P1 (same tier as UC1-A – critical for first-time users)

**Depends on:** UC1-A (data model, storage layer, UC1-C QuestionStats)

  

## Goal

  

Handle the scenario where the user installs the extension **after** taking one or more practice exams.

  

When the user opens a **Udemy review page**, the extension should:

  

1. **Reconstruct and log past question attempts** from the review DOM as `QuestionAttempt` with `source = "review-import"`.

2. **Populate `QuestionMeta`** (stem, choices, domain, official explanation).

3. **Create `ExamAttemptMeta` summaries** per attempt (“Practice Test 5 – Attempt 2”).

4. **Attach official reference links** (AWS docs, TD cheat sheets, etc.) to each question.

5. **Update `QuestionStats`** so that historical performance is part of the ground truth.

  

The effect: the system behaves as if those questions had been logged “live” previously.

  

---

  

## Trigger

  

* User with extension installed visits a **Udemy exam review page**, e.g. URLs like:

  

* `/course/.../practice-test/.../review/`

* The extension detects that:

  

* There is **no existing `ExamAttemptMeta`** with the same `examAttemptKey`, or

* The user explicitly asks to re-import.

  

---

  

## High-Level Flow

  

1. Detect that this is a review page; identify exam and attempt.

2. Parse exam-level metadata into `ExamAttemptMeta`.

3. Optionally prompt user with an import banner.

4. Iterate over question result panels; for each:

  

* Upsert `QuestionMeta` (stem, choices, domain, explanation, links).

* Insert a `QuestionAttempt` (`source = "review-import"`).

* Update `QuestionStats` for this `questionId`.

5. Persist into IndexedDB with deduplication.

  

---

  

## Detailed Flow

  

(Parsing steps 1–4.7 are the same as your previous spec.)

  

After building each imported `QuestionAttempt`:

  

```ts

const attempt: QuestionAttempt = {

attemptId: generateUuid(),

questionId,

examId,

examTitle,

attemptOrdinal,

examAttemptKey,

mode: "review",

source: "review-import",

timestamp: Date.now(), // or completion time if parsed

  

stemText,

choices,

chosenIndices,

correctIndices,

isCorrect,

confidence: null

};

```

  

Background:

  

* Inserts `attempt` into `Attempts`.

* Calls UC1-C logic to update `QuestionStats` for this question.

  

### Deduplication & Idempotency

  

* If an `(examAttemptKey, questionId)` pair already exists in `Attempts`, skip or overwrite; UC1-C should be idempotent and recompute stats if needed.

* `QuestionMeta` is upserted (keep `firstSeenAt`, update `lastSeenAt`, merge links, etc.).

  

---

  

# UC1-C – QuestionStats Aggregation (Per-Question Ground Truth)

  

**Priority:** P1.2 (core backbone for everything above AI)

**Depends on:** UC1-A, UC1-B (`QuestionAttempt` records must exist first)

  

### Goal

  

Maintain a **compact, always-up-to-date, AI-free summary** of how the user really performs on each question:

  

* How many times they’ve seen it.

* How often they’re correct vs wrong.

* How often they guess or feel unsure.

* When they last attempted it.

* How often they invoked AI “Analyze” on it.

  

This ensures all later logic (weak concepts, dashboards, review sessions) can rely on a clean core of real data, independent of any LLM interpretation.

  

### Trigger

  

* After every new `QuestionAttempt` is stored (live or imported).

* After every AI “Analyze question” invocation (UC1-D).

  

### Data Source

  

* `Attempts` store (append-only).

* Local `QuestionStats` store (one record per `questionId`).

  

### Flow

  

1. **Fetch or Initialize QuestionStats**

  

Background receives an `attempt`:

  

```ts

function onNewAttempt(attempt: QuestionAttempt) {

const now = attempt.timestamp || Date.now();

let stats = db.questionStats.get(attempt.questionId);

  

if (!stats) {

stats = {

questionId: attempt.questionId,

totalAttempts: 0,

correctAttempts: 0,

wrongAttempts: 0,

guessAttempts: 0,

unsureAttempts: 0,

sureAttempts: 0,

lastAttemptAt: null,

lastCorrectAt: null,

lastWrongAt: null,

analyzeInvocationCount: 0,

lastAnalyzedAt: null

};

}

  

// Update stats...

}

```

  

2. **Update Counts for the New Attempt**

  

```ts

stats.totalAttempts += 1;

stats.lastAttemptAt = now;

  

if (attempt.isCorrect === true) {

stats.correctAttempts += 1;

stats.lastCorrectAt = now;

} else if (attempt.isCorrect === false) {

stats.wrongAttempts += 1;

stats.lastWrongAt = now;

}

  

if (attempt.confidence === "guess") {

stats.guessAttempts += 1;

} else if (attempt.confidence === "unsure") {

stats.unsureAttempts += 1;

} else if (attempt.confidence === "sure") {

stats.sureAttempts += 1;

}

```

  

*Imported attempts (`source = "review-import"`) usually have `confidence = null`; they still update `totalAttempts` and correctness counts.*

  

3. **Persist Updated QuestionStats**

  

* Upsert `stats` back into `QuestionStats` store.

  

4. **Analyze Invocation Updates**

  

UC1-D will call a helper to update:

  

```ts

function onAnalyzeInvoked(questionId: string) {

const now = Date.now();

let stats = db.questionStats.get(questionId);

if (!stats) {

stats = {

questionId,

totalAttempts: 0,

correctAttempts: 0,

wrongAttempts: 0,

guessAttempts: 0,

unsureAttempts: 0,

sureAttempts: 0,

lastAttemptAt: null,

lastCorrectAt: null,

lastWrongAt: null,

analyzeInvocationCount: 0,

lastAnalyzedAt: null

};

}

stats.analyzeInvocationCount += 1;

stats.lastAnalyzedAt = now;

db.questionStats.put(stats);

}

```

  

### Usage

  

* UC7 uses `QuestionStats` + `QuestionConcepts` to derive concept-level stats.

* UC8 uses it to show per-question difficulty (“You got this wrong 3 times, 2 guesses, last seen 5 days ago”).

* UC9 uses it to prioritize which questions to include in review sessions.

  

### Edge Cases

  

* If multiple attempts for the same question are logged in quick succession (e.g. re-answering in review), stats just keep aggregating; this is desired behavior.

* If you ever need to recompute from scratch (e.g. after schema change), you can iterate through all `Attempts` and rebuild `QuestionStats`.

  

---

  

# UC1-D – Analyze Question Logging & AI Overlay Guardrails

  

**Priority:** P2 (ties AI insight to real stats)

**Depends on:** UC1-A, UC1-B, UC1-C, UC4, UC6

  

### Goal

  

When the user clicks **“Analyze question”** (or whatever the Question Insight trigger is), do three things in a controlled way:

  

1. Use LLM to produce concept-level overlay (tags, explanation, rules).

2. Record that the user **asked for AI help** on this specific question.

3. Ensure that **mastery is still driven by real attempts**, not by the AI result.

  

### Trigger

  

* User presses the extension’s “Analyze question” / “Question Insight” button on a question in:

  

* Practice mode

* Review mode

  

*(Typically not shown in timed mode.)*

  

### Flow

  

1. **Collect Context for the Analyzer**

  

* Identify `questionId` using same logic as UC1-A.

* Fetch latest `QuestionMeta` and latest `QuestionAttempt` for this `questionId` (if any).

* Collect:

  

```ts

type AnalyzeContext = {

questionId: string;

examId: string | null;

latestAttemptId: string | null;

stemText: string;

choices: string[];

chosenIndices: number[] | null;

correctIndices: number[] | null;

explanationText: string | null; // official Udemy explanation if available

};

```

  

2. **Update Real Data Layer**

  

Before doing any AI work, background calls:

  

```ts

onAnalyzeInvoked(questionId); // UC1-C helper

```

  

This ensures:

  

* `QuestionStats.analyzeInvocationCount++`

* `QuestionStats.lastAnalyzedAt = now`

  

So later you can say things like:

  

* “You needed AI on this question 3 times.”

  

3. **Call LLM for Concept Tagging (UC4)**

  

* Build a UC4-style request using `AnalyzeContext`.

* LLM returns concept IDs + confidences.

* Store results in `QuestionConcepts` for this `questionId` (UC4).

  

4. **Call LLM for Explanation Compression (UC6)**

  

* Use `AnalyzeContext` + `QuestionConcepts` to call UC6.

* LLM returns a structured summary (user vs correct choice, elimination clues, sticky rule).

* Store as `ExplanationSummary`.

  

5. **Render Insight Panel**

  

Content script renders:

  

* A compact explanation card under the question, using UC6 output.

* Optional short list of **concept names** derived from `QuestionConcepts`:

  

* e.g. “Concepts: VPC endpoints, Private subnets, S3.”

  

6. **Guardrails for Mastery & Stats**

  

* Do **not** change `QuestionAttempt.isCorrect` or `QuestionAttempt.confidence` here.

* Do **not** directly adjust `ConceptStats.masteryScore` or `priorityScore` based solely on AI content.

* All changes to `ConceptStats` continue to be driven by:

  

* New attempts (UC1-A / UC1-B).

* Help events (UC3).

* Review interactions (UC9).

  

### Edge Cases

  

* If there is no recorded attempt yet (user clicks “Analyze” before submitting):

  

* Set `latestAttemptId = null`.

* Use `stemText` and `choices` only.

* You may choose to show a small message: “Insight works best after you try the question at least once.”

  

* If LLM fails:

  

* Do not log a partial result.

* Leave `QuestionConcepts` and `ExplanationSummaries` untouched.

* `QuestionStats.analyzeInvocationCount` still increments, which is fine (they did ask for help).

  

---

  

# UC2 – Confidence & Meta-Input Capture

  

**Priority:** P1.5 (high value, cheap once UC1-A/UC1-C are done)

**Depends on:** UC1-A, UC1-C

  

### Goal

  

Capture how the user **felt** about their answer:

  

* “Confident”

* “Unsure”

* “Pure guess”

  

A correct answer + “guess” still indicates a weak concept.

  

### Trigger

  

* Immediately **after** submission (after UC1-A logs the attempt and UC1-C updates QuestionStats), and before or alongside explanations in practice/review mode.

  

### Mode Behavior

  

* **Timed mode**:

  

* For v1, do **not** show confidence UI.

* **Practice / Review mode**:

  

* Show a small inline confidence UI below the question.

  

### Flow

  

1. After UC1-A logs the attempt, content script injects:

  

```html

<div class="cz-confidence-bar" data-attempt-id="<attemptId>">

<span>How confident were you?</span>

<button data-confidence="sure">Sure</button>

<button data-confidence="unsure">Unsure</button>

<button data-confidence="guess">Guess</button>

</div>

```

  

2. When user clicks one:

  

```ts

type ConfidenceEvent = {

attemptId: string;

questionId: string;

timestamp: number;

confidence: "sure" | "unsure" | "guess";

};

```

  

Send to background.

  

3. Background logic:

  

* Look up the `QuestionAttempt` in `Attempts` by `attemptId`.

* Set `attempt.confidence = confidence`.

* Save back to `Attempts`.

* Call UC1-C’s `onNewAttempt`-style updater again in “update mode”:

  

* Subtract previous confidence counts for this attempt (if any).

* Add the new confidence classification for this attempt.

* `QuestionStats` now reflects confidence distribution for this question.

  

4. UI feedback:

  

* Highlight chosen button.

* Optional subtle “Saved” label.

  

### Edge Cases

  

* If user never clicks, `confidence` stays `null`.

* If user changes their mind, last click wins; `QuestionStats` is recomputed for that attempt’s confidence.

* For imported attempts, confidence UI is typically not shown retroactively.

  

---

  

# UC3 – Highlight-to-Explain Now (Immediate Concept Deep Dive)

  

**Priority:** P2 (very high learning impact)

**Depends on:** UC1-A (context), UC2 (optional), UC4 (optional but useful)

  

### Goal

  

Let the user highlight **exact phrases** they don’t fully understand (e.g. “VPC interface endpoint”, “Aurora global database during failover”) and get a **compact, structured explanation** right away, optionally marking it for later review.

  

### Mode Behavior

  

* Enabled in:

  

* Practice mode

* Review mode

* Disabled by default in timed mode.

  

### Trigger

  

* User selects text within:

  

* Question stem

* Answer choices

* Explanation text (from Udemy or from your own inserted explanation)

* On `mouseup`, if selection is non-empty and inside an allowed container, show an inline bubble.

  

### Flow

  

1. **Selection Detection**

  

```js

document.addEventListener("mouseup", () => {

const sel = window.getSelection();

const text = sel ? sel.toString().trim() : "";

if (!text || text.length < 2) return;

  

const range = sel.getRangeAt(0);

const container = range.commonAncestorContainer;

  

// Limit to quiz-related area

const questionRoot = container.closest?.(

'form.mc-quiz-question--container--dV-tK, .result-pane--question-result-pane-wrapper--2bGiz'

);

if (!questionRoot) return;

  

// Show bubble near selection

});

```

  

2. **Inline Bubble UI**

  

Insert:

  

```html

<div class="cz-explain-bubble">

<button data-action="explain">Explain</button>

<button data-action="explain-and-save">Explain + add to review</button>

</div>

```

  

3. **Build Explain Request**

  

Use:

  

* `QuestionMeta` as canonical source for `stemText` / `choices` where available.

* Latest `QuestionAttempt` (if any) to get `chosenIndices`, `correctIndices`, `mode`, `attemptId`.

* `QuestionMeta.officialExplanationHtml` or explanation text from DOM.

  

```ts

type ExplainRequest = {

questionId: string;

examId: string | null;

attemptId: string | null; // most recent attempt for this question, if any

highlightedText: string;

fullStemText: string;

chosenIndices: number[] | null;

correctIndices: number[] | null;

explanationText: string | null; // from DOM or QuestionMeta.officialExplanationHtml

mode: "practice" | "review" | "timed" | "unknown";

};

```

  

Background receives this and calls LLM with:

  

* `ExplainRequest`

* Static concept graph (TD + Stephane) as context.

  

4. **LLM Response Format**

  

Strict JSON, for example:

  

```json

{

"concept_id": "networking.vpc.endpoints.gateway_vs_interface",

"concept_name": "VPC Gateway vs Interface Endpoints",

"short_definition": "VPC endpoints let your private subnets reach AWS services without an internet gateway.",

"when_to_use": [

"Use gateway endpoints for S3 and DynamoDB when traffic comes from private subnets.",

"Use interface endpoints for most other AWS services."

],

"when_not_to_use": [

"Do not use a NAT gateway if a gateway endpoint would be cheaper for S3-only traffic."

],

"common_confusions": [

"Gateway endpoint works only with S3 and DynamoDB.",

"Interface endpoint uses ENIs in your subnets and is billed per hour plus data."

],

"sticky_rule": "If you see private subnets → S3/DynamoDB with no internet access, think gateway endpoint."

}

```

  

5. **Render Deep Dive Card**

  

Under the question or explanation:

  

```html

<div class="cz-deep-dive-card" data-concept-id="networking.vpc.endpoints.gateway_vs_interface">

<div class="cz-deep-dive-title">VPC Gateway vs Interface Endpoints</div>

<p class="cz-deep-dive-def">...</p>

<ul class="cz-deep-dive-use">...</ul>

<ul class="cz-deep-dive-avoid">...</ul>

<p class="cz-deep-dive-rule"><strong>Rule:</strong> ...</p>

</div>

```

  

6. **Persist Concept Help Event**

  

Log:

  

```ts

const event: ConceptHelpEvent = {

id: generateUuid(),

questionId,

attemptId,

conceptId: llmOutput.concept_id || null,

highlightedText,

mode,

timestamp: Date.now(),

savedForReview: (action === "explain-and-save")

};

```

  

Store in `ConceptHelpEvents`.

  

### Edge Cases

  

* If LLM fails, show a small non-blocking message ("Could not explain this right now.") and do not log an event.

* If `concept_id` uncertain, allow `null` or a generic `"misc.unknown"` value; still show explanation, but session logic can treat it as low-confidence.

  

---

  

# UC4 – Concept Extraction & Tagging (Per Question)

  

**Priority:** P2.5 (required for serious weakness modeling)

**Depends on:** UC1-A (question logged), UC1-B (for full explanation text)

  

### Goal

  

For each question, assign **1–3 concept IDs** from your static AWS ontology:

  

* e.g. `"storage.s3.object_lock"`, `"networking.vpc.nat_gateway"`, `"database.aurora.global_db_failover"`.

  

These tags power the weakness model and targeted review sessions.

  

### Trigger

  

* When a `QuestionMeta` is first fully available:

  

* After UC1-A logs the question and

* (Optionally) after UC1-B imports explanation, so the LLM has maximum context.

* Only run **once per questionId** unless you intentionally retrain/retag.

  

### Flow

  

1. **Static Concept Graph**

  

Packed with the extension:

  

```ts

type ConceptNode = {

id: string; // "networking.vpc.endpoints.gateway_vs_interface"

name: string; // "VPC Gateway vs Interface Endpoints"

domain: string; // "Networking"

aws_service: string; // "VPC"

parent_id: string | null;

keywords: string[]; // ["gateway endpoint", "interface endpoint", "S3 private access", ...]

};

```

  

2. **Build Tagging Request**

  

Use `QuestionMeta`:

  

```ts

const meta: QuestionMeta = /* from store */;

  

const taggingRequest = {

questionId: meta.questionId,

stemText: meta.stemText,

choices: meta.choices.map(c => c.text),

explanationText: meta.officialExplanationHtml, // or stripped text

knownConcepts: prunedConceptList // to keep tokens under control

};

```

  

3. **LLM Output Format**

  

Strict JSON:

  

```json

{

"concept_tags": [

{

"concept_id": "networking.vpc.endpoints.gateway_vs_interface",

"confidence": 0.9

},

{

"concept_id": "networking.vpc.private_subnets",

"confidence": 0.7

}

]

}

```

  

4. **Persist → `QuestionConcepts`**

  

Background:

  

```ts

const items: QuestionConcept[] = output.concept_tags

.filter(tag => tag.confidence >= 0.5)

.slice(0, 3)

.map(tag => ({

questionId: meta.questionId,

conceptId: tag.concept_id,

confidence: tag.confidence

}));

```

  

* Insert/overwrite `QuestionConcepts` entries for this `questionId`.

  

5. **Reuse**

  

* UC3 can use `QuestionConcept` + concept keywords to pre-suggest `conceptId`.

* UC7 uses them to aggregate stats.

* UC8/UC9 use them to group questions by concept.

  

### Edge Cases

  

* If no concept gets confidence > 0.5, store a fallback:

  

```ts

{ questionId, conceptId: "misc.unknown", confidence: 0.2 }

```

  

* If ontology changes later, you may want a re-tagging job, but that’s outside v1 scope.

  

---

  

# UC5 – Stem Simplification & Keyword Highlight

**Priority:** P3 (very valuable for comprehension)  
**Depends on:** UC1-A (or `QuestionMeta`), UC4 (optional for better prompts)

### Goal

Make questions easier to parse by:
1. Showing a concise, AI-generated summary (short stem) on demand.
2. Highlighting decisive keywords in the question and answers.

### Mode Behavior

* On-demand: runs when the user clicks **Analyze question** (no auto-run).  
* Enabled in **practice & review**; disabled in timed by default (configurable).  
* Keyword highlighting can be toggled in the popup.

### Trigger

* User clicks **Analyze question** (or a cached analysis is restored).

### Flow

1. **LLM request (on Analyze)**  
   * Input: question text (plus explanation if present).  
   * Output JSON includes:  
     * `short_stem`: 1–3 bullets summarizing the scenario.  
     * `key_triggers`: 3–5 verbatim keywords/short snippets (1–3 words) that capture the core ask; at least one must appear in a correct option.  
     * `eliminate_rules`: concise reasons per option.  
     * `bad_phrases`: per option, verbatim phrases that justify elimination.  
     * `topic_tags`, `correct_choices`, `correct_choice`, `correct_reason`.

2. **Render**  
   * Analysis panel shows the short stem and other fields; **Key triggers** are collapsed by default and appear just above Tags (light styling).  
   * Keyword highlighting after Analyze or cached restore:  
     * Question stem: neutral highlight from `key_triggers`.  
     * Answers: green highlight on correct options, red on incorrect, using `bad_phrases` when available, otherwise `key_triggers`.

3. **Toggle**  
   * Popup toggle `Keyword highlighting` (`czHighlightEnabled`, default on).  
   * Turning it off removes highlights immediately; turning it on reapplies highlights from the last analysis without re-running the LLM.

4. **Persistence**  
   * Simplified snapshots and last analyses are cached locally so highlights can be reapplied after toggles or cached restores.

### Edge Cases

* If LLM output is missing/malformed, skip highlights quietly.  
* If no bad phrases for a wrong option, fall back to key triggers.  
* If highlighting is off, skip spans; re-enable reapplies from cache.
# UC6 – Post-Question Explanation Compression & Rule Extraction

  

**Priority:** P3 (big value for review)

**Depends on:** UC1-A (attempt), UC2 (confidence), UC4 (concept tags)

  

### Goal

  

Once the user sees the explanation, show a **compact summary**:

  

* Why their choice was wrong (if wrong).

* Why the correct choice is right.

* Which clues eliminate wrong options.

* A short “sticky rule” they can reuse later.

  

### Trigger

  

* In **practice** or **review** mode when:

  

* Udemy’s explanation panel becomes visible, or

* User opens a stored-explanation view inside your dashboard.

  

### Flow

  

1. **Gather Context**

  

Combine information from:

  

* `QuestionAttempt` (latest attempt for that question).

* `QuestionMeta` (stem, choices, officialExplanationHtml).

* `QuestionConcepts` (conceptIds).

  

```ts

type ExplanationContext = {

questionId: string;

attemptId: string;

stemText: string;

choices: {

index: number;

label: string;

text: string;

}[];

chosenIndices: number[];

correctIndices: number[];

explanationText: string | null; // from QuestionMeta.officialExplanationHtml or DOM

confidence: "sure" | "unsure" | "guess" | null;

conceptIds: string[];

};

```

  

2. **LLM Request / Response**

  

Request strict JSON, example response:

  

```json

{

"user_choice_summary": "You picked option B, which only focuses on discovery and does not migrate VMs.",

"correct_choice_summary": "Correct answer A uses AWS MGN to continuously replicate VMs with minimal downtime.",

"elimination_clues": [

"The question mentions 'lift-and-shift' and 'minimal downtime', which AWS MGN is built for.",

"Application Discovery Service is only for discovery and planning, not replication."

],

"sticky_rule": "If you see 'lift-and-shift' plus 'minimal downtime' for VMs, think AWS MGN."

}

```

  

3. **Render Under Explanation**

  

```html

<div class="cz-explainer">

<div class="cz-explainer-section">

<strong>Why your choice was wrong:</strong>

<p>...</p>

</div>

<div class="cz-explainer-section">

<strong>Why the correct answer is right:</strong>

<p>...</p>

</div>

<div class="cz-explainer-section">

<strong>How to eliminate wrong options next time:</strong>

<ul>

<li>...</li>

</ul>

</div>

<p class="cz-explainer-rule"><strong>Rule:</strong> ...</p>

</div>

```

  

4. **Persist Summary**

  

Build and store:

  

```ts

const summary: ExplanationSummary = {

attemptId: attempt.attemptId,

questionId: attempt.questionId,

conceptIds,

stickyRule: output.sticky_rule,

eliminationClues: output.elimination_clues,

userChoiceSummary: output.user_choice_summary,

correctChoiceSummary: output.correct_choice_summary,

createdAt: Date.now()

};

```

  

Insert into `ExplanationSummaries`.

  

### Edge Cases

  

* If there is no explanation text (rare in review), LLM can infer from stem + choices only.

* If LLM fails, do nothing; user still has Udemy’s original explanation.

  

---

  

# UC7 – Weakness Model & Mastery Scores (Concept-Level)

  

**Priority:** P4 (core intelligence layer)

**Depends on:** UC1-A, UC1-B, UC1-C, UC2, UC3, UC4, UC6

  

### Goal

  

For each concept, maintain:

  

* `masteryScore` (0–100): how well the user seems to understand it.

* `priorityScore` (0–100): how urgently it should be reviewed.

  

Based on **ground truth and help usage**:

  

* Correct vs wrong answers (from `QuestionStats` and `Attempts`).

* Confidence levels (UC2).

* Help requests (UC3).

* Optional: heavy reliance on “Analyze” (`QuestionStats.analyzeInvocationCount`) as an extra weakness signal.

* Recency (forgetting curve).

  

Not based directly on:

  

* AI opinions about mastery.

* AI self-evaluation or natural-language praise.

  

### Concept State Model

  

(Already defined above as `ConceptStats`.)

  

### When to Update

  

* After every new `QuestionAttempt` and `QuestionStats` update.

* After each `ConceptHelpEvent`.

* Optionally after each `ReviewInteraction` (UC9).

  

### Link Between Questions and Concepts

  

* `QuestionConcepts` provides the mapping:

  

* For each `questionId`, there are 1–3 `conceptId`s with confidence scores.

  

### Update Logic (Heuristic v1)

  

1. **Aggregate Stats per Concept**

  

Concept-level stats are derived from question-level ground truth.

  

For each `QuestionAttempt`:

  

* Get `QuestionConcepts` for `attempt.questionId`.

* For each `conceptId` (with `confidence >= 0.5`):

  

```ts

stats.totalAttempts++;

  

if (attempt.isCorrect === false) {

stats.wrongAttempts++;

stats.lastWrongAt = now;

} else if (attempt.isCorrect === true) {

stats.correctAttempts++;

}

  

if (attempt.confidence === "guess") stats.guessAttempts++;

if (attempt.confidence === "unsure") stats.unsureAttempts++;

if (attempt.confidence === "sure") stats.sureAttempts++;

  

stats.lastSeenAt = now;

```

  

2. **Incorporate Help Signals**

  

For each `ConceptHelpEvent`:

  

```ts

stats.helpRequests++;

stats.lastSeenAt = Math.max(stats.lastSeenAt ?? 0, event.timestamp);

```

  

Optionally, when computing mastery, you can factor in `QuestionStats.analyzeInvocationCount` for questions tied to this concept (e.g. treat “many analyzes” as more help usage) — but you don’t need a separate field on `ConceptStats` for that in v1.

  

3. **Compute Base Mastery**

  

Example heuristic:

  

```ts

function computeBaseMastery(stats: ConceptStats): number {

let score = 100;

  

score -= stats.wrongAttempts * 25;

score -= stats.guessAttempts * 18;

score -= stats.unsureAttempts * 10;

score -= stats.helpRequests * 15;

  

if (score < 0) score = 0;

if (score > 100) score = 100;

return score;

}

```

  

4. **Recency Adjustment**

  

Dampens over time:

  

```ts

const RECENCY_HALF_LIFE_DAYS = 14;

  

function adjustForRecency(stats: ConceptStats, baseScore: number, now: number): number {

if (!stats.lastSeenAt) return baseScore;

  

const days = (now - stats.lastSeenAt) / (1000 * 60 * 60 * 24);

const decayFactor = Math.exp(-days / RECENCY_HALF_LIFE_DAYS);

  

const adjusted = 50 + (baseScore - 50) * decayFactor;

return Math.round(adjusted);

}

```

  

5. **Priority Score**

  

Higher priority for low mastery + recent trouble + many help requests.

  

```ts

function computePriority(stats: ConceptStats, mastery: number, now: number): number {

let priority = 100 - mastery; // inverse of mastery

  

if (stats.lastWrongAt) {

const daysSinceWrong = (now - stats.lastWrongAt) / (1000 * 60 * 60 * 24);

if (daysSinceWrong < 7) priority += 15;

}

  

priority += stats.helpRequests * 5;

  

if (priority < 0) priority = 0;

if (priority > 100) priority = 100;

return Math.round(priority);

}

```

  

### Explicit Guardrail

  

* `masteryScore` and `priorityScore` should **never** increase solely because:

  

* An AI explanation looked good.

* An AI tag says “user understands this.”

  

* Improvements to mastery come only from:

  

* Correct attempts with higher confidence over time.

* Successful review interactions in UC9 (optional small boosts).

  

---

  

# UC8 – Weakness Dashboard & Concept Graph

  

**Priority:** P4.5 (turns stats into insight)

**Depends on:** UC7 (ConceptStats), UC4, UC6

  

### Goal

  

Provide a **dashboard** showing:

  

* Overall readiness.

* Strong / weak domains.

* Per-concept mastery and priority.

* Drill-down into worst questions and key rules.

  

### Trigger

  

* User opens the extension popup and clicks “Dashboard”, or

* User opens a dedicated dashboard page directly.

  

### Data Input

  

* `ConceptStats` (UC7).

* Static concept graph (names, domains, descriptions).

* `ExplanationSummaries` (sticky rules).

* `QuestionAttempts` + `QuestionMeta` for question snippets.

* Optionally `QuestionStats` for detailed per-question aggregates.

  

### UI Sections

  

1. **Global Readiness Indicator**

  

* Show something like `Overall readiness (rough): 72/100`.

* Computed as a weighted average of `masteryScore` across concepts (weight by domain importance or number of questions).

  

2. **Concept List by Domain**

  

Group rows like:

  

```ts

type ConceptDisplayRow = {

conceptId: string;

name: string;

domain: string;

masteryScore: number;

priorityScore: number;

totalAttempts: number;

latestStickyRule: string | null;

};

```

  

Display in a table or cards:

  

* Networking:

  

* VPC basics – Mastery 85, Priority 20

* VPC endpoints gateway vs interface – Mastery 41, Priority 82 (flag as weak)

* Storage:

  

* S3 basics – Mastery 78, Priority 30

* S3 Object Lock vs Glacier – Mastery 35, Priority 90 (weak)

  

3. **Filters and Sorting**

  

Controls:

  

* Filter: “Only show weak (< 60 mastery)”

* Filter: “Only concepts with help requests”

* Sort: “By priority”, “By name”, “By domain”

  

4. **Concept Details Panel**

  

On click:

  

* Show:

  

* Concept name, domain, AWS service.

* Canonical description from static concept KB.

* Recent sticky rules from `ExplanationSummaries` associated with this concept.

* List of “tricky” questions for this concept:

  

```ts

type QuestionSnippet = {

questionId: string;

shortStem: string; // first ~80 chars from QuestionMeta.stemText

isCorrect: boolean; // result of last attempt

lastAttemptAt: number;

confidence: "sure" | "unsure" | "guess" | null;

attemptsCount: number;

};

```

  

* Provide a button:

  

* “Review this concept now” → UC9 with this concept pre-selected.

  

5. **Actions**

  

* “Start targeted review on weak concepts” → UC9 (auto-select top N concepts by priorityScore).

* “Export snapshot” (optional, for sharing with coach).

  

---

  

# UC9 – Targeted Review Sessions (Guided Practice)

  

**Priority:** P5 (top-level training feature)

**Depends on:** UC7, UC8, UC5, UC6, UC3

  

### Goal

  

Use stored data to create **short, focused review sessions** that attack the user’s weakest concepts with minimal noise:

  

* Use worst questions first.

* Show simplified stems, compressed explanations, and sticky rules.

* Track whether the user remembers the concepts now.

  

### Trigger

  

* User clicks:

  

* “Start review session” in the dashboard, or

* “Review this concept” from a concept detail panel.

  

### Session Configuration

  

Small modal:

  

* **Scope**:

  

* Option A: “My weakest concepts (auto-picked)”

* Option B: “Selected concept only”

* **Size**:

  

* 5 / 10 / 15 questions, or

* “15 minutes” (approximate by, say, 1–2 minutes per question)

  

### Question Selection Logic

  

Given the chosen scope:

  

1. Identify conceptIds to review:

  

* If “weakest concepts”: pick top K concepts sorted by `priorityScore`.

* If “this concept only”: just that `conceptId`.

  

2. Build a pool of candidate questions:

  

* All questions (`questionId`s) tagged with those concepts (`QuestionConcepts`).

  

* For each question:

  

* Compute difficulty signals from `QuestionAttempts` and `QuestionStats`:

  

* Last result (correct/wrong).

* Count of wrong answers.

* Count of guesses vs sure.

* Count of help requests (from `ConceptHelpEvents`).

* Optionally `QuestionStats.analyzeInvocationCount` (many AI calls = “painful question”).

  

* Sort pool:

  

* Wrong > guessed > unsure > correct-but-help-requested > correct-sure.

  

3. Choose N questions for the session (without replacement).

  

### Session Flow (Per Question)

  

For v1, use a **standalone session UI** in your dashboard (no Udemy navigation required):

  

1. Display from stored data:

  

* `QuestionMeta.stemText`

* `QuestionMeta.choices`

* Optional: UC5 simplified scenario above the question.

* Optional: ask user to answer again within your UI (not graded by Udemy).

  

2. Ask self-reported recall:

  

```html

<div class="cz-review-recall">

<span>How well do you remember this concept?</span>

<button data-recall="remembered">I remember clearly</button>

<button data-recall="fuzzy">I'm fuzzy</button>

<button data-recall="dont_remember">I don't remember</button>

</div>

```

  

3. After recall answer:

  

* Show UC6 compressed explanation and sticky rule if available.

* Optionally ask: “Now, how confident do you feel?” (same three levels as UC2).

  

4. Persist `ReviewInteraction`:

  

```ts

const interaction: ReviewInteraction = {

id: generateUuid(),

questionId,

conceptIds, // from QuestionConcepts

timestamp: Date.now(),

selfReportedRecall, // "remembered" | "fuzzy" | "dont_remember"

postReviewConfidence // "sure" | "unsure" | "guess" | null

};

```

  

Insert into `ReviewInteractions`.

  

5. Update ConceptStats (soft bumps):

  

* If a concept had low mastery and the user now reports “remembered” with high post-review confidence, you can slightly bump `masteryScore` or reduce `priorityScore` using a small heuristic.

  

### Optional UX: Udemy Overlay Mode

  

Later, you could:

  

* Open the actual Udemy question in a new tab or window.

* Overlay your panel on top.

* Let user re-answer in Udemy UI and then attach session metadata.

  

But standalone dashboard mode is easier for v1 and avoids URL gymnastics.

  

---

  

# UC10 (Optional) – Read-Aloud / Focus Mode (TTS)

  

**Priority:** Optional (polish)

**Depends on:** none (separate from the analytics)

  

### Goal

  

Provide a simple **Focus Mode** where the extension reads the question and answers aloud using TTS, helping with concentration and fatigue.

  

### Behavior

  

* A toggle in the popup: “Read questions aloud”.

  

* When enabled:

  

* For each visible question, show:

  

```html

<button class="cz-tts-play">Play Q + answers</button>

```

  

* When clicked:

  

* Build a string from `QuestionMeta.stemText` and choices.

* Call your TTS backend (Google, other).

* Play audio; allow pause/stop.

  

* No need for word-by-word highlighting or sync in v1.

  

### Relation to Other UCs

  

* Independent of the mastery model.

* Can be used in timed, practice, and review modes without affecting analytics.

* UC1-A/UC1-B still run normally.

  

---

  

## Final Priority Order (with Dependencies, Updated)

  

**P1 – Core Ground Truth**

  

1. **UC1-A** – Question Attempt Capture (live).

2. **UC1-B** – Historical Attempt Import from Review (backfill).

3. **UC1-C** – QuestionStats Aggregation (per-question ground truth).

  

**P1.5 – Confidence Layer**

  

4. **UC2** – Confidence Capture.

  

**P2 – Concept Understanding Hooks & Analyze**

  

5. **UC4** – Concept Extraction & Tagging.

6. **UC1-D** – Analyze Question Logging & AI Overlay Guardrails.

7. **UC3** – Highlight-to-Explain Now.

  

**P3 – Per-Question Cognitive Help**

  

8. **UC5** – Stem Simplification & Keyword Highlight.

9. **UC6** – Explanation Compression & Rule Extraction.

  

**P4 – Intelligence Layer**

  

10. **UC7** – Weakness Model & Mastery Scores.

  

**P4.5 – Insight UI**

  

11. **UC8** – Weakness Dashboard & Concept Graph.

  

**P5 – Active Training**

  

12. **UC9** – Targeted Review Sessions.

  

**Optional**

  

13. **UC10** – TTS Focus Mode.
