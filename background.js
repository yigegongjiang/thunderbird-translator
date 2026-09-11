"use strict";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
// Not translategemma: it is trained only on its own JSON payload schema
// ({type, source_lang_code, target_lang_code, text}) and treats anything else in
// the turn as source text to translate, so it would translate the rules below
// instead of following them. The default has to be an instruction-tuned model.
const DEFAULT_MODEL = "gemma3:4b";
const DEFAULT_SERVICE = "google";
const DEFAULT_LIBRE_URL = "https://libretranslate.com";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

// The whole email body is sent as one string: blocks joined by a blank line,
// lines inside a block by a single newline. Google and LibreTranslate get only
// that, and content/translator.js maps the reply back to DOM nodes by index, so
// a model that merges paragraphs or inserts a blank line shifts every following
// paragraph into the wrong place. Hence the layout rule below. The LLM backends
// additionally get #n# block ids and [[n]] inline markers (see STRUCTURE_RULES),
// which make the mapping explicit instead of positional.
const DEFAULT_TRANSLATE_PROMPT =
`You are a professional translator. Translate the text inside the <text> tags into {TARGET_LANG} ({TARGET_CODE}).
Source language: {SOURCE_LANG} ({SOURCE_CODE}).

Rules:
1. Keep the layout identical: the same number of blank-line-separated paragraphs, and the same number of lines inside each paragraph. Never merge, split, reorder, add or drop a line or a blank line.
2. Translate meaning, tone and register, not words. The result must read as natural, idiomatic {TARGET_LANG} written by a native speaker.
3. This is email: keep the original level of formality, and render greetings, sign-offs and honorifics the way a native {TARGET_LANG} email would.
4. Leave URLs, email addresses, file names, numbers, dates and code verbatim. Keep personal, company and product names in their original form unless a standard {TARGET_LANG} form exists.
5. A line already written in {TARGET_LANG} is copied through unchanged.
6. Output the translation only: no explanations, notes, quotes or code fences.

<text>{TEXT}</text>`;

// Appended after the user's translation prompt, never inside it: a saved custom
// prompt would otherwise silently lose the rules that keep the markers alive.
const STRUCTURE_RULES =
`

Formatting rules for the text above (it is machine-generated markup, follow them exactly):
- The text is a list of blocks separated by a blank line. Each block starts with an id marker like #0# .
- Reply with every block in the same order, each one starting with its own unchanged #n# marker at the start of a line. Never merge, split, reorder, renumber, add or drop blocks.
- Inside a block, markers like [[0]] [[1]] mark where a styled fragment (a link label, bold text, ...) begins. Keep every [[n]] marker exactly once, unchanged, and in ascending order: [[0]] first, then [[1]], then [[2]].
- Translate each fragment where it stands. If the target language would naturally move those words to another part of the sentence, leave the fragment in place and adapt the wording around it instead. Reordering the markers scrambles the message.
- The markers are not part of the text: never translate them, never describe them. Output only the markers and the translation, no commentary.
- A reply block therefore looks like: #0# [[0]]translated words[[1]]translated words[[2]]translated words`;

const DEFAULT_DETECT_PROMPT =
`Identify the dominant language of the text inside the <text> tags: the language most of the text is written in. Ignore quoted replies, signatures, disclaimers and isolated foreign words.
Reply with ONLY the ISO 639-1 two-letter language code.
Examples: "en" for English, "tl" for Filipino/Tagalog, "fr" for French, "de" for German,
"es" for Spanish, "ja" for Japanese, "zh" for Chinese, "ko" for Korean, "ar" for Arabic.
No explanation. Just the two-letter code.

<text>{TEXT}</text>`;

const LANGUAGE_NAMES = {
  en: "English",
  it: "Italiano",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
  pt: "Português",
  ru: "Русский",
  ja: "日本語",
  zh: "中文",
  ko: "한국어",
  ar: "العربية",
  tr: "Türkçe",
  pl: "Polski",
  tl: "Filipino",
};

// Only used to rescue a detection reply that came back as a name, not a code.
const LANGUAGE_NAMES_EN = {
  en: "english", it: "italian", es: "spanish", fr: "french", de: "german",
  nl: "dutch", pt: "portuguese", ru: "russian", ja: "japanese", zh: "chinese",
  ko: "korean", ar: "arabic", tr: "turkish", pl: "polish", tl: "tagalog",
};

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "nl", label: "Nederlands" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "ko", label: "한국어" },
  { value: "ar", label: "العربية" },
  { value: "tr", label: "Türkçe" },
  { value: "pl", label: "Polski" },
  { value: "tl", label: "Filipino" },
];

function uiDefaultLang() {
  const ui = String(messenger.i18n.getUILanguage() || "").toLowerCase();
  const base = ui.split(/[-_]/)[0];
  return LANGUAGE_NAMES[base] ? base : "en";
}

const DEFAULT_TARGET_LANG = uiDefaultLang();

const LANG_STORAGE_KEY = {
  ollama: "ollamaTargetLang",
  openai: "openaiTargetLang",
  google: "googleTargetLang",
  libretranslate: "libreTargetLang",
};

const COMPOSE_LANG_KEY = {
  ollama: "ollamaComposeLang",
  openai: "openaiComposeLang",
  google: "googleComposeLang",
  libretranslate: "libreComposeLang",
};

// --- Settings ---

async function updateReadButtonTitle() {
  const settings = await messenger.storage.local.get({
    service: DEFAULT_SERVICE,
    ollamaTargetLang: DEFAULT_TARGET_LANG,
    openaiTargetLang: DEFAULT_TARGET_LANG,
    googleTargetLang: DEFAULT_TARGET_LANG,
    libreTargetLang: DEFAULT_TARGET_LANG,
  });
  const langKey = LANG_STORAGE_KEY[settings.service] || "googleTargetLang";
  const lang = (settings[langKey] || DEFAULT_TARGET_LANG).toUpperCase();
  messenger.messageDisplayAction.setTitle({ title: `Translate (${lang})` });
}

async function updateComposeButtonTitle() {
  const settings = await messenger.storage.local.get({
    service: DEFAULT_SERVICE,
    ollamaComposeLang: DEFAULT_TARGET_LANG,
    openaiComposeLang: DEFAULT_TARGET_LANG,
    googleComposeLang: DEFAULT_TARGET_LANG,
    libreComposeLang: DEFAULT_TARGET_LANG,
  });
  const langKey = COMPOSE_LANG_KEY[settings.service] || "googleComposeLang";
  const lang = (settings[langKey] || DEFAULT_TARGET_LANG).toUpperCase();
  messenger.composeAction.setTitle({ title: `Translate (${lang})` });
}

async function getSettings() {
  return messenger.storage.local.get({
    ollamaUrl: DEFAULT_OLLAMA_URL,
    model: DEFAULT_MODEL,
    detectionModel: "",
    service: DEFAULT_SERVICE,
    ollamaTargetLang: DEFAULT_TARGET_LANG,
    googleTargetLang: DEFAULT_TARGET_LANG,
    libreTargetLang: DEFAULT_TARGET_LANG,
    openaiTargetLang: DEFAULT_TARGET_LANG,
    ollamaComposeLang: DEFAULT_TARGET_LANG,
    googleComposeLang: DEFAULT_TARGET_LANG,
    libreComposeLang: DEFAULT_TARGET_LANG,
    openaiComposeLang: DEFAULT_TARGET_LANG,
    libreUrl: DEFAULT_LIBRE_URL,
    ollamaApiKey: "",
    libreApiKey: "",
    autoTranslate: false,
    neverTranslateLangs: [],
    ollamaTranslatePrompt: "",
    ollamaDetectPrompt: "",
    openaiUrl: DEFAULT_OPENAI_URL,
    openaiApiKey: "",
    openaiModel: "",
    openaiDetectionModel: "",
    openaiTranslatePrompt: "",
    openaiDetectPrompt: "",
  });
}

// --- Register content scripts ---

if (messenger.messageDisplayScripts) {
  messenger.messageDisplayScripts.register({
    js: [{ file: "content/translator.js" }],
  }).then(() => {
    console.log("[Translator] messageDisplayScripts registered");
  }).catch(e => {
    console.warn("[Translator] messageDisplayScripts.register failed:", e.message);
  });
}

if (messenger.composeScripts) {
  messenger.composeScripts.register({
    js: [{ file: "content/composer.js" }],
  }).then(() => {
    console.log("[Translator] composeScripts registered");
  }).catch(e => {
    console.warn("[Translator] composeScripts.register failed:", e.message);
  });
}

updateReadButtonTitle();
updateComposeButtonTitle();

// --- Detected language cache (tabId → lang code) ---
// Google/LT: populated from translation API responses.
// Ollama: populated by a separate detectWithOllama() call after translation.
// Cleared when a new message is displayed in that tab.

const detectedLangByTab = new Map();

// Tracks tabs where auto-translate is currently running.
// The Never/Always toggle is disabled while translation is in progress.
const translatingTabs = new Set();

messenger.messageDisplay.onMessageDisplayed.addListener((tab) => {
  if (tab?.id != null) {
    detectedLangByTab.delete(tab.id);
    translatingTabs.delete(tab.id);
    messenger.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "" });
  }
});

messenger.tabs.onRemoved.addListener((tabId) => {
  translatingTabs.delete(tabId);
  portMap.delete(tabId);
  detectedLangByTab.delete(tabId);
});

// --- Port management ---

const portMap        = new Map();
const framePortMap   = new Map();
const composePortMap = new Map();
let lastActivePort   = null;

const pendingPopupRequests = new Map();
let nextPopupReqId = 0;

function sendToTabPort(tabId, command, extra = {}) {
  return new Promise((resolve, reject) => {
    const port = portMap.get(tabId);
    if (!port) { reject(new Error("No content script for this tab")); return; }
    const reqId = nextPopupReqId++;
    const timeoutId = setTimeout(() => {
      pendingPopupRequests.delete(reqId);
      reject(new Error("Content script timeout"));
    }, 30000);
    pendingPopupRequests.set(reqId, { resolve, reject, timeoutId, port });
    port.postMessage({ command, reqId, ...extra });
  });
}

function sendToComposePort(windowId, command, extra = {}) {
  return new Promise((resolve, reject) => {
    const port = composePortMap.get(windowId);
    if (!port) { reject(new Error("No compose content script for this window")); return; }
    const reqId = nextPopupReqId++;
    const timeoutId = setTimeout(() => {
      pendingPopupRequests.delete(reqId);
      reject(new Error("Compose script timeout"));
    }, 30000);
    pendingPopupRequests.set(reqId, { resolve, reject, timeoutId, port });
    port.postMessage({ command, reqId, ...extra });
  });
}

function resolvePending(reqId, result) {
  const pending = pendingPopupRequests.get(reqId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingPopupRequests.delete(reqId);
  pending.resolve(result);
}

messenger.runtime.onConnect.addListener((port) => {

  // --- Read-mode content script ---
  if (port.name === "translator") {
    const tabId   = port.sender?.tab?.id ?? null;
    const frameId = port.sender?.frameId ?? 0;
    const fKey    = `${tabId}-${frameId}`;

    if (tabId != null) portMap.set(tabId, port);
    framePortMap.set(fKey, port);
    lastActivePort = port;

    port.onDisconnect.addListener(() => {
      if (tabId != null && portMap.get(tabId) === port) portMap.delete(tabId);
      framePortMap.delete(fKey);
      if (lastActivePort === port) {
        lastActivePort = portMap.size > 0 ? [...portMap.values()].at(-1) : null;
      }
      if (tabId != null) detectedLangByTab.delete(tabId);
      for (const [reqId, pending] of pendingPopupRequests.entries()) {
        if (pending.port === port) {
          clearTimeout(pending.timeoutId);
          pendingPopupRequests.delete(reqId);
          pending.reject(new Error("Content script disconnected"));
        }
      }
    });

    port.onMessage.addListener(async (message) => {

      // Translate API request
      if (message.command === "translate") {
        try {
          const settings = await getSettings();
          const sourceLang = tabId != null ? (detectedLangByTab.get(tabId) || null) : null;
          const { translated, detectedLang } = await translateText(message.text, settings, null, sourceLang, message.structured);
          // Cache detected lang from translation response (Google / LT). Google
          // answers "zh-CN", which would never equal the "zh" target it is
          // compared against, so it has to be narrowed to the base code first.
          const cached = normalizeLangCode(detectedLang);
          if (tabId != null && cached && !detectedLangByTab.has(tabId)) {
            detectedLangByTab.set(tabId, cached);
          }
          port.postMessage({ id: message.id, success: true, translated });
        } catch (e) {
          port.postMessage({ id: message.id, success: false, error: e.message });
        }
        return;
      }

      // Only the instruction-following backends can be trusted to echo the
      // #n# / [[n]] markers, so the content script asks before serializing.
      if (message.command === "capabilities") {
        try {
          const { service } = await getSettings();
          port.postMessage({
            id: message.id,
            success: true,
            structured: service === "ollama" || service === "openai",
          });
        } catch (e) {
          port.postMessage({ id: message.id, success: false, error: e.message });
        }
        return;
      }

      // Auto-translate preflight: called before any text is translated.
      if (message.command === "preflight") {
        try {
          const result = await shouldAutoTranslate(tabId);
          if (result.skip) {
            console.log(`[Translator] auto-translate skipped (${result.detectedLang}): ${result.reason}`);
          }
          port.postMessage({ id: message.id, success: true, ...result });
        } catch (e) {
          // Detection is a convenience, never a gate: fall through and translate.
          console.warn("[Translator] preflight failed, translating anyway:", e.message);
          port.postMessage({ id: message.id, success: true, skip: false });
        }
        return;
      }

      // Exemption check: called after auto-translate completes.
      // For LLM backends: runs detection here (after translation) if neverTranslateLangs is non-empty.
      if (message.command === "checkExemption") {
        try {
          const settings = await getSettings();
          const { neverTranslateLangs = [] } = settings;
          const targetLang = settings[LANG_STORAGE_KEY[settings.service]] || DEFAULT_TARGET_LANG;
          let detectedLang = tabId != null ? (detectedLangByTab.get(tabId) || null) : null;

          // Preflight normally fills the cache already; this covers a preflight failure.
          if (!detectedLang && tabId != null) {
            try {
              const sample = await getMessageSample(tabId);
              if (sample) {
                detectedLang = await detectLanguage(sample, settings);
                if (detectedLang) detectedLangByTab.set(tabId, detectedLang);
              }
            } catch (e) {
              console.warn("[Translator] language detection failed in checkExemption:", e.message);
            }
          }

          const shouldRevert = !!detectedLang
            && (detectedLang === targetLang || neverTranslateLangs.includes(detectedLang));
          port.postMessage({ id: message.id, success: true, shouldRevert });
        } catch (e) {
          port.postMessage({ id: message.id, success: false, error: e.message });
        }
        return;
      }

      if (["translateDone", "revertDone", "stateDone"].includes(message.command)) {
        resolvePending(message.reqId, message);
        return;
      }

      if (message.command === "setBadge") {
        translatingTabs.add(tabId);
        messenger.messageDisplayAction.setBadgeText({ tabId, text: "..." });
        messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#f90" });
        return;
      }
      if (message.command === "clearBadge") {
        translatingTabs.delete(tabId);
        if (message.success) {
          messenger.messageDisplayAction.setBadgeText({ tabId, text: "✓" });
          messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#1a7f37" });
          setTimeout(() => messenger.messageDisplayAction.setBadgeText({ tabId, text: "" }), 2000);
        } else {
          messenger.messageDisplayAction.setBadgeText({ tabId, text: "!" });
          messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#c00" });
        }
        return;
      }
    });
    return;
  }

  // --- Compose content script ---
  if (port.name === "translator-composer") {
    const windowId = port.sender?.tab?.windowId ?? null;
    if (windowId != null) composePortMap.set(windowId, port);

    port.onDisconnect.addListener(() => {
      if (windowId != null) composePortMap.delete(windowId);
      for (const [reqId, pending] of pendingPopupRequests.entries()) {
        if (pending.port === port) {
          clearTimeout(pending.timeoutId);
          pendingPopupRequests.delete(reqId);
          pending.reject(new Error("Compose script disconnected"));
        }
      }
    });

    port.onMessage.addListener(async (message) => {
      if (message.command === "translate") {
        try {
          const settings = await getSettings();
          const composeLangKey = COMPOSE_LANG_KEY[settings.service] || "googleComposeLang";
          const targetLang = settings[composeLangKey] || DEFAULT_TARGET_LANG;
          const { translated } = await translateText(message.text, settings, targetLang, null);
          port.postMessage({ id: message.id, success: true, translated });
        } catch (e) {
          port.postMessage({ id: message.id, success: false, error: e.message });
        }
        return;
      }
      if (message.command === "translateSelectionDone") {
        resolvePending(message.reqId, message);
      }
    });
    return;
  }
});

// --- Host permissions ---
// Host access is declared in manifest.json under optional_permissions, not
// permissions, so nothing is granted at install time. The options page requests
// the origin for the active service on save; everything here only checks.

const GOOGLE_ORIGIN = "https://translate.google.com/*";

// Ollama endpoints are built by string concatenation, so a trailing slash in the
// configured URL produces "host//api/tags". LibreTranslate already strips it.
function normalizeOllamaUrl(url) {
  return (url || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
}

// The Base URL field holds the API root including any version path
// ("https://api.openai.com/v1"). Never append /v1 here: Ollama and LM Studio
// need it, plenty of gateways are bare. Only tolerate a pasted full endpoint.
function normalizeOpenaiUrl(url) {
  return (url || DEFAULT_OPENAI_URL).replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

// Match patterns carry no port, so http://localhost:11434 becomes http://localhost/*
function originPatternFromUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

function serviceOrigin(settings) {
  switch (settings.service) {
    case "ollama":         return originPatternFromUrl(settings.ollamaUrl);
    case "openai":         return originPatternFromUrl(settings.openaiUrl);
    case "libretranslate": return originPatternFromUrl(settings.libreUrl);
    case "google":         return GOOGLE_ORIGIN;
    default:               return null;
  }
}

async function assertHostPermission(origin, label) {
  if (!origin) throw new Error(`No valid ${label} server URL is configured. Check Preferences.`);
  if (!await messenger.permissions.contains({ origins: [origin] })) {
    throw new Error(`Access to ${origin} has not been granted. Open Preferences and press Save to grant it.`);
  }
}

// --- Translation APIs ---
// All return { translated: string, detectedLang: string|null }

// The default prompts wrap the text in <text> tags, so raw markup in the email
// must not be able to close them early.
function escapeForPrompt(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Models echo the entities back verbatim, and the result is written to
// node.textContent, so without this "AT&T" would render as literal "AT&amp;T".
// &amp; must be last so "&amp;lt;" does not collapse into "<".
function unescapeFromPrompt(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Reasoning models inline their chain of thought in the reply and it must not
// land in the email body. Some chat templates emit the opening <think> for the
// model, so a leftover unmatched </think> also marks the end of the thinking.
function stripReasoning(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

// Shared by the Ollama and OpenAI-compatible backends so both honour the same
// placeholder set documented in the options page.
function buildTranslatePrompt(text, promptTemplate, targetLanguage, sourceLang, structured) {
  const targetLangName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const targetLangCode = (targetLanguage || "").toUpperCase();
  const sourceLangName = sourceLang ? (LANGUAGE_NAMES[sourceLang] || sourceLang.toUpperCase()) : "unknown";
  const sourceLangCode = sourceLang ? sourceLang.toUpperCase() : "auto";
  const safeText = escapeForPrompt(text);
  // The rules are appended before substitution, not after, so they may use the
  // same placeholders as the user's template.
  return (promptTemplate + (structured ? STRUCTURE_RULES : ""))
    .replace(/{SOURCE_LANG}/g, sourceLangName)
    .replace(/{SOURCE_CODE}/g, sourceLangCode)
    .replace(/{TARGET_LANG}/g, targetLangName)
    .replace(/{TARGET_CODE}/g, targetLangCode)
    .replace(/{TEXT}/g, safeText)
    .replace(/{targetLanguage}/g, targetLangName)
    .replace(/{text}/g, safeText);
}

async function translateWithOllama(text, settings) {
  const { model, targetLanguage, ollamaApiKey, ollamaTranslatePrompt, sourceLang, structured } = settings;
  const ollamaUrl = normalizeOllamaUrl(settings.ollamaUrl);
  const prompt = buildTranslatePrompt(text, ollamaTranslatePrompt || DEFAULT_TRANSLATE_PROMPT, targetLanguage, sourceLang, structured);

  const headers = { "Content-Type": "application/json" };
  if (ollamaApiKey) headers["Authorization"] = `Bearer ${ollamaApiKey}`;

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!response.ok) {
    if (response.status === 404)
      throw new Error(`Ollama model "${model}" not found. Please run: ollama pull ${model}`);
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const translated = unescapeFromPrompt(stripReasoning((await response.json()).response));
  return { translated, detectedLang: null }; // Ollama detection is a separate call
}

// --- OpenAI-compatible Chat Completions backend ---
// Covers api.openai.com and anything speaking the same shape (Ollama's /v1,
// LM Studio, vLLM, OpenRouter, LiteLLM, DeepSeek, Groq, ...).

// No temperature / max_tokens is sent on purpose: the reasoning models reject
// `temperature` and renamed `max_tokens`, and the defaults are fine for translation.
async function openaiChat(baseUrl, apiKey, model, prompt, label) {
  if (!model) throw new Error(`No ${label} model configured. Open Preferences and set one.`);

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${label} error: ${response.status} ${response.statusText}`
      + (detail ? ` - ${detail.substring(0, 200)}` : ""));
  }

  const data = await response.json();
  if (data?.error) throw new Error(`${label} API error: ${data.error.message || data.error}`);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`Invalid response from ${label}`);

  return stripReasoning(content);
}

async function translateWithOpenAI(text, settings) {
  const { openaiApiKey, openaiModel, openaiTranslatePrompt, targetLanguage, sourceLang, structured } = settings;
  const baseUrl = normalizeOpenaiUrl(settings.openaiUrl);
  const prompt = buildTranslatePrompt(text, openaiTranslatePrompt || DEFAULT_TRANSLATE_PROMPT, targetLanguage, sourceLang, structured);
  const translated = unescapeFromPrompt(await openaiChat(baseUrl, openaiApiKey, openaiModel, prompt, "OpenAI-compatible API"));
  if (!translated) throw new Error("OpenAI-compatible API returned an empty translation");
  return { translated, detectedLang: null }; // detection is a separate call
}

async function getOpenaiModels(openaiUrl, apiKey) {
  const baseUrl = normalizeOpenaiUrl(openaiUrl);
  await assertHostPermission(originPatternFromUrl(baseUrl), "OpenAI-compatible API");

  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) throw new Error(`OpenAI-compatible API error: ${response.status} ${response.statusText}`);

  const data = await response.json();
  const models = (data?.data || data?.models || [])
    .map(m => (typeof m === "string" ? m : m.id || m.name))
    .filter(Boolean);
  if (!models.length) throw new Error("Endpoint reachable, but /models listed nothing");
  return models.sort();
}

async function translateWithGoogle(text, targetLanguage) {
  const params = new URLSearchParams({
    client: "gtx", sl: "auto", tl: targetLanguage, dt: "t", q: text,
  });
  const response = await fetch(`https://translate.google.com/translate_a/single?${params}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!response.ok) throw new Error(`Google Translate error: ${response.status}`);
  const data = await response.json();
  if (data?.[0] && Array.isArray(data[0])) {
    const translated = data[0].filter(p => p?.[0]).map(p => p[0]).join("").trim();
    if (translated) return { translated, detectedLang: data[2] || null };
  }
  throw new Error("Invalid response from Google Translate");
}

async function translateWithLibreTranslate(text, targetLanguage, libreUrl, libreApiKey) {
  const base = (libreUrl || DEFAULT_LIBRE_URL).replace(/\/+$/, "");
  const endpoint = base.endsWith("/translate") ? base : base + "/translate";
  const body = { q: text, source: "auto", target: targetLanguage };
  if (libreApiKey) body.api_key = libreApiKey;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LibreTranslate error: ${response.status} - ${err.substring(0, 100)}`);
  }
  const data = await response.json();
  if (data?.translatedText) {
    return {
      translated: data.translatedText.trim(),
      detectedLang: data.detectedLanguage?.language || null,
    };
  }
  if (data?.error) throw new Error(`LibreTranslate API error: ${data.error}`);
  throw new Error("Invalid response from LibreTranslate");
}

async function translateText(text, settings, targetLangOverride, sourceLang, structured) {
  const { service, libreUrl, libreApiKey } = settings;
  const targetLang = targetLangOverride
    || settings[LANG_STORAGE_KEY[service]]
    || DEFAULT_TARGET_LANG;
  await assertHostPermission(serviceOrigin(settings), service);
  switch (service) {
    case "ollama":         return translateWithOllama(text, { ...settings, targetLanguage: targetLang, sourceLang: sourceLang || null, structured: !!structured });
    case "openai":         return translateWithOpenAI(text, { ...settings, targetLanguage: targetLang, sourceLang: sourceLang || null, structured: !!structured });
    case "google":         return translateWithGoogle(text, targetLang);
    case "libretranslate": return translateWithLibreTranslate(text, targetLang, libreUrl, libreApiKey);
    default: throw new Error(`Unknown service: ${service}`);
  }
}

// --- Ollama language detection (separate from translation) ---

async function detectWithOllama(sample, settings) {
  const { ollamaApiKey, detectionModel, model, ollamaDetectPrompt } = settings;
  const ollamaUrl = normalizeOllamaUrl(settings.ollamaUrl);
  const detectModel = (detectionModel || "").trim() || model;
  const promptTemplate = ollamaDetectPrompt || DEFAULT_DETECT_PROMPT;
  const safeSample = sample.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const prompt = promptTemplate.replace(/{text}/g, safeSample).replace(/{TEXT}/g, safeSample);

  await assertHostPermission(originPatternFromUrl(ollamaUrl), "Ollama");

  const headers = { "Content-Type": "application/json" };
  if (ollamaApiKey) headers["Authorization"] = `Bearer ${ollamaApiKey}`;

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: detectModel, prompt, stream: false }),
  });
  if (!response.ok) throw new Error(`Ollama detection error: ${response.status}`);

  const raw = stripReasoning((await response.json()).response);
  const code = parseLangCode(raw);
  if (!code) throw new Error(`Could not parse language code from Ollama detection: "${raw}"`);
  return code;
}

// Models rarely answer with a bare code, so try three readings before giving up.
function parseLangCode(rawResponse) {
  const raw = (rawResponse || "").trim().toLowerCase();

  // 1. Strict: response starts with a known 2-3 char code
  const strictMatch = raw.match(/^([a-z]{2,3})\b/);
  if (strictMatch && LANGUAGE_NAMES[strictMatch[1]]) return strictMatch[1];

  // 2. Reverse-lookup: model answered with a language name instead of a code.
  //    LANGUAGE_NAMES holds endonyms (日本語, Русский), which a model asked in
  //    English almost never writes, so the English names are checked as well.
  for (const [code, name] of Object.entries(LANGUAGE_NAMES)) {
    if (raw.includes(name.toLowerCase())) return code;
  }
  for (const [code, name] of Object.entries(LANGUAGE_NAMES_EN)) {
    if (raw.includes(name)) return code;
  }

  // 3. Scan for any known code anywhere in the response
  const tokens = raw.match(/\b[a-z]{2,3}\b/g) || [];
  for (const token of tokens) {
    if (LANGUAGE_NAMES[token]) return token;
  }

  return null;
}

async function detectWithOpenAI(sample, settings) {
  const { openaiApiKey, openaiModel, openaiDetectionModel, openaiDetectPrompt } = settings;
  const baseUrl = normalizeOpenaiUrl(settings.openaiUrl);
  const detectModel = (openaiDetectionModel || "").trim() || openaiModel;
  const safeSample = escapeForPrompt(sample);
  const prompt = (openaiDetectPrompt || DEFAULT_DETECT_PROMPT)
    .replace(/{text}/g, safeSample)
    .replace(/{TEXT}/g, safeSample);

  await assertHostPermission(originPatternFromUrl(baseUrl), "OpenAI-compatible API");

  const raw = await openaiChat(baseUrl, openaiApiKey, detectModel, prompt, "OpenAI-compatible detection");
  const code = parseLangCode(raw);
  if (!code) throw new Error(`Could not parse language code from OpenAI-compatible detection: "${raw}"`);
  return code;
}

// Auto-translate preflight: answers "does this message need translating at all"
// before any body text is sent anywhere. Runs for every service, because the
// first two detection stages are local (see detectLanguage).
async function shouldAutoTranslate(tabId) {
  const settings = await getSettings();
  if (tabId == null) return { skip: false };

  const targetLang = settings[LANG_STORAGE_KEY[settings.service]] || DEFAULT_TARGET_LANG;
  let detectedLang = detectedLangByTab.get(tabId) || null;

  if (!detectedLang) {
    const sample = await getMessageSample(tabId);
    // Both failures end in a full translation, which is the safe default but also
    // the thing a user reports as "it translated my own language again". Without
    // these two lines there is nothing in the console to tell the two apart.
    if (!sample) {
      console.log("[Translator] no body sample for detection; translating");
      return { skip: false };
    }
    detectedLang = await detectLanguage(sample, settings);
    if (!detectedLang) {
      console.log(`[Translator] language undetermined from ${sample.length} chars; translating: "${sample.slice(0, 60)}"`);
      return { skip: false };
    }
    // Also spares menus.onShown its own on-demand detection later.
    detectedLangByTab.set(tabId, detectedLang);
  }

  if (detectedLang === targetLang) {
    return { skip: true, detectedLang, reason: "already in the target language" };
  }
  if ((settings.neverTranslateLangs || []).includes(detectedLang)) {
    return { skip: true, detectedLang, reason: "on the never-translate list" };
  }
  return { skip: false, detectedLang };
}

// --- Language detection ----------------------------------------------------
//
// Three stages, most certain first:
//   1. detectByScript  — Unicode character census. Local, deterministic, and the
//      only stage that survives an email being half boilerplate.
//   2. i18n.detectLanguage (CLD2) — the Latin-script languages, which a census
//      cannot tell apart.
//   3. the configured LLM backend — last resort, Ollama / OpenAI-compatible only.

const DETECT_SAMPLE_LIMIT = 4000;   // chars handed to the classifier

// "zh-CN" / "zh-Hant" -> "zh". Everything downstream compares against the plain
// two-letter codes in LANGUAGE_NAMES; an unknown language is null, not a guess.
function normalizeLangCode(code) {
  if (!code) return null;
  const base = String(code).split("-")[0].toLowerCase();
  return LANGUAGE_NAMES[base] ? base : null;
}

// Everything that carries no language signal is removed before counting: a
// Chinese body wrapped in an English footer of tracking links otherwise reads as
// English, to CLD2 and to a census alike.
function cleanSample(text) {
  return String(text || "")
    .replace(/^\s*[>|].*$/gm, " ")                  // quoted reply lines
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")      // URLs
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, " ")      // addresses
    .replace(/&[a-z]+;|&#\d+;/gi, " ")              // entity leftovers
    .replace(/[\d_=+*\/\\[\]{}()<>|~^`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One CJK character carries about as much text as this many Latin letters. The
// weight is the whole point: an 80-character Chinese body is a complete message,
// 80 Latin letters is one line, and comparing them raw is what let a six-line
// English disclaimer outvote the Chinese mail it was stapled to.
const CJK_WEIGHT = 2.5;

// Two gates per script. Dominant: a clean message written in it, which needs a
// high share because a three-line English reply signed off with a Chinese company
// name sits near 0.6 and must not count. Diluted: a real message buried under an
// English footer, disclaimer or unsubscribe block, which is allowed a low share
// only once there is enough of the script to be a body rather than a signature.
function scriptWins(count, latin, weight) {
  if (count === 0) return false;
  const share = (count * weight) / (count * weight + latin);
  return (count >= 8 && share >= 0.75) || (count >= 30 && share >= 0.15);
}

// Character-class census over the cleaned sample. Judging by share of letters is
// what makes it robust: a mail stays Chinese however much English signature,
// disclaimer and unsubscribe text is stapled below it, which is exactly the case
// CLD2 gets wrong by weighing the string as a whole.
// Returns null for Latin-script text — that is CLD2's job, not this one's.
function detectByScript(text) {
  let han = 0, kana = 0, hangul = 0, cyrillic = 0, arabic = 0, latin = 0;

  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2a6df)) han++;
    else if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a1 && c <= 0x30fa) ||
             (c >= 0xff66 && c <= 0xff9d) || c === 0x30fc) kana++;
    else if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) ||
             (c >= 0x3130 && c <= 0x318f)) hangul++;
    else if (c >= 0x0400 && c <= 0x04ff) cyrillic++;
    else if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f)) arabic++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
             (c >= 0xc0 && c <= 0x024f)) latin++;
  }

  if (scriptWins(hangul, latin, CJK_WEIGHT)) return "ko";
  if (scriptWins(han + kana, latin, CJK_WEIGHT)) {
    // Kana is the one script nothing else borrows in bulk: a Chinese mail may
    // quote a katakana product name, never at a fifth of its CJK characters.
    return kana / (han + kana) >= 0.2 ? "ja" : "zh";
  }
  if (scriptWins(cyrillic, latin, 1)) return "ru";
  if (scriptWins(arabic, latin, 1)) return "ar";
  return null;
}

// Gecko ships CLD2 and exposes it as i18n.detectLanguage: local, instant, free.
// Returns null when CLD cannot decide; callers treat that as "unknown".
async function detectLanguageLocally(sample) {
  if (typeof messenger.i18n?.detectLanguage !== "function") return null;
  try {
    const result = await messenger.i18n.detectLanguage(sample);
    const top = result?.languages?.[0];
    if (!top || top.language === "und") return null;
    // isReliable goes false on short or mixed text; a dominant share is still
    // good enough for an email body.
    if (!result.isReliable && (top.percentage || 0) < 80) return null;
    return normalizeLangCode(top.language);
  } catch (e) {
    console.warn("[Translator] i18n.detectLanguage failed:", e.message);
    return null;
  }
}

// Returns null when no stage could decide. Callers translate rather than guess.
async function detectLanguage(sample, settings) {
  const text = cleanSample(sample);
  if (!text) return null;

  const byScript = detectByScript(text);
  if (byScript) return byScript;

  const local = await detectLanguageLocally(text);
  if (local) return local;

  try {
    switch (settings.service) {
      case "ollama": return await detectWithOllama(text, settings);
      case "openai": return await detectWithOpenAI(text, settings);
      default: return null;  // Google / LibreTranslate have no detect endpoint here
    }
  } catch (e) {
    console.warn("[Translator] model-based detection fallback failed:", e.message);
    return null;
  }
}

// --- Detection sample ------------------------------------------------------

// Enough markup stripping for a character census. Thunderbird's own
// messengerUtilities.convertToPlainText is TB 137+, and this add-on targets 128.
function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

// text/plain when the message has one, the HTML part stripped of tags otherwise.
function textFromInlineParts(parts) {
  const pick = (type) => (parts || [])
    .filter(p => p && p.contentType === type && p.content)
    .map(p => p.content)
    .join("\n");
  const plain = pick("text/plain");
  return plain.trim() ? plain : htmlToText(pick("text/html"));
}

// getFull's part tree flattened to the same {contentType, content} shape.
function flattenMessageParts(part, out = []) {
  if (!part) return out;
  if (part.body) out.push({ contentType: part.contentType, content: part.body });
  if (Array.isArray(part.parts)) for (const p of part.parts) flattenMessageParts(p, out);
  return out;
}

// The readable text of the displayed message, cleaned and capped.
// listInlineTextParts (TB 128+) is what makes HTML-only mail detectable at all:
// walking getFull for a text/plain part returns nothing for most newsletters and
// notifications, and an empty sample used to mean "unknown" — so every one of
// them was translated in full.
async function getMessageSample(tabId) {
  if (tabId == null) return "";
  const msg = await messenger.messageDisplay.getDisplayedMessage(tabId);
  if (!msg) return "";

  let body = "";
  if (typeof messenger.messages.listInlineTextParts === "function") {
    try {
      body = textFromInlineParts(await messenger.messages.listInlineTextParts(msg.id));
    } catch (e) {
      console.warn("[Translator] listInlineTextParts failed:", e.message);
    }
  }
  if (!body.trim()) {
    try {
      body = textFromInlineParts(flattenMessageParts(await messenger.messages.getFull(msg.id)));
    } catch (e) {
      console.warn("[Translator] getFull failed:", e.message);
    }
  }

  // The subject is short but always present and always in the body's language;
  // it carries a one-line message over the census minimum.
  return cleanSample(`${msg.subject || ""}\n${body}`).slice(0, DETECT_SAMPLE_LIMIT);
}

async function getInstalledModels(ollamaUrl) {
  const url = normalizeOllamaUrl(ollamaUrl);
  await assertHostPermission(originPatternFromUrl(url), "Ollama");
  const response = await fetch(`${url}/api/tags`);
  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  return (await response.json()).models.map(m => m.name);
}

// --- Context menu ---

browser.menus.create({
  id: "auto-translate",
  title: "Auto-translate",
  type: "checkbox",
  checked: false,
  contexts: ["message_display_action"],
});

browser.menus.create({
  id: "sep-1",
  type: "separator",
  contexts: ["message_display_action"],
});

browser.menus.create({
  id: "translate-to-read",
  title: "Translate to",
  contexts: ["message_display_action"],
});
for (const lang of LANGUAGES) {
  browser.menus.create({
    id: `read-lang-${lang.value}`,
    parentId: "translate-to-read",
    title: lang.label,
    type: "radio",
    checked: lang.value === DEFAULT_TARGET_LANG,
    contexts: ["message_display_action"],
  });
}

browser.menus.create({
  id: "sep-never",
  type: "separator",
  contexts: ["message_display_action"],
});

browser.menus.create({
  id: "never-translate-toggle",
  title: "Never auto-translate",
  type: "normal",
  enabled: false,
  contexts: ["message_display_action"],
});

browser.menus.create({
  id: "translate-to-compose",
  title: "Translate to",
  contexts: ["compose_action"],
});
for (const lang of LANGUAGES) {
  browser.menus.create({
    id: `compose-lang-${lang.value}`,
    parentId: "translate-to-compose",
    title: lang.label,
    type: "radio",
    checked: lang.value === DEFAULT_TARGET_LANG,
    contexts: ["compose_action"],
  });
}

browser.menus.onShown.addListener(async (info, tab) => {
  const isRead    = info.contexts.includes("message_display_action");
  const isCompose = info.contexts.includes("compose_action");
  if (!isRead && !isCompose) return;

  const settings = await getSettings();
  const tabId = tab?.id ?? null;

  if (isRead) {
    await browser.menus.update("auto-translate", { checked: settings.autoTranslate });

    const readLangKey    = LANG_STORAGE_KEY[settings.service] || "googleTargetLang";
    const activeReadLang = settings[readLangKey] || DEFAULT_TARGET_LANG;
    for (const lang of LANGUAGES) {
      await browser.menus.update(`read-lang-${lang.value}`, { checked: lang.value === activeReadLang });
    }

    if (!settings.autoTranslate) {
      await browser.menus.update("never-translate-toggle", {
        title: "Never auto-translate",
        enabled: false,
      });
    } else if (tabId != null && translatingTabs.has(tabId)) {
      // Translation is currently running — disable toggle until it finishes
      await browser.menus.update("never-translate-toggle", {
        title: "Detecting language…",
        enabled: false,
      });
    } else {
      let detectedLang = tabId != null ? detectedLangByTab.get(tabId) : null;

      // Run on-demand detection when the cache is empty (e.g. after a manual translate)
      if (!detectedLang && tabId != null) {
        try {
          const sample = await getMessageSample(tabId);
          if (sample) {
            detectedLang = await detectLanguage(sample, settings);
            if (detectedLang) detectedLangByTab.set(tabId, detectedLang);
          }
        } catch (e) {
          console.warn("[Translator] on-demand language detection failed in onShown:", e.message);
        }
      }

      if (detectedLang) {
        const langName   = LANGUAGE_NAMES[detectedLang] || detectedLang.toUpperCase();
        const neverLangs = settings.neverTranslateLangs || [];
        const isExcluded = neverLangs.includes(detectedLang);
        await browser.menus.update("never-translate-toggle", {
          title: isExcluded ? `Always auto-translate ${langName}` : `Never auto-translate ${langName}`,
          enabled: true,
        });
      } else {
        await browser.menus.update("never-translate-toggle", {
          title: "Never auto-translate",
          enabled: false,
        });
      }
    }
  }

  if (isCompose) {
    const composeLangKey    = COMPOSE_LANG_KEY[settings.service] || "googleComposeLang";
    const activeComposeLang = settings[composeLangKey] || DEFAULT_TARGET_LANG;
    for (const lang of LANGUAGES) {
      await browser.menus.update(`compose-lang-${lang.value}`, { checked: lang.value === activeComposeLang });
    }
  }

  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "auto-translate") {
    await messenger.storage.local.set({ autoTranslate: info.checked });
    return;
  }

  if (info.menuItemId === "never-translate-toggle") {
    const tabId = tab?.id ?? null;
    const detectedLang = tabId != null ? detectedLangByTab.get(tabId) : null;
    if (!detectedLang) return;
    const { neverTranslateLangs = [] } = await messenger.storage.local.get({ neverTranslateLangs: [] });
    const isExcluded = neverTranslateLangs.includes(detectedLang);
    const updated = isExcluded
      ? neverTranslateLangs.filter(l => l !== detectedLang)
      : [...new Set([...neverTranslateLangs, detectedLang])];
    await messenger.storage.local.set({ neverTranslateLangs: updated });
    return;
  }

  const { service } = await messenger.storage.local.get({ service: DEFAULT_SERVICE });
  if (String(info.menuItemId).startsWith("read-lang-")) {
    const lang    = info.menuItemId.replace("read-lang-", "");
    const langKey = LANG_STORAGE_KEY[service] || "googleTargetLang";
    await messenger.storage.local.set({ [langKey]: lang });
    messenger.messageDisplayAction.setTitle({ title: `Translate (${lang.toUpperCase()})` });
    return;
  }
  if (String(info.menuItemId).startsWith("compose-lang-")) {
    const lang    = info.menuItemId.replace("compose-lang-", "");
    const langKey = COMPOSE_LANG_KEY[service] || "googleComposeLang";
    await messenger.storage.local.set({ [langKey]: lang });
    messenger.composeAction.setTitle({ title: `Translate (${lang.toUpperCase()})` });
  }
});

// --- messageDisplayAction toggle ---

messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  messenger.messageDisplayAction.setBadgeText({ tabId, text: "..." });
  messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#f90" });
  try {
    const state = await sendToTabPort(tabId, "getState");
    if (state.isTranslated) {
      await sendToTabPort(tabId, "doRevert");
      messenger.messageDisplayAction.setBadgeText({ tabId, text: "" });
    } else {
      const settings = await getSettings();
      const targetLang = settings[LANG_STORAGE_KEY[settings.service]] || DEFAULT_TARGET_LANG;
      const result = await sendToTabPort(tabId, "doTranslate", { targetLang });
      if (result.success) {
        messenger.messageDisplayAction.setBadgeText({ tabId, text: "✓" });
        messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#1a7f37" });
        setTimeout(() => messenger.messageDisplayAction.setBadgeText({ tabId, text: "" }), 2000);
      } else {
        messenger.messageDisplayAction.setBadgeText({ tabId, text: "!" });
        messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#c00" });
      }
    }
  } catch (e) {
    console.error("[Translator] onClicked error:", e.message);
    messenger.messageDisplayAction.setBadgeText({ tabId, text: "!" });
    messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId, color: "#c00" });
  }
});

// --- composeAction ---

messenger.composeAction.onClicked.addListener(async (tab) => {
  const tabId    = tab.id;
  const windowId = tab.windowId;
  messenger.composeAction.setBadgeText({ tabId, text: "..." });
  messenger.composeAction.setBadgeBackgroundColor({ tabId, color: "#f90" });
  try {
    const result = await sendToComposePort(windowId, "doTranslateSelection");
    if (result.success) {
      messenger.composeAction.setBadgeText({ tabId, text: "✓" });
      messenger.composeAction.setBadgeBackgroundColor({ tabId, color: "#1a7f37" });
      setTimeout(() => messenger.composeAction.setBadgeText({ tabId, text: "" }), 2000);
    } else {
      messenger.composeAction.setBadgeText({ tabId, text: "!" });
      messenger.composeAction.setBadgeBackgroundColor({ tabId, color: "#c00" });
    }
  } catch (e) {
    console.error("[Translator] compose onClicked error:", e.message);
    messenger.composeAction.setBadgeText({ tabId, text: "!" });
    messenger.composeAction.setBadgeBackgroundColor({ tabId, color: "#c00" });
  }
});

// --- Message handler (options page) ---

// The listener itself must stay synchronous. An async listener returns a Promise
// for *every* message, including ones it does not handle, so it claims messages
// meant for other listeners and their responses can be dropped.
// https://webextension-api.thunderbird.net/en/mv3/guides/runtimeMessaging.html

async function handleGetModels(message) {
  try {
    const settings = await getSettings();
    return { success: true, models: await getInstalledModels(message.ollamaUrl || settings.ollamaUrl) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function handleTestConnection(message) {
  try {
    return { success: true, models: await getInstalledModels(message.ollamaUrl) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function handleGetOpenaiModels(message) {
  try {
    return { success: true, models: await getOpenaiModels(message.openaiUrl, message.openaiApiKey) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function handleSaveSettings(message) {
  await messenger.storage.local.set({
    ollamaUrl:             message.ollamaUrl,
    model:                 message.model,
    detectionModel:        message.detectionModel,
    ollamaApiKey:          message.ollamaApiKey,
    libreUrl:              message.libreUrl,
    libreApiKey:           message.libreApiKey,
    service:               message.service,
    ollamaTranslatePrompt: message.ollamaTranslatePrompt,
    ollamaDetectPrompt:    message.ollamaDetectPrompt,
    openaiUrl:             message.openaiUrl,
    openaiApiKey:          message.openaiApiKey,
    openaiModel:           message.openaiModel,
    openaiDetectionModel:  message.openaiDetectionModel,
    openaiTranslatePrompt: message.openaiTranslatePrompt,
    openaiDetectPrompt:    message.openaiDetectPrompt,
  });
  updateReadButtonTitle();
  updateComposeButtonTitle();
  return { success: true };
}

function onOptionsMessage(message) {
  switch (message?.command) {
    case "getModels":      return handleGetModels(message);
    case "testConnection": return handleTestConnection(message);
    case "getOpenaiModels": return handleGetOpenaiModels(message);
    case "saveSettings":   return handleSaveSettings(message);
  }
  // Not ours — return undefined so other listeners can respond.
}

messenger.runtime.onMessage.addListener(onOptionsMessage);
