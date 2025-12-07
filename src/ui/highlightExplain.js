// File: /src/ui/highlightExplain.js
// UC3 – Highlight-to-Explain Now

(function () {
  if (typeof window === "undefined") return;
  if (window.czUI && window.czUI.highlightExplain) return;

  const log = (window.czCore && window.czCore.log) || (() => {});
  const hashString = (window.czCore && window.czCore.hashString) || null;

  const ALLOWED_ROOT_SELECTORS =
    'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"], ' +
    ".result-pane--question-result-pane-wrapper--2bGiz, " +
    ".question-result--question-result--LWiOB, " +
    ".cz-deep-dive-card";

  let bubbleEl = null;
  let lastSelectionRect = null;
  const CARD_STATE_KEY = "czExplainCardPositions";
  let pendingCard = null;
  let lastSelectionRange = null;
  let bubbleContainer = null;

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function uuid() {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function findQuestionRoot(node) {
    let el = node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.matches && el.matches(ALLOWED_ROOT_SELECTORS)) return el;
      el = el.parentElement || el.parentNode;
    }
    return null;
  }

  function detectMode() {
    const path = window.location.pathname || "";
    if (/\/quiz\/\d+\/(result|review)\//.test(path)) return "review";
    if (/\/quiz\/\d+\//.test(path)) return "practice";
    return "unknown";
  }

  function computeQuestionId(root) {
    if (!root) return null;
    const native = root.getAttribute("data-question-id");
    if (native) return native;

    const prompt =
      root.querySelector("#question-prompt") ||
      root.querySelector(".mc-quiz-question--question-prompt--9cMw2") ||
      root.querySelector(".result-pane--question-format--PBvdY");

    const stemText = normalizeWhitespace(
      (prompt && (prompt.innerText || prompt.textContent)) || ""
    );

    const choiceEls =
      root.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d") ||
      root.querySelectorAll(".answer-result-pane--answer-body--cDGY6");

    const choiceTexts = Array.from(choiceEls || []).map((el) =>
      normalizeWhitespace(el.innerText || el.textContent || "")
    );

    const rawKey = stemText + "||" + choiceTexts.join("||");
    if (!rawKey.trim()) return null;
    if (hashString) return hashString(rawKey);
    return rawKey;
  }

  function getQuestionText(root) {
    if (!root) return "";

    if (root.classList && root.classList.contains("cz-deep-dive-card")) {
      return normalizeWhitespace(root.innerText || "");
    }

    const prompt =
      root.querySelector("#question-prompt") ||
      root.querySelector(".mc-quiz-question--question-prompt--9cMw2") ||
      root.querySelector(".result-pane--question-format--PBvdY");
    const stemText = prompt
      ? normalizeWhitespace(prompt.innerText || prompt.textContent || "")
      : "";

    const answerBodies = root.querySelectorAll(
      ".mc-quiz-answer--answer-body--V-o8d, .answer-result-pane--answer-body--cDGY6"
    );
    const answers = Array.from(answerBodies).map((el, idx) => {
      const label = String.fromCharCode(65 + idx);
      const txt = normalizeWhitespace(el.innerText || el.textContent || "");
      return `${label}. ${txt}`;
    });

    const explanation =
      root.querySelector(
        ".overall-explanation-pane--overall-explanation--G-hLQ"
      ) ||
      root.querySelector("#overall-explanation");

    const explText = explanation
      ? normalizeWhitespace(explanation.innerText || explanation.textContent || "")
      : "";

    return [stemText, answers.join("\n"), explText].filter(Boolean).join("\n\n");
  }

  function findScrollContainer(node) {
    let el = node;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const canScrollY =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight;
      if (canScrollY) return el;
      el = el.parentElement || el.parentNode;
    }
    // Fallback: known Udemy scroll wrapper
    const fallback =
      document.querySelector(".quiz-page-layout--scroll-container--kZizn") ||
      document.querySelector(".revamped-result-page--revamped-result-page--y-79J");
    return fallback || document.body;
  }

  function removeBubble() {
    if (bubbleEl && bubbleEl.parentNode) {
      bubbleEl.parentNode.removeChild(bubbleEl);
    }
    bubbleEl = null;
    bubbleContainer = null;
  }

  function removePendingCard() {
    if (pendingCard && pendingCard.parentNode) {
      pendingCard.parentNode.removeChild(pendingCard);
    }
    pendingCard = null;
  }

  function loadCardState(qid) {
    try {
      const raw =
        (window.localStorage && window.localStorage.getItem(CARD_STATE_KEY)) ||
        null;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveCardState(qid, state) {
    if (!qid) return;
    try {
      const map = loadCardState();
      map[qid] = Object.assign({}, map[qid], state);
      if (window.localStorage) {
        window.localStorage.setItem(CARD_STATE_KEY, JSON.stringify(map));
      }
    } catch (_) {
      /* ignore */
    }
  }

  function renderResultCard(root, output, highlightedText, rect, questionId) {
    if (!root) return;

    const card = document.createElement("div");
    card.className = "cz-deep-dive-card cz-deep-dive-flyout";
    card.setAttribute("data-concept-id", output.concept_id || "");
    if (questionId) card.setAttribute("data-question-id", questionId);

    const title = highlightedText || output.concept_name || "Explanation";
    const subtitle = output.concept_name || "";
    const def = output.short_definition || "";
    const whenUse = Array.isArray(output.when_to_use) ? output.when_to_use : [];
    const whenNot = Array.isArray(output.when_not_to_use)
      ? output.when_not_to_use
      : [];
    const confusions = Array.isArray(output.common_confusions)
      ? output.common_confusions
      : [];
    const rule = output.sticky_rule || "";

    card.innerHTML =
      `<div class="cz-deep-dive-header">` +
      `<span class="cz-deep-dive-title" title="${title}">${title}</span>` +
      `<div class="cz-deep-dive-actions">` +
      `<button class="cz-deep-dive-collapse" aria-label="Collapse">⯆</button>` +
      `<button class="cz-deep-dive-close" aria-label="Close">×</button>` +
      `</div>` +
      `</div>` +
      `<div class="cz-deep-dive-body">` +
      (subtitle ? `<div class="cz-deep-dive-subtitle">${subtitle}</div>` : "") +
      (highlightedText
        ? `<div class="cz-deep-dive-highlight">You highlighted: “${highlightedText}”</div>`
        : "") +
      (def ? `<p class="cz-deep-dive-def">${def}</p>` : "") +
      (whenUse.length
        ? `<div class="cz-deep-dive-section"><strong>Use when:</strong><ul>${whenUse
            .map((x) => `<li>${x}</li>`)
            .join("")}</ul></div>`
        : "") +
      (whenNot.length
        ? `<div class="cz-deep-dive-section"><strong>Avoid when:</strong><ul>${whenNot
            .map((x) => `<li>${x}</li>`)
            .join("")}</ul></div>`
        : "") +
      (confusions.length
        ? `<div class="cz-deep-dive-section"><strong>Common confusions:</strong><ul>${confusions
            .map((x) => `<li>${x}</li>`)
            .join("")}</ul></div>`
        : "") +
      (rule
        ? `<p class="cz-deep-dive-rule"><strong>Rule:</strong> ${rule}</p>`
        : "") +
      `</div>`;

    const closeBtn = card.querySelector(".cz-deep-dive-close");
    const collapseBtn = card.querySelector(".cz-deep-dive-collapse");
    const bodyEl = card.querySelector(".cz-deep-dive-body");

    closeBtn.addEventListener("click", () => {
      if (card.parentNode) card.parentNode.removeChild(card);
    });

    collapseBtn.addEventListener("click", () => {
      const collapsed = card.classList.toggle("cz-deep-dive-collapsed");
      collapseBtn.textContent = collapsed ? "⯈" : "⯆";
      saveCardState(questionId, { collapsed });
      if (collapsed) {
        const width = card.getBoundingClientRect().width;
        const newLeft = window.scrollX + 8;
        card.style.left = `${newLeft}px`;
        card.style.right = "auto";
        card.style.width = `${Math.min(Math.max(width, 160), 220)}px`;
        saveCardState(questionId, { left: newLeft });
      } else {
        card.style.width = "";
      }
    });

    // Dragging
    const header = card.querySelector(".cz-deep-dive-header");
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let startPos = { left: 0, top: 0 };

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const newLeft = Math.max(8, startPos.left + dx);
      const newTop = Math.max(8, startPos.top + dy);
      card.style.left = `${newLeft}px`;
      card.style.top = `${newTop}px`;
    }

    function onUp() {
      if (dragging) {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const finalLeft = parseInt(card.style.left, 10) || 0;
        const finalTop = parseInt(card.style.top, 10) || 0;
        saveCardState(questionId, { left: finalLeft, top: finalTop });
      }
    }

    header.addEventListener("mousedown", (e) => {
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      const rectCard = card.getBoundingClientRect();
      startPos = { left: rectCard.left + window.scrollX, top: rectCard.top + window.scrollY };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });

    // Positioning
    const targetRect = rect || lastSelectionRect;
    const state = questionId ? loadCardState(questionId)[questionId] : null;
    let defaultTop;
    let defaultLeft;
    if (state && typeof state.top === "number" && typeof state.left === "number") {
      defaultTop = state.top;
      defaultLeft = state.left;
    } else {
      // Center of viewport on first show (ignore selection)
      defaultTop = window.scrollY + window.innerHeight / 2 - 140;
      defaultLeft = window.scrollX + window.innerWidth / 2 - 160;
    }
    const collapsed = false; // always open when shown

    card.style.top = `${defaultTop}px`;
    card.style.left = `${defaultLeft}px`;
    if (collapsed) {
      card.classList.add("cz-deep-dive-collapsed");
      collapseBtn.textContent = "+";
    }

    document.body.appendChild(card);
    if (pendingCard) {
      pendingCard.parentNode && pendingCard.parentNode.removeChild(pendingCard);
      pendingCard = null;
    }

    // Clamp to viewport if overflowing
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const cardRect = card.getBoundingClientRect();
    let newLeft = defaultLeft;
    let newTop = defaultTop;

    if (cardRect.right > viewportW + window.scrollX - 10) {
      newLeft = Math.max(
        10 + window.scrollX,
        viewportW + window.scrollX - cardRect.width - 10
      );
    }
    if (cardRect.bottom > viewportH + window.scrollY - 10) {
      newTop = Math.max(
        10 + window.scrollY,
        defaultTop - cardRect.height - 20
      );
    }

    card.style.left = `${newLeft}px`;
    card.style.top = `${newTop}px`;
    avoidOverlap(card);
    saveCardState(questionId, { left: newLeft, top: newTop, collapsed });
  }

  function avoidOverlap(card) {
    const cards = Array.from(document.querySelectorAll(".cz-deep-dive-flyout"));
    const currentRect = card.getBoundingClientRect();
    let top = parseInt(card.style.top, 10) || currentRect.top + window.scrollY;

    cards.forEach((other) => {
      if (other === card) return;
      const r = other.getBoundingClientRect();
      const overlap =
        !(currentRect.right < r.left ||
          currentRect.left > r.right ||
          currentRect.bottom < r.top ||
          currentRect.top > r.bottom);
      if (overlap) {
        top = r.bottom + 8 + window.scrollY;
        card.style.top = `${top}px`;
      }
    });
  }

  function positionBubbleFromRange(range) {
    if (!bubbleEl || !range) return;
    try {
      const rect = range.getBoundingClientRect();
      lastSelectionRect = rect;
      const container = bubbleContainer || document.body;
      const containerRect = container.getBoundingClientRect();
      const top =
        (container.scrollTop || 0) +
        (rect.top - containerRect.top) -
        bubbleEl.offsetHeight -
        8;
      const left =
        (container.scrollLeft || 0) + (rect.left - containerRect.left);
      bubbleEl.style.top = `${Math.max(8, top)}px`;
      bubbleEl.style.left = `${Math.max(8, left)}px`;
    } catch (_) {
      /* ignore */
    }
  }

  function showBubble(range, onAction) {
    removeBubble();
    if (!range) return;

    lastSelectionRange = range.cloneRange();
    const rect = range.getBoundingClientRect();
    lastSelectionRect = rect;
    const anchorNode =
      (rect && range.commonAncestorContainer && range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement) || document.body;
    bubbleContainer = findScrollContainer(anchorNode);
    if (bubbleContainer) {
      const style = window.getComputedStyle(bubbleContainer);
      if (style.position === "static") {
        bubbleContainer.classList.add("cz-explain-container-rel");
      }
    }
    bubbleEl = document.createElement("div");
    bubbleEl.className = "cz-explain-bubble";
    bubbleEl.innerHTML = `
      <button type="button" data-action="explain">Explain</button>
      <button type="button" data-action="play-selection">Play selection</button>
    `;
    (bubbleContainer || document.body).appendChild(bubbleEl);

    bubbleEl.style.position = "absolute";
    positionBubbleFromRange(range);

    bubbleEl.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button[data-action]");
      if (!btn) return;
      const act = btn.dataset.action;
      log("HighlightExplain", "Bubble click", act);
      console.log("[HighlightExplain] bubble click", act);
      removeBubble();
      onAction(act);
    });
  }

  function explainSelection(root, range, highlightedText, saveForReview) {
    if (!root || !highlightedText) return;
    const questionId = computeQuestionId(root);
    const mode = detectMode();
    const contextText = getQuestionText(root);
    log("HighlightExplain", "Sending highlight explain", {
      questionId,
      mode,
      highlightedText,
      contextLen: contextText.length
    });

    if (!chrome?.runtime?.id || !chrome?.runtime?.sendMessage) {
      log("HighlightExplain", "chrome.runtime.sendMessage unavailable or extension reloaded");
      renderResultCard(root, { concept_name: "Explain failed", short_definition: "Extension unavailable." }, highlightedText, lastSelectionRect, questionId);
      return;
    }

    const payload = {
      type: "CZ_EXPLAIN_HIGHLIGHT",
      highlightedText,
      questionId,
      mode,
      contextText,
      url: window.location.href,
      saveForReview: !!saveForReview
    };

    try {
      // Pending indicator
      pendingCard = document.createElement("div");
      pendingCard.className = "cz-deep-dive-card cz-deep-dive-flyout cz-deep-dive-pending";
      pendingCard.textContent = "Explaining…";
      const defaultTop = window.scrollY + window.innerHeight / 2 - 60;
      const defaultLeft = window.scrollX + window.innerWidth / 2 - 120;
      pendingCard.style.top = `${defaultTop}px`;
      pendingCard.style.left = `${defaultLeft}px`;
      document.body.appendChild(pendingCard);

      chrome.runtime.sendMessage(payload, (resp) => {
        log("HighlightExplain", "Response", resp);
        removePendingCard();
        if (!resp) {
          log("HighlightExplain", "Explain failed: no response");
          renderResultCard(root, { short_definition: "Could not explain right now." }, highlightedText, lastSelectionRect, questionId);
          return;
        }

        if (!resp.ok) {
          log("HighlightExplain", "Explain failed", resp.error || resp.raw);
          renderResultCard(
            root,
            {
              concept_name: "Explain failed",
              short_definition: resp.error || "Could not explain right now.",
              common_confusions: [],
              when_to_use: [],
              when_not_to_use: [],
              sticky_rule: ""
            },
            highlightedText,
            lastSelectionRect,
            questionId
          );
          return;
        }

        const data = resp.explanation || {};
        if (!data.short_definition && !data.concept_name) {
          data.short_definition = "No explanation returned.";
        }
        renderResultCard(root, data, highlightedText, lastSelectionRect, questionId);
      });
    } catch (err) {
      removePendingCard();
      log("HighlightExplain", "Explain send failed", err);
      renderResultCard(
        root,
        { concept_name: "Explain failed", short_definition: "Extension context unavailable." },
        highlightedText,
        lastSelectionRect,
        questionId
      );
    }
  }

  function playSelectionFromRoot(root) {
    const wrapper =
      (root && root.querySelector && root.querySelector(".cz-tts-wrapper")) ||
      document.querySelector(".cz-tts-wrapper");
    if (!wrapper) {
      log("HighlightExplain", "No cz-tts-wrapper found for play-selection");
      return;
    }
    const btn = wrapper.querySelector("button[data-action='play-selection']");
    if (btn) {
      btn.click();
      return;
    }
    log("HighlightExplain", "play-selection button not found");
  }

  document.addEventListener("mouseup", (evt) => {
    if (bubbleEl && evt && evt.target && bubbleEl.contains(evt.target)) {
      // Clicked inside bubble; don't clear it before the click handler runs.
      return;
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text || text.length < 2) {
      removeBubble();
      return;
    }

    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const root = findQuestionRoot(
      container.nodeType === 1 ? container : container.parentElement
    );
    if (!root) {
      removeBubble();
      return;
    }

    showBubble(range, (action) => {
      if (action === "play-selection") {
        playSelectionFromRoot(root);
        return;
      }
      explainSelection(root, range, text, false);
    });
  });

  document.addEventListener("keyup", (evt) => {
    if (evt.key === "Escape") {
      removeBubble();
    }
  });

  function updateBubblePositionOnScroll() {
    if (!bubbleEl || !lastSelectionRange) return;
    positionBubbleFromRange(lastSelectionRange);
  }

  window.addEventListener("scroll", updateBubblePositionOnScroll, { passive: true });
  window.addEventListener("resize", updateBubblePositionOnScroll, { passive: true });


  window.czUI = window.czUI || {};
  window.czUI.highlightExplain = {
    removeBubble
  };
})();
