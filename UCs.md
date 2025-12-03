## 0. Overall Assumptions

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

# UC1 – Question Attempt Capture (Core Logging)

**Priority:** P1 (must-have; everything else builds on it)
**Depends on:** none

### Goal

Record **every question attempt** as a structured event: what question, which answers were chosen, whether it was correct, and which mode the user was in.

### Trigger

* User **submits** an answer OR Udemy reveals correctness (green/red states).
* This happens in:

  * Timed mode
  * Practice mode
  * Review mode (if re-answering is possible)

### Flow

1. **Detect Question Context**

   * In content script, locate the question container, e.g.:

     ```js
     const form = document.querySelector(
       'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]'
     );
     ```

   * Read:

     * `questionId` from `form.dataset.questionId` (e.g. `data-question-id="134499133"`).
     * `examId` if available (can be parsed from URL, e.g. `/practice-test/XXXXX/`).

   * Extract raw **stem text** (no simplification yet):

     ```js
     const promptEl = form.querySelector(".mc-quiz-question--question-prompt--9cMw2");
     const stemText = promptEl ? promptEl.innerText.trim() : "";
     ```

   * Extract **answer choices**:

     * For each `.mc-quiz-answer--answer-body--V-o8d`, capture:

       * `choiceIndex` (0-based)
       * `label` (A, B, C, …)
       * `text` (innerText)

2. **Detect Submission / Result**

   * Hook on:

     * The “Check” / “Submit” button click, **or**
     * A DOM mutation where answer choices gain correctness classes (e.g. “correct” / “incorrect”).
   * Detect **which choice(s)** user selected:

     * Check each `<input name="answer">` or multi-select checkboxes: `checked === true`.

3. **Detect Correctness**

   * Prefer reading Udemy’s DOM:

     * Correct answers often get a “correct” class or a green icon.
     * Extract `correctIndices` based on these classes.
   * Compute:

     ```ts
     isCorrect = (set(chosenIndices) == set(correctIndices));
     ```

4. **Detect Mode (Best Effort v1)**

   * Use a heuristic:

     * If there is a visible countdown timer or “Remaining time” → **timed**.
     * If “Practice mode” label is present → **practice**.
     * If on result/review page (`/learn/quiz/review/`) → **review**.
   * If detection is unreliable, **store `"unknown"`** but don’t block logging.

5. **Build Attempt Event**

   * Content script composes:

     ```ts
     type QuestionAttempt = {
       attemptId: string;             // UUID v4
       questionId: string;            // from data-question-id
       examId: string | null;
       mode: "timed" | "practice" | "review" | "unknown";
       timestamp: number;             // Date.now()
       stemText: string;              // raw
       choices: {
         index: number;
         label: string;               // "A" / "B" ...
         text: string;
       }[];
       chosenIndices: number[];       // e.g. [1] or [0,2]
       correctIndices: number[];      // from DOM
       isCorrect: boolean;
     };
     ```

6. **Persist**

   * Send the event to background (`chrome.runtime.sendMessage`).
   * Background stores it in IndexedDB:

     * Store in `Attempts` store keyed by `attemptId`.
     * Also maintain a `Questions` store keyed by `questionId` with stable metadata:

       * `examId`, `stemText`, `choices`, firstSeenAt.

### Edge Cases

* If you **cannot find correct answers**, store `correctIndices: []` and `isCorrect: null` (tri-state) – don’t crash.
* If question DOM changes (Udemy redesign), fail gracefully but log.

---

# UC2 – Confidence & Meta-Input Capture

**Priority:** P1.5 (high value, cheap to add once UC1 exists)
**Depends on:** UC1 (question context)

### Goal

Capture how the user **felt** about their answer:

* “Confident”
* “Unsure”
* “Pure guess”

This is critical signal: a correct answer + “guess” reveals a **fragile concept**, not a strong one.

### Trigger

* Immediately **after** submission (after UC1 logging), and **before** or alongside showing explanations in practice/review mode.

### Mode Behavior

* **Timed mode**:

  * Either **disable** confidence UI or make it a global toggle (“training overlay disabled in timed mode”).
  * For v1, simplest: **no confidence prompt in timed mode**.

* **Practice / Review mode**:

  * Show the small confidence UI.

### Flow

1. After UC1 logs the attempt, content script injects a small inline block under the question:

   ```html
   <div class="cz-confidence-bar" data-attempt-id="...">
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

   * Send to background and store:

     * Either in `Attempts` (add a `confidence` field),
     * Or in a separate `ConfidenceEvents` store linked by `attemptId`.

3. UI:

   * After selection:

     * Highlight the chosen option.
     * Optionally show subtle text: “Noted for your study profile.”

### Edge Cases

* If user never clicks, leave `confidence = null`.
* If user changes their mind, last click wins.

---

# UC3 – Highlight-to-Explain Now (Immediate Concept Deep Dive)

**Priority:** P2 (very high learning impact)
**Depends on:** UC1 (context), UC2 (optional), UC4 (optional but nice to tie concepts)

### Goal

Let the user highlight **exact phrases** they don’t fully understand (e.g. “VPC interface endpoint”, “Aurora global database during failover”) and get a **compact explanation right now**, optionally marking it for future review.

### Mode Behavior

* **Enabled** in:

  * Practice mode
  * Review mode
* **Disabled by default** in timed mode (no interactive help there).

### Trigger

* User selects text **within**:

  * Question stem
  * Answer choices
  * Explanation text
* On `mouseup`, if selection is non-empty and inside allowed container, show inline bubble.

### Flow

1. **Selection Detection**

   In content script:

   ```js
   document.addEventListener("mouseup", () => {
     const sel = window.getSelection();
     const text = sel ? sel.toString().trim() : "";
     if (!text || text.length < 2) return;

     const range = sel.getRangeAt(0);
     const container = range.commonAncestorContainer;
     const form = container.closest?.('form.mc-quiz-question--container--dV-tK');
     if (!form) return;

     // Show bubble near selection
   });
   ```

2. **Inline Bubble UI**

   Insert a small floating bubble near the selection:

   ```html
   <div class="cz-explain-bubble">
     <button data-action="explain">Explain</button>
     <button data-action="explain-and-save">Explain + add to review</button>
   </div>
   ```

3. **Build Explain Request**

   On click:

   ```ts
   type ExplainRequest = {
     questionId: string;
     examId: string | null;
     attemptId: string | null;    // last attempt for this question, if any
     highlightedText: string;
     fullStemText: string;
     chosenIndices: number[] | null;
     correctIndices: number[] | null;
     explanationText: string | null; // Udemy explanation if available
     mode: "practice" | "review" | "timed" | "unknown";
   };
   ```

   * Send to background.
   * Background calls LLM with:

     * The static concept graph (TD + Stephane) as context,
     * The request above.

4. **LLM Response Format**

   Force the LLM to return strict JSON like:

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
       "Interface endpoint uses ENIs in your subnets and is billed per hour + data."
     ],
     "sticky_rule": "If you see private subnets -> S3/DynamoDB and no internet access, think gateway endpoint."
   }
   ```

5. **Render Deep Dive Card**

   The content script renders a block under the question or under the explanation:

   ```html
   <div class="cz-deep-dive-card" data-concept-id="...">
     <div class="cz-deep-dive-title">VPC Gateway vs Interface Endpoints</div>
     <p class="cz-deep-dive-def">...</p>
     <ul class="cz-deep-dive-use">...</ul>
     <ul class="cz-deep-dive-avoid">...</ul>
     <p class="cz-deep-dive-rule"><strong>Rule:</strong> ...</p>
   </div>
   ```

6. **Persist Concept Help Event**

   Regardless of whether user clicked “Explain” or “Explain + add to review”, log:

   ```ts
   type ConceptHelpEvent = {
     id: string;
     questionId: string;
     attemptId: string | null;
     conceptId: string | null;      // from LLM, or null if unknown
     highlightedText: string;
     mode: "practice" | "review" | "timed" | "unknown";
     timestamp: number;
     savedForReview: boolean;
   };
   ```

   Store in `ConceptHelpEvents` store.

### Edge Cases

* If LLM fails: show a graceful message: “Could not explain this right now.”
* If concept_id is uncertain, allow `null` or `"misc.unknown"` and still show explanation, but mark for manual review later if needed.

---

# UC4 – Concept Extraction & Tagging (Per Question)

**Priority:** P2.5 (required for any serious weakness modeling)
**Depends on:** UC1

### Goal

For each question, auto-tag it with **1–3 concept IDs** from your static AWS concept ontology:

* e.g., `"storage.s3.object_lock"`, `"networking.vpc.nat_gateway"`, `"database.aurora.global_db_failover"`.

### Trigger

* When a **question is first seen** or first answered:

  * After UC1 logs it.
* Only run once per `questionId`; cache result.

### Flow

1. **Static Concept Graph**

   Prepare a JSON like:

   ```ts
   type ConceptNode = {
     id: string;                    // "networking.vpc.endpoints.gateway_vs_interface"
     name: string;                  // "VPC Gateway vs Interface Endpoints"
     domain: string;                // "Networking"
     aws_service: string;           // "VPC"
     parent_id: string | null;      // for hierarchy
     keywords: string[];            // ["gateway endpoint", "interface endpoint", "S3 private access", ...]
   };
   ```

   Store this in extension package or fetched once and cached.

2. **Build Tagging Request**

   Background script, when needed, sends to LLM:

   ```ts
   type TaggingRequest = {
     questionId: string;
     stemText: string;
     choices: string[];
     explanationText: string | null;
     knownConcepts: ConceptNode[]; // or a pruned subset to keep tokens low
   };
   ```

3. **LLM Output Format**

   Force JSON:

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

4. **Persist**

   Store in `QuestionConcepts` store:

   ```ts
   type QuestionConcept = {
     questionId: string;
     conceptId: string;
     confidence: number;   // 0..1
   };
   ```

   * Enforce at most 3 high-confidence tags per question.

5. **Reuse**

   * UC3 (Deep Dive) can propose a `conceptId` if the highlighted text overlaps one of the concept keywords.
   * UC6, UC7, UC8, UC9 all use `QuestionConcepts` heavily.

### Edge Cases

* If no concept has confidence > threshold (e.g. 0.5), tag:

  * `conceptId: "misc.unknown"`, `confidence: 0.2`.

---

# UC5 – Stem Simplification & Keyword Highlight

**Priority:** P3 (very valuable, but depends on basics above)
**Depends on:** UC1, optionally UC4

### Goal

Make long, wordy questions easier to parse by:

1. Summarizing the **core scenario** in 1–3 short bullets.
2. Highlighting a few **decisive phrases** in the original stem.

### Mode Behavior

* Enabled in **practice & review**.
* Disabled in **timed** by default (configurable later).

### Trigger

* When a new question is loaded (before or after answering).

### Flow

1. **Gather Input**

   * From UC1:

     * `stemText`
     * `choices` (optional)
   * Optionally: concept tags from UC4.

2. **LLM Request**

   ```ts
   type SimplifyRequest = {
     questionId: string;
     stemText: string;
     choices: string[];
     conceptIds: string[]; // from UC4, optional
   };
   ```

3. **LLM Output Format**

   ```json
   {
     "summary_bullets": [
       "On-premises VMs need to be migrated to AWS with minimal changes.",
       "Company prefers lift-and-shift and wants to minimize downtime."
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

4. **Render Simplified Stem**

   Insert block **above** the question:

   ```html
   <div class="cz-stem-summary">
     <div class="cz-stem-title">Simplified scenario</div>
     <ul>
       <li>...</li>
       <li>...</li>
     </ul>
   </div>
   ```

5. **Keyword Highlight**

   * For each `decisive_phrase`, try to match it in the original question stem DOM.
   * Wrap matches in `<span class="cz-key-phrase">` without changing font weight.
   * CSS:

     ```css
     .cz-key-phrase {
       background: #fff3bf;
       border-radius: 2px;
       padding: 0 1px;
     }
     ```

### Edge Cases

* If LLM output is invalid or missing fields, skip summary and keep original question intact.
* Avoid breaking links, code blocks, or math by scoping replacing to text nodes only.

---

# UC6 – Post-Question Explanation Compression & Rule Extraction

**Priority:** P3 (big value for review)
**Depends on:** UC1, UC2, UC4

### Goal

After the user sees the explanation, show a **compact, high-signal summary**:

* Why their choice was wrong (if wrong).
* Why the correct choice is right.
* Which **clues** in the question eliminate wrong options.
* One **sticky rule**.

### Trigger

* In **practice or review mode**, when:

  * Explanation section becomes visible (DOM mutation),
  * OR user clicks “Show explanation” / “Review question”.

### Flow

1. **Gather Context**

   From UC1 + DOM:

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
     explanationText: string | null;  // from Udemy
     confidence: "sure" | "unsure" | "guess" | null;
     conceptIds: string[];           // from UC4
   };
   ```

2. **LLM Request**

   Send this to LLM and request strict JSON:

   ```json
   {
     "user_choice_summary": "You selected option B, which focuses on Application Discovery but does not handle continuous replication.",
     "correct_choice_summary": "Correct answer A uses AWS MGN (Migration Service) to continuously replicate VMs with minimal downtime.",
     "elimination_clues": [
       "The question emphasizes 'lift-and-shift' and 'minimal downtime', which MGN supports directly.",
       "Application Discovery Service only helps with discovery and planning, not actual replication."
     ],
     "sticky_rule": "If you see 'lift-and-shift' + 'minimal downtime' for VMs, think AWS MGN."
   }
   ```

3. **Render Under Explanation**

   Content script injects a compact block:

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
       <ul>...</ul>
     </div>
     <p class="cz-explainer-rule"><strong>Rule:</strong> ...</p>
   </div>
   ```

4. **Persist**

   Store in `ExplanationSummaries`:

   ```ts
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
   ```

   This feeds into UC7/UC8/UC9.

### Edge Cases

* If explanationText is missing, LLM can infer from stem + choices only.
* If LLM fails, do nothing; user still has the original Udemy explanation.

---

# UC7 – Weakness Model & Mastery Scores (Concept-Level)

**Priority:** P4 (core intelligence layer)
**Depends on:** UC1, UC2, UC3, UC4, UC6

### Goal

For each concept, maintain a **masteryScore (0–100)** and **priorityScore (0–100)**, based on:

* Wrong vs correct answers.
* Confidence.
* Help requests (UC3).
* Recency.

This is the brain behind the dashboard and review sessions.

### Concept State Model

```ts
type ConceptStats = {
  conceptId: string;
  totalAttempts: number;
  correctAttempts: number;
  wrongAttempts: number;
  guessAttempts: number;
  unsureAttempts: number;
  sureAttempts: number;
  helpRequests: number;     // from UC3, savedForReview or any explain
  lastSeenAt: number | null;
  lastWrongAt: number | null;
  masteryScore: number;     // 0..100
  priorityScore: number;    // 0..100
};
```

### When to Update

* After each **attempt** (UC1 + UC2).
* After each **help request** (UC3).
* Optionally after explanation view (UC6).

### Update Logic (Heuristic v1)

Define penalties and weights:

```ts
const WRONG_PENALTY = 25;
const GUESS_PENALTY = 18;
const UNSURE_PENALTY = 10;
const HELP_PENALTY = 15;
const RECENCY_HALF_LIFE_DAYS = 14;
```

#### 1. Aggregate stats per concept

For each `QuestionAttempt`:

* Find all `conceptIds` from `QuestionConcepts`.
* For each concept:

  * Increment `totalAttempts`.
  * If wrong:

    * `wrongAttempts++`
    * If `confidence === "sure"` → heavier negative.
  * If correct:

    * `correctAttempts++`
  * If `confidence === "guess"` → `guessAttempts++`
  * If `confidence === "unsure"` → `unsureAttempts++`
  * If `confidence === "sure"` → `sureAttempts++`
  * Update `lastSeenAt`, `lastWrongAt`.

For each `ConceptHelpEvent`:

* `helpRequests++`

#### 2. Compute Base Mastery

Start from 100 and subtract penalties:

```ts
function computeMastery(stats: ConceptStats): number {
  let score = 100;

  score -= stats.wrongAttempts * WRONG_PENALTY;
  score -= stats.guessAttempts * GUESS_PENALTY;
  score -= stats.unsureAttempts * UNSURE_PENALTY;
  score -= stats.helpRequests * HELP_PENALTY;

  // clamp
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}
```

#### 3. Recency Adjustment

* If concept wasn’t seen in a long time, lower mastery slightly.

```ts
function adjustForRecency(stats: ConceptStats, baseScore: number, now: number): number {
  if (!stats.lastSeenAt) return baseScore;

  const days = (now - stats.lastSeenAt) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.exp(-days / RECENCY_HALF_LIFE_DAYS); // 1 at day 0, ~0.5 at half-life

  // Combine good & bad: we trust mastery less as time goes by
  const adjusted = 50 + (baseScore - 50) * decayFactor;
  return Math.round(adjusted);
}
```

#### 4. Priority Score

* A concept is high-priority if:

  * Mastery is low **and**
  * It’s relevant to the exam (you can hardcode importance by domain)

Simple heuristic:

```ts
function computePriority(stats: ConceptStats, mastery: number, now: number): number {
  // Base priority is inverse of mastery
  let priority = 100 - mastery;

  // Boost if wrongAttempts > 0 and lastWrongAt is recent
  if (stats.lastWrongAt) {
    const daysSinceWrong = (now - stats.lastWrongAt) / (1000 * 60 * 60 * 24);
    if (daysSinceWrong < 7) priority += 15;
  }

  // Boost if helpRequests > 0
  priority += stats.helpRequests * 5;

  // Clamp
  if (priority < 0) priority = 0;
  if (priority > 100) priority = 100;
  return Math.round(priority);
}
```

### Storage

* A `ConceptStats` store keyed by `conceptId`.
* Updated incrementally after each new event.

---

# UC8 – Weakness Dashboard & Concept Graph

**Priority:** P4.5 (turns stats into insight)
**Depends on:** UC7

### Goal

Give the user a **visual overview** of their strong/weak areas and let them drill into a specific concept to see:

* Summary of the concept.
* Their worst questions.
* Related sticky rules.

### Trigger

* User opens the extension popup **or** clicks a “Dashboard” button in popup → open a dedicated dashboard page.

### Data Input

From UC7 + static concept graph + explanation summaries.

### UI Sections

1. **Global Readiness Indicator**

   * Show something like:

     * “Overall readiness (rough): 72/100”
     * Based on:

       * Weighted average of masteryScores across all concepts (weight by domain importance).

2. **Concept List by Domain**

   Group concepts by AWS domain:

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

   UI example:

   * Networking:

     * VPC basics – 85 (Strong)
     * VPC endpoints gateway vs interface – 41 (Weak, red badge)
   * Storage:

     * S3 basics – 78
     * S3 Object Lock vs Glacier – 35 (Weak, red)

3. **Filters**

   * “Show only weak (< 60)”
   * “Show only concepts with help requests”
   * “Sort by priority / name / domain”

4. **Concept Details Panel (on click)**

   When user clicks a concept:

   * Show:

     * Name + domain

     * Latest summarised explanation (you can reuse the canonical concept description from your static KB)

     * The last 3–5 **sticky rules** that mention this concept (from UC6).

     * A list of their **worst questions**, each entry:

       ```ts
       type QuestionSnippet = {
         questionId: string;
         shortStem: string;      // first 80 chars
         isCorrect: boolean;
         lastAttemptAt: number;
         confidence: "sure" | "unsure" | "guess" | null;
         attemptsCount: number;
       };
       ```

     * “Open in Udemy” button if you can reconstruct a URL or at least search string.

5. **Primary Call-to-Action**

   * Button: **“Start targeted review on weak concepts”** → UC9.

---

# UC9 – Targeted Review Sessions (Guided Practice)

**Priority:** P5 (top of the pyramid – uses everything)
**Depends on:** UC7, UC8, UC6, UC3

### Goal

Turn all the logged information into **short, focused review sessions** that attack the user’s weakest concepts with minimal cognitive noise.

### Trigger

* User clicks:

  * “Start review session” from the dashboard.
  * Or “Review this concept” from a concept detail panel.

### Session Config

Modal (in popup or dashboard):

* “What do you want to review?”

  * Option A: “My weakest concepts (auto-picked)”
  * Option B: “This concept only” (if launched from concept details)

* “How many questions?”

  * 5 / 10 / 15 or “15 min session”

### Selection Logic

Given configuration:

1. Build a **question pool**:

   * For selected concepts (most likely those with `priorityScore > threshold`).
   * All `QuestionAttempt`s for those concepts, sorted by:

     * Wrong answers first.
     * Then guessed.
     * Then unsure.
     * Then correct-but-help-requested.

2. Avoid very old or rarely seen questions unless needed.

3. Choose N questions for the session.

### Session Flow (Per Question)

There are two options for UX:

#### Option 1 – Overlay On Udemy

* Open the corresponding Udemy question in a new tab (or reuse existing tab).
* Overlay your own panel with:

  1. A **prompt**: “Before seeing the options, can you recall the core idea?” (optional)
  2. Buttons:

     * “I remember clearly”
     * “I’m fuzzy”
     * “I don’t remember at all”
  3. After they answer, show:

     * Simplified stem (UC5).
     * UC6 compressed explanation.
     * Sticky rule.
  4. Ask:

     * “Do you feel you now understand this concept?” (Yes/No)

       * If No → mark another `helpRequest`-like signal.

#### Option 2 – Standalone Session UI

* Render the stem + answer choices directly in your dashboard session page (using stored text).
* Ask user to pick the answer again and see if they’re now correct.
* Then show UC6 explanation.

You can start with **Option 2** since it doesn’t depend on Udemy navigation.

### Updating Stats

During the session:

* For each review interaction, create a pseudo-attempt:

  ```ts
  type ReviewInteraction = {
    id: string;
    questionId: string;
    conceptIds: string[];
    timestamp: number;
    selfReportedRecall: "remembered" | "fuzzy" | "dont_remember";
    postReviewConfidence: "sure" | "unsure" | "guess" | null;
  };
  ```

* Use this to **boost masteryScore** slightly if:

  * User initially had low mastery,
  * And now reports “remembered” or shows correct recall.

---

# (Optional) UC10 – Read-Aloud / Focus Mode (TTS)

**Priority:** Optional / low impact relative to above
**Depends on:** none

* Keep your current Google TTS integration as a **Focus Mode**:

  * A simple toggle in popup: “Read questions aloud”.
  * When on, `Play Q + answers` button uses your Google TTS (no word syncing guaranteed).
* This remains a **nice-to-have** but not core for passing the exam.

---

## Final Priority Order (with Dependencies)

**P1 – Core Logging & Confidence**

1. **UC1** – Question Attempt Capture (hard dependency for everything).
2. **UC2** – Confidence Capture.

**P2 – Concept Understanding Hooks**

3. **UC4** – Concept Extraction & Tagging.
4. **UC3** – Highlight-to-Explain Now.

**P3 – Per-Question Cognitive Help**

5. **UC5** – Stem Simplification & Keyword Highlight.
6. **UC6** – Explanation Compression & Rule Extraction.

**P4 – Intelligence Layer**

7. **UC7** – Weakness Model & Mastery Scores.

**P4.5 – Insight UI**

8. **UC8** – Weakness Dashboard & Concept Graph.

**P5 – Active Training**

9. **UC9** – Targeted Review Sessions.

**Optional**

10. **UC10** – TTS Focus Mode (polish only).

