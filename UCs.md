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
  attemptId: string;             // UUID v4
  questionId: string;            // Udemy ID OR stable hash
  examId: string | null;         // Udemy practice test id if detectable
  examTitle: string | null;      // e.g. "AWS CSA Practice Test 5"
  attemptOrdinal: number | null; // 1, 2, 3... ("Attempt X" on Udemy result page)
  examAttemptKey: string | null; // e.g. "review-<examId>-attempt-2"

  mode: "timed" | "practice" | "review" | "unknown";
  source: "live" | "review-import"; // UC1-A sets "live", UC1-B sets "review-import"

  timestamp: number;             // Date.now() or parsed completion time

  stemText: string;              // raw stem
  choices: {
    index: number;               // 0-based
    label: string;               // "A", "B", "C", ...
    text: string;
  }[];

  chosenIndices: number[];       // selected options
  correctIndices: number[];      // ground truth from DOM, if available
  isCorrect: boolean | null;     // null if we can’t infer correctness

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

  domainLabel: string | null;         // e.g. "Design High-Performing Architectures"

  officialExplanationHtml: string | null; // raw innerHTML from Udemy "Overall explanation"
  referenceLinks: {
    url: string;
    kind: "aws_docs" | "td_cheat_sheet" | "udemy_internal" | "other";
  }[];

  firstSeenAt: number;
  lastSeenAt: number;
};

// Per exam attempt (e.g. "Practice Test 5 – Attempt 2")
type ExamAttemptMeta = {
  examAttemptKey: string;             // e.g. "review-<examId>-attempt-2"
  examId: string | null;
  examTitle: string | null;
  attemptOrdinal: number | null;
  mode: "timed" | "practice" | "review-only" | "unknown";

  totalQuestions: number | null;
  correctCount: number | null;
  incorrectCount: number | null;
  skippedCount: number | null;
  markedCount: number | null;

  completedAt: number | null;         // if parsable from Udemy
  importedAt: number;                 // when stored
  source: "live" | "review-import";   // here: usually "review-import"
};

// Concept tags per question
type QuestionConcept = {
  questionId: string;
  conceptId: string;
  confidence: number;   // 0..1
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
  helpRequests: number;     // from UC3
  lastSeenAt: number | null;
  lastWrongAt: number | null;
  masteryScore: number;     // 0..100
  priorityScore: number;    // 0..100
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
* `ExamAttempts` → `ExamAttemptMeta`
* `QuestionConcepts` → `QuestionConcept`
* `ConceptHelpEvents` → `ConceptHelpEvent`
* `ExplanationSummaries` → `ExplanationSummary`
* `ConceptStats` → `ConceptStats`
* (optional) `ReviewInteractions` → `ReviewInteraction`

---

# UC1-A – Question Attempt Capture (Core Live Logging)

**Priority:** P1 (must-have; everything else builds on it)
**Depends on:** basic storage layer (`Attempts`, `QuestionMeta`)

### Goal

For **live usage** (while answering questions), record every submitted attempt as a `QuestionAttempt` and keep `QuestionMeta` up to date.

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
     examTitle: null,           // or extracted title if available
     attemptOrdinal: null,      // live question; full exam summary owned by UC1-B
     examAttemptKey: null,      // same reason

     mode,                      // "timed" | "practice" | "review" | "unknown"
     source: "live",
     timestamp: Date.now(),

     stemText,
     choices,
     chosenIndices,
     correctIndices,
     isCorrect,
     confidence: null           // will be updated by UC2
   };
   ```

7. **Upsert `QuestionMeta` From Live View**

   ```ts
   const now = Date.now();

   const metaPatch: Partial<QuestionMeta> = {
     questionId,
     examId,
     examTitle: null,   // fill if you can see it on the page
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

8. **Persist Live Attempt**

   * Send `attempt` to background via `chrome.runtime.sendMessage`.
   * Background inserts into `Attempts` store.

### Edge Cases

* If you cannot detect correctness (`correctIndices` empty), store `isCorrect: null` and let UC1-B later import ground truth from the review page.
* If Udemy DOM changes, wrap selectors with defensive checks and short-circuit without breaking the page.
* The hash function used when `questionId` is missing **must be identical** between UC1-A and UC1-B to avoid split identities.

---

# UC1-B – Historical Attempt Import from Review (Backfill After Install)

**Priority:** P1 (same tier as UC1-A – critical for first-time users)
**Depends on:** UC1-A (data model, storage layer)

## Goal

Handle the scenario where the user installs the extension **after** taking one or more practice exams.

When the user opens a **Udemy review page**, the extension should:

1. **Reconstruct and log past question attempts** from the review DOM as `QuestionAttempt` with `source = "review-import"`.
2. **Populate `QuestionMeta`** (stem, choices, domain, official explanation).
3. **Create `ExamAttemptMeta` summaries** per attempt (“Practice Test 5 – Attempt 2”).
4. **Attach official reference links** (AWS docs, TD cheat sheets, etc.) to each question.

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
5. Persist into IndexedDB with deduplication.

---

## Detailed Flow

### Step 1 – Detect Review Context

In content script:

1. Check for review header:

   ```js
   const titleEl = document.querySelector(
     'h2.results-header--title--yQsZc[data-purpose="title"]'
   );
   if (!titleEl) return; // not a review page
   ```

2. Extract `examTitle`:

   ```js
   const examTitle = titleEl.innerText.trim();
   ```

3. Extract `attemptOrdinal`:

   ```js
   const attemptEl = document.querySelector("span.ud-heading-lg");
   const attemptOrdinal = attemptEl
     ? parseInt(attemptEl.innerText.replace(/\D/g, ""), 10)
     : null;
   ```

4. Extract `examId` from URL:

   ```js
   const match = window.location.pathname.match(/practice-test\/(\d+)\//);
   const examId = match ? match[1] : null;
   ```

5. Build `examAttemptKey`:

   ```js
   const examAttemptKey = `review-${examId || "unknown"}-attempt-${attemptOrdinal || "unknown"}`;
   ```

6. Ask background if this `examAttemptKey` already exists in `ExamAttempts`.

   * If exists:

     * Either skip import or show a small “Already imported” badge.
   * If not:

     * Continue to banner or auto-import.

### Step 2 – Optional Import Banner

Content script may inject:

```html
<div class="cz-import-banner">
  <span>
    Do you want to import this exam attempt into your study profile?
  </span>
  <button data-action="cz-import-start">Import now</button>
  <button data-action="cz-import-dismiss">Not now</button>
</div>
```

In v1 you can skip the prompt and auto-import silently.

When user accepts (or auto-import is enabled), proceed.

### Step 3 – Parse Exam Summary Stats → `ExamAttemptMeta`

From pills:

```html
<ul class="ud-unstyled-list pill-group-module--pill-group--q7hFg">
  <li>... <span class="ud-btn-label">65 all</span></li>
  <li>... <span class="ud-btn-label">65 correct</span></li>
  <li>... <span class="ud-btn-label">0 incorrect</span></li>
  <li>... <span class="ud-btn-label">0 skipped</span></li>
  <li>... <span class="ud-btn-label">4 marked</span></li>
</ul>
```

Pseudo:

```js
const pillSpans = Array.from(
  document.querySelectorAll(".pill-group-module--pill-group--q7hFg .ud-btn-label")
);

function parseStat(label) {
  const span = pillSpans.find(el =>
    el.innerText.toLowerCase().includes(` ${label}`)
  );
  if (!span) return null;
  const num = parseInt(span.innerText, 10);
  return Number.isNaN(num) ? null : num;
}

const totalQuestions = parseStat("all");
const correctCount   = parseStat("correct");
const incorrectCount = parseStat("incorrect");
const skippedCount   = parseStat("skipped");
const markedCount    = parseStat("marked");
```

If completion date/time is available, parse it into `completedAt`; otherwise `completedAt = null`.

Build `ExamAttemptMeta`:

```ts
const examAttempt: ExamAttemptMeta = {
  examAttemptKey,
  examId,
  examTitle,
  attemptOrdinal,
  mode: "review-only",
  totalQuestions,
  correctCount,
  incorrectCount,
  skippedCount,
  markedCount,
  completedAt: completedAtOrNull,
  importedAt: Date.now(),
  source: "review-import"
};
```

Background upserts into `ExamAttempts`.

### Step 4 – Iterate Over Question Result Panels

Question containers:

```html
<div class="result-pane--question-result-pane-wrapper--2bGiz">
  <!-- header with "Question 1" and status -->
  <!-- question stem -->
  <!-- answers list -->
  <!-- overall explanation -->
  <!-- domain panel -->
</div>
```

Select all:

```js
const questionWrappers = document.querySelectorAll(
  ".result-pane--question-result-pane-wrapper--2bGiz"
);
```

For each `wrapper`:

#### 4.1 Question Id / Hash

Try to read a native question id:

```js
const nativeIdEl = wrapper.querySelector("[data-question-id]");
const nativeQuestionId = nativeIdEl ? nativeIdEl.getAttribute("data-question-id") : null;
```

If missing, compute stable hash:

```js
const stemEl = wrapper.querySelector(
  ".result-pane--question-format--PBvdY.ud-text-md.rt-scaffolding"
);
const stemText = stemEl ? stemEl.innerText.trim() : "";

const answerEls = wrapper.querySelectorAll('[data-purpose="answer-body"] .ud-heading-md');
const choiceTexts = Array.from(answerEls).map(el => el.innerText.trim());

const rawKey = stemText + "||" + choiceTexts.join("||");
const questionId = nativeQuestionId || hashString(rawKey);
```

#### 4.2 Stem & Choices

Reuse `stemText` and extract choices:

```js
const answerBlocks = wrapper.querySelectorAll('[data-purpose="answer"]');
const choices = [];

answerBlocks.forEach((block, idx) => {
  const textEl = block.querySelector('[data-purpose="answer-body"] .ud-heading-md');
  const text = textEl ? textEl.innerText.trim() : "";
  const label = String.fromCharCode("A".charCodeAt(0) + idx);

  choices.push({ index: idx, label, text });
});
```

#### 4.3 User Choice and Correct Answer

Using review DOM classes:

```js
const chosenIndices = [];
const correctIndices = [];

answerBlocks.forEach((block, idx) => {
  const isCorrect = block.classList.contains("answer-result-pane--answer-correct--PLOEU");
  const userLabel = block.querySelector('[data-purpose="answer-result-header-user-label"]');

  if (isCorrect) correctIndices.push(idx);
  if (userLabel) chosenIndices.push(idx); // "Your answer ..." label
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

For imports, set `confidence = null`.

#### 4.4 Domain Label

```js
const domainEl = wrapper.querySelector('[data-purpose="domain-pane"] .ud-text-md');
const domainLabel = domainEl ? domainEl.innerText.trim() : null;
```

#### 4.5 Official Explanation HTML + Reference Links

```js
const explContainer = wrapper.querySelector(
  ".overall-explanation-pane--overall-explanation--G-hLQ .ud-text-md.rt-scaffolding, #overall-explanation"
);
const officialExplanationHtml = explContainer ? explContainer.innerHTML.trim() : null;

const referenceLinks = [];
if (explContainer) {
  const anchors = explContainer.querySelectorAll("a[href]");
  anchors.forEach(a => {
    const url = a.getAttribute("href");
    if (!url) return;

    let kind = "other";
    if (url.includes("docs.aws.amazon.com")) kind = "aws_docs";
    else if (url.includes("tutorialsdojo.com")) kind = "td_cheat_sheet";
    else if (url.includes("udemy.com")) kind = "udemy_internal";

    referenceLinks.push({ url, kind });
  });
}
```

#### 4.6 Upsert `QuestionMeta`

```ts
const now = Date.now();

const meta: QuestionMeta = {
  questionId,
  examId,
  examTitle,
  stemText,
  choices,
  domainLabel,
  officialExplanationHtml,
  referenceLinks,
  firstSeenAt: now,
  lastSeenAt: now
};
```

Background behavior:

* If `QuestionMeta` exists:

  * Keep `firstSeenAt` as-is, update `lastSeenAt`.
  * Merge `referenceLinks` (dedupe by URL).
  * Fill `domainLabel`, `examTitle`, `officialExplanationHtml` if missing or better data is available.
* If not:

  * Insert as-is.

#### 4.7 Insert Imported `QuestionAttempt`

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

Send to background for insertion into `Attempts`.

### Step 5 – Deduplication & Idempotency

1. **Exam-level dedup**

   * Background checks `ExamAttempts` by `examAttemptKey`.
   * If exists, you may:

     * Skip new `ExamAttemptMeta`.
     * Skip per-question imports unless user explicitly triggers a re-scan.

2. **Question-level dedup**

   * Enforce uniqueness on `(examAttemptKey, questionId)` in `Attempts`.
   * If an entry already exists, you can skip or overwrite (idempotent import).

3. **Meta-level updates**

   * `QuestionMeta` is always upserted: `lastSeenAt` updated, links merged, explanation set if previously blank.

---

# UC2 – Confidence & Meta-Input Capture

**Priority:** P1.5 (high value, cheap once UC1-A is done)
**Depends on:** UC1-A (QuestionAttempt already logged)

### Goal

Capture how the user **felt** about their answer:

* “Confident”
* “Unsure”
* “Pure guess”

This is critical: a correct answer + “guess” still indicates a weak concept.

### Trigger

* Immediately **after** submission (after UC1-A logs the attempt), and before or alongside showing explanations in practice/review mode.

### Mode Behavior

* **Timed mode**:

  * For v1, do **not** show confidence UI (to keep timed runs clean).
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
   * (Optional) also append a record to a small `ConfidenceEvents` log if you want time-series; **truth source** remains `QuestionAttempt.confidence`.

4. UI feedback:

   * Visually highlight the chosen button.
   * Optionally show a subtle “Saved” indicator.

### Edge Cases

* If user never clicks, `confidence` stays `null`.
* If user changes their mind, last click wins (background just overwrites `confidence` field).
* For imported attempts (`source = "review-import"`), you typically don’t show confidence UI retroactively.

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
     attemptId: string | null;       // most recent attempt for this question, if any
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
     id: string;            // "networking.vpc.endpoints.gateway_vs_interface"
     name: string;          // "VPC Gateway vs Interface Endpoints"
     domain: string;        // "Networking"
     aws_service: string;   // "VPC"
     parent_id: string | null;
     keywords: string[];    // ["gateway endpoint", "interface endpoint", "S3 private access", ...]
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

Make long, wordy questions easier to parse by:

1. Summarizing the **core scenario** in 1–3 short bullets.
2. Highlighting **decisive phrases** in the original stem.

### Mode Behavior

* Enabled in **practice & review**.
* Disabled in **timed** by default (configurable later).

### Trigger

* When a question view is initialized (load or navigation) and `QuestionMeta` is available.

### Flow

1. **Gather Input**

   Prefer `QuestionMeta`:

   ```ts
   const stemText = meta.stemText;
   const choices = meta.choices.map(c => c.text);
   const conceptIds = getConceptIdsForQuestion(meta.questionId); // from QuestionConcepts, optional
   ```

   Build:

   ```ts
   type SimplifyRequest = {
     questionId: string;
     stemText: string;
     choices: string[];
     conceptIds: string[];
   };
   ```

2. **LLM Output Format**

   ```json
   {
     "summary_bullets": [
       "On-premises VMs must be migrated to AWS with minimal changes.",
       "Company wants a lift-and-shift approach with minimal downtime."
     ],
     "decisive_phrases": [
       "lift-and-shift",
       "minimize downtime",
       "on-premises virtual machines",
       "Linux and Windows operating systems"
     ],
     "noise_phrases": [
       "company age",
       "US East Coast"
     ]
   }
   ```

3. **Render Simplified Stem**

   Above the original question:

   ```html
   <div class="cz-stem-summary">
     <div class="cz-stem-title">Simplified scenario</div>
     <ul>
       <li>...</li>
       <li>...</li>
     </ul>
   </div>
   ```

4. **Keyword Highlight in Original Stem**

   * For each `decisive_phrase`, search within the question stem DOM.

   * Wrap exact matches in:

     ```html
     <span class="cz-key-phrase">minimize downtime</span>
     ```

   * CSS:

     ```css
     .cz-key-phrase {
       background: #fff3bf;
       border-radius: 2px;
       padding: 0 1px;
     }
     ```

   Implement replacement at the text-node level to avoid breaking links or markup.

### Edge Cases

* If the LLM output is missing or malformed, skip simplification for that question quietly.
* If a decisive phrase appears many times, you may highlight the first N matches to avoid over-highlighting.

---

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
     explanationText: string | null;  // from QuestionMeta.officialExplanationHtml or DOM
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
**Depends on:** UC1-A, UC1-B, UC2, UC3, UC4, UC6

### Goal

For each concept, maintain:

* `masteryScore` (0–100): how well the user seems to understand it.
* `priorityScore` (0–100): how urgently it should be reviewed.

Based on:

* Correct vs wrong answers.
* Confidence levels.
* Help requests (UC3).
* Recency (forgetting curve).

### Concept State Model

(Already defined in 0.1, repeated here for context)

```ts
type ConceptStats = {
  conceptId: string;
  totalAttempts: number;
  correctAttempts: number;
  wrongAttempts: number;
  guessAttempts: number;
  unsureAttempts: number;
  sureAttempts: number;
  helpRequests: number;
  lastSeenAt: number | null;
  lastWrongAt: number | null;
  masteryScore: number;
  priorityScore: number;
};
```

### When to Update

* After every new `QuestionAttempt` (live or imported) where:

  * `QuestionConcepts` tag the question with conceptIds.
* After each `ConceptHelpEvent` (UC3).
* Optionally when new `ExplanationSummary` is created (e.g. treat that as additional help).

### Update Logic (Heuristic v1)

Penalty constants:

```ts
const WRONG_PENALTY = 25;
const GUESS_PENALTY = 18;
const UNSURE_PENALTY = 10;
const HELP_PENALTY = 15;
const RECENCY_HALF_LIFE_DAYS = 14;
```

#### 1. Aggregate Stats per Concept

For each `QuestionAttempt`:

* Find `conceptIds` from `QuestionConcepts`.
* For each concept:

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

For each `ConceptHelpEvent`:

```ts
stats.helpRequests++;
stats.lastSeenAt = Math.max(stats.lastSeenAt ?? 0, event.timestamp);
```

Imports (`source = "review-import"`) usually have `confidence = null`; they still contribute to correct/wrong counts.

#### 2. Compute Base Mastery

```ts
function computeBaseMastery(stats: ConceptStats): number {
  let score = 100;

  score -= stats.wrongAttempts * WRONG_PENALTY;
  score -= stats.guessAttempts * GUESS_PENALTY;
  score -= stats.unsureAttempts * UNSURE_PENALTY;
  score -= stats.helpRequests * HELP_PENALTY;

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}
```

#### 3. Recency Adjustment

```ts
function adjustForRecency(stats: ConceptStats, baseScore: number, now: number): number {
  if (!stats.lastSeenAt) return baseScore;

  const days = (now - stats.lastSeenAt) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.exp(-days / RECENCY_HALF_LIFE_DAYS);

  const adjusted = 50 + (baseScore - 50) * decayFactor;
  return Math.round(adjusted);
}
```

#### 4. Priority Score

Higher when mastery is low and recent trouble is high.

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

### Storage

* `ConceptStats` store keyed by `conceptId`.
* Updated incrementally whenever new attempts or help events are recorded.

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
         shortStem: string;      // first ~80 chars from QuestionMeta.stemText
         isCorrect: boolean;     // result of last attempt
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

     * Compute difficulty signals from `QuestionAttempts`:

       * Last result (correct/wrong).
       * Count of wrong answers.
       * Count of guesses.
       * Count of help requests (from `ConceptHelpEvents`).
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
     selfReportedRecall,          // "remembered" | "fuzzy" | "dont_remember"
     postReviewConfidence         // "sure" | "unsure" | "guess" | null
   };
   ```

   Insert into `ReviewInteractions`.

5. Update ConceptStats:

   * If concept initially had low mastery and user now reports “remembered” and higher confidence, you can slightly bump masteryScore (or reduce priorityScore) using a small heuristic (e.g. “soft success” bump).

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

## Final Priority Order (with Dependencies)

**P1 – Core Logging & Confidence**

1. **UC1-A** – Question Attempt Capture (live).
2. **UC1-B** – Historical Attempt Import from Review (backfill).
3. **UC2** – Confidence Capture.

**P2 – Concept Understanding Hooks**

4. **UC4** – Concept Extraction & Tagging.
5. **UC3** – Highlight-to-Explain Now.

**P3 – Per-Question Cognitive Help**

6. **UC5** – Stem Simplification & Keyword Highlight.
7. **UC6** – Explanation Compression & Rule Extraction.

**P4 – Intelligence Layer**

8. **UC7** – Weakness Model & Mastery Scores.

**P4.5 – Insight UI**

9. **UC8** – Weakness Dashboard & Concept Graph.

**P5 – Active Training**

10. **UC9** – Targeted Review Sessions.

**Optional**

11. **UC10** – TTS Focus Mode (polish only).
