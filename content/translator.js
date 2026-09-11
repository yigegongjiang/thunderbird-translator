"use strict";

(() => {
  if (window.__ollamaTranslatorLoaded) return;
  window.__ollamaTranslatorLoaded = true;

  console.log("[Translator] Content script loaded");

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED",
    "SVG", "MATH", "CODE", "TEXTAREA", "INPUT",
  ]);

  const BLOCK_TAGS = new Set([
    "P", "DIV", "TD", "TH", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
    "BLOCKQUOTE", "CAPTION", "DT", "DD", "FIGCAPTION", "ARTICLE", "SECTION",
    "HEADER", "FOOTER", "TR", "PRE",
  ]);

  const MIN_BLOCK_LENGTH = 3;

  const nodeMap = new Map();
  let isTranslated = false;
  let isTranslating = false;
  let translationCached = false;
  let cachedLang = null;

  // --- Port to background ---

  const port = browser.runtime.connect({ name: "translator" });
  const pendingRequests = new Map(); // text translate requests
  const exemptionPendingRequests = new Map(); // exemption check requests
  const capabilityPendingRequests = new Map(); // backend capability probes
  let nextRequestId = 0;

  port.onMessage.addListener(async (message) => {
    // Backend capability response
    if (message.id != null && capabilityPendingRequests.has(message.id)) {
      const { resolve, reject } = capabilityPendingRequests.get(message.id);
      capabilityPendingRequests.delete(message.id);
      if (message.success) resolve({ structured: message.structured });
      else reject(new Error(message.error));
      return;
    }
    // Exemption check response
    if (message.id != null && exemptionPendingRequests.has(message.id)) {
      const { resolve, reject } = exemptionPendingRequests.get(message.id);
      exemptionPendingRequests.delete(message.id);
      if (message.success) resolve({ shouldRevert: message.shouldRevert, skip: message.skip, detectedLang: message.detectedLang });
      else reject(new Error(message.error));
      return;
    }
    // Text translate response
    if (message.id != null && pendingRequests.has(message.id)) {
      const { resolve, reject } = pendingRequests.get(message.id);
      pendingRequests.delete(message.id);
      if (message.success) resolve(message.translated);
      else reject(new Error(message.error));
      return;
    }

    // Commands from popup (via background)
    if (message.command === "doTranslate") {
      const result = await startTranslation(message.targetLang || null);
      port.postMessage({ command: "translateDone", reqId: message.reqId, isTranslated, ...result });
      return;
    }
    if (message.command === "doRevert") {
      reloadPage();
      port.postMessage({ command: "revertDone", reqId: message.reqId, isTranslated: false, success: true });
      return;
    }
    if (message.command === "getState") {
      port.postMessage({ command: "stateDone", reqId: message.reqId, isTranslated, success: true });
      return;
    }
  });

  // `structured` tells the background whether the payload carries #n# / [[n]]
  // markers, so it can append the rules that keep them in the reply.
  function sendTranslateRequest(text, structured) {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pendingRequests.set(id, { resolve, reject });
      port.postMessage({ command: "translate", id, text, structured: !!structured });
    });
  }

  function sendCapabilitiesRequest() {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      capabilityPendingRequests.set(id, { resolve, reject });
      port.postMessage({ command: "capabilities", id });
    });
  }

  function sendPreflightRequest() {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      exemptionPendingRequests.set(id, { resolve, reject });
      port.postMessage({ command: "preflight", id });
    });
  }

  function sendCheckExemptionRequest() {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      exemptionPendingRequests.set(id, { resolve, reject });
      port.postMessage({ command: "checkExemption", id });
    });
  }

  // --- DOM Text Extraction ---

  function getBlockParent(node) {
    let el = node.parentElement;
    while (el && el !== document.body) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function isVisible(node) {
    const el = node.parentElement;
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  // Anchor text that is just the URL itself carries no meaning and only invites
  // the model to rewrite it, so it stays in the DOM untouched.
  function isBareUrl(text) {
    return /^(?:https?:\/\/|www\.)\S+$/i.test(text)
        || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text);
  }

  // One block = one block-level element, split into the text nodes it is made of.
  // Inline nodes (link labels, bold runs) stay inside their block so the model
  // receives a whole sentence instead of disconnected fragments, and `gap` records
  // what separated two nodes (a space, or a <br>) so the sentence reads naturally.
  // lead/trail keep each node's own whitespace, which is what makes the write-back
  // land with exactly the spacing the original markup had.
  function extractTextBlocks() {
    const blocks = new Map();
    let blockId = 0;
    let sawBreak = false;
    let lastBlockEl = null;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.id && node.id.startsWith("__translator_")) return NodeFilter.FILTER_REJECT;
            if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
            return (node.tagName === "BR" || node.tagName === "HR")
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
          if (node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
          if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE) { sawBreak = true; continue; }

      const blockEl = getBlockParent(node);
      if (!blocks.has(blockEl)) {
        blocks.set(blockEl, { id: blockId++, el: blockEl, segments: [], pendingGap: "" });
      }
      const block = blocks.get(blockEl);

      // A <br> only separates two nodes of the same block; one seen inside a
      // nested block (<div>a<p>x<br>y</p>b</div>) must not leak onto `b`.
      if (blockEl !== lastBlockEl) sawBreak = false;
      lastBlockEl = blockEl;

      // Re-extracting after a language switch must see the untranslated text.
      const raw = nodeMap.get(node)?.original ?? node.textContent;
      const core = raw.trim();

      if (sawBreak) block.pendingGap = "\n";
      else if (/^\s/.test(raw) && block.pendingGap !== "\n") block.pendingGap = " ";
      sawBreak = false;

      // Whitespace-only and bare-URL nodes are never rewritten, so they only
      // contribute the separator that keeps neighbouring words apart.
      if (core === "" || isBareUrl(core)) {
        if (block.pendingGap !== "\n") block.pendingGap = " ";
        continue;
      }

      block.segments.push({
        node,
        lead: raw.slice(0, raw.length - raw.trimStart().length),
        core,
        trail: raw.slice(raw.trimEnd().length),
        gap: block.segments.length === 0 ? "" : block.pendingGap,
      });
      block.pendingGap = /\s$/.test(raw) ? " " : "";
    }

    return Array.from(blocks.values()).filter(b =>
      b.segments.length > 0 &&
      b.segments.reduce((n, s) => n + s.core.length, 0) >= MIN_BLOCK_LENGTH
    );
  }

  // --- Wire formats ---
  //
  // structured (LLM backends): every block keeps an #n# id so a merged or dropped
  // paragraph can no longer shift every later block onto the wrong node, and every
  // inline fragment keeps an [[n]] marker so the model translates the sentence as a
  // whole and still tells us which words belong back inside the <a> / <b>.
  //
  // legacy (Google / LibreTranslate, and the fallback when markers come back
  // broken): one line per node, blocks separated by a blank line, mapped by position.

  // Newlines inside a node are pure source formatting (HTML collapses them), and
  // both wire formats use \n structurally, so they are flattened before sending.
  const flatten = (seg) => seg.core.replace(/\s+/g, " ");

  function serializeStructured(blocks) {
    return blocks.map((b) => {
      const multi = b.segments.length > 1;
      const body = b.segments.map((s, i) => s.gap + (multi ? `[[${i}]]` : "") + flatten(s)).join("");
      return `#${b.id}# ${body}`;
    }).join("\n\n");
  }

  function serializeLegacy(blocks) {
    return blocks.map(b => b.segments.map(flatten).join("\n")).join("\n\n");
  }

  function parseBlockIds(raw) {
    const byId = new Map();
    const parts = raw.split(/^[ \t]*#(\d+)#[ \t]*/m);
    for (let i = 1; i < parts.length; i += 2) {
      const id = Number(parts[i]);
      if (!byId.has(id)) byId.set(id, parts[i + 1] ?? "");
    }
    return byId;
  }

  // --- Translation Logic ---

  function writeSegment(seg, text) {
    const existing = nodeMap.get(seg.node);
    const value = seg.lead + text + seg.trail;
    nodeMap.set(seg.node, {
      original: existing?.original ?? seg.node.textContent,
      translated: value,
    });
    seg.node.textContent = value;
  }

  // Returns false when the markers came back unusable, so the caller can retry the
  // block on the legacy protocol instead of writing scrambled text into the DOM.
  function applyStructured(block, translation) {
    if (block.segments.length === 1) {
      const text = translation.replace(/\[\[\s*\d+\s*\]\]/g, "").trim();
      if (!text) return false;
      writeSegment(block.segments[0], text);
      return true;
    }

    // Fragments are written back in the order the model emitted them, not by
    // marker id. Where the node sits is fixed by the DOM, so an EN->JA reply that
    // legitimately fronts [[2]] would otherwise drop its words into the last node
    // and render as gibberish. Output order keeps the sentence readable; when the
    // markers do come back ascending the two orders are identical anyway.
    // The ids are still checked, so a dropped, duplicated or invented marker
    // rejects the block and sends it to the legacy retry.
    const parts = translation.split(/\[\[\s*(\d+)\s*\]\]/);
    const ordered = [];
    const seen = new Set();
    for (let i = 1; i < parts.length; i += 2) {
      const id = Number(parts[i]);
      const text = (parts[i + 1] ?? "").trim();
      if (!text || seen.has(id) || id >= block.segments.length) return false;
      seen.add(id);
      ordered.push(text);
    }
    if (ordered.length !== block.segments.length) return false;
    for (let i = 0; i < ordered.length; i++) writeSegment(block.segments[i], ordered[i]);
    return true;
  }

  function applyLegacy(block, translation) {
    const lines = translation.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    if (block.segments.length === 1) {
      writeSegment(block.segments[0], lines.join(" "));
      return true;
    }
    const n = block.segments.length;
    if (lines.length > n) {
      // Surplus lines are folded in rather than dropped: losing them is silent
      // data loss. They go to the last segment that is not a link label, since
      // overflowing an <a> would swallow the rest of the sentence into the link.
      let tail = n - 1;
      while (tail > 0 && block.segments[tail].node.parentElement?.tagName === "A") tail--;
      lines[tail] = [lines[tail], ...lines.slice(n)].join(" ");
      lines.length = n;
    }
    const written = Math.min(lines.length, n);
    for (let i = 0; i < written; i++) writeSegment(block.segments[i], lines[i]);
    return written === n;
  }

  async function translateNodeByNode(block) {
    for (const seg of block.segments) {
      if (seg.node.parentElement?.tagName === "A") continue;
      if (seg.core.length < MIN_BLOCK_LENGTH) continue;
      const translated = await sendTranslateRequest(seg.core, false);
      if (translated && translated.trim()) writeSegment(seg, translated.trim());
    }
  }

  async function translateBlocks(blocks, structured) {
    const payload = structured ? serializeStructured(blocks) : serializeLegacy(blocks);
    const raw = await sendTranslateRequest(payload, structured);

    if (!structured) {
      const parts = raw.split(/\n{2,}/);
      for (let i = 0; i < blocks.length; i++) {
        const part = parts[i];
        if (part && part.trim()) applyLegacy(blocks[i], part.trim());
      }
      return;
    }

    const byId = parseBlockIds(raw);
    const retry = [];
    for (const block of blocks) {
      const translation = byId.get(block.id);
      if (translation == null || !applyStructured(block, translation)) retry.push(block);
    }
    // Markers dropped or mangled: one retry on the plain protocol beats leaving
    // those blocks untranslated, and it cannot recurse further.
    if (retry.length > 0) await translateBlocks(retry, false);
  }

  async function startTranslation(targetLang) {
    if (isTranslating) return { success: false, error: "Translation already in progress" };
    isTranslating = true;
    try {
      // Invalidate cache if language changed
      if (targetLang && targetLang !== cachedLang) {
        translationCached = false;
        for (const [node, data] of nodeMap.entries()) {
          nodeMap.set(node, { original: data.original, translated: null });
        }
      }

      // Use cache if available
      if (translationCached && nodeMap.size > 0) {
        for (const [node, data] of nodeMap.entries()) {
          if (document.body.contains(node) && data.translated) {
            node.textContent = data.translated;
          }
        }
        isTranslated = true;
        return { success: true };
      }

      const blocks = extractTextBlocks();
      if (blocks.length === 0) return { success: false, error: "No text to translate" };

      const preBlocks   = blocks.filter(b => b.el.tagName === "PRE");
      const flowBlocks  = blocks.filter(b => b.el.tagName !== "PRE");

      // Only the LLM backends can be asked to keep the block / inline markers.
      let structured = false;
      try {
        structured = !!(await sendCapabilitiesRequest()).structured;
      } catch (e) {
        console.warn("[Translator] Capability probe failed, using plain protocol:", e.message);
      }

      for (const block of preBlocks) await translateNodeByNode(block);
      if (flowBlocks.length > 0) await translateBlocks(flowBlocks, structured);

      isTranslated = true;
      translationCached = true;
      if (targetLang) cachedLang = targetLang;

      return { success: true };
    } catch (e) {
      const msg = (e.message.includes("Failed to fetch") || e.message.includes("NetworkError"))
        ? "Server unreachable"
        : e.message;
      return { success: false, error: msg };
    } finally {
      isTranslating = false;
    }
  }


  function reloadPage() {
    for (const [node, data] of nodeMap.entries()) {
      try {
        if (document.body.contains(node)) node.textContent = data.original;
      } catch (e) {
        console.error("[Translator] Error restoring node:", e);
      }
    }
    isTranslated = false;
  }

  // Auto-translate on load if setting is enabled
  browser.storage.local.get({ autoTranslate: false }).then(async (s) => {
    if (!s.autoTranslate) return;

    // Ask first whether this message needs translating at all, so an email
    // already in the target language never reaches the translation API.
    // Runs before setBadge so a skip leaves no badge stuck on "...".
    try {
      const { skip } = await sendPreflightRequest();
      if (skip) return;
    } catch (e) {
      console.warn("[Translator] Preflight failed, translating anyway:", e.message);
    }

    port.postMessage({ command: "setBadge" });
    const result = await startTranslation();

    if (result.success) {
      // After translation, check if the detected source language is in the never-translate list.
      // The detected lang is cached in background from the translation API response.
      try {
        const { shouldRevert } = await sendCheckExemptionRequest();
        if (shouldRevert) {
          reloadPage();
          port.postMessage({ command: "clearBadge", success: true });
          return;
        }
      } catch (e) {
        console.warn("[Translator] Exemption check failed, keeping translation:", e.message);
      }
    }

    port.postMessage({ command: "clearBadge", success: result.success, error: result.error });
  });

  console.log("[Translator] Ready");
})();
