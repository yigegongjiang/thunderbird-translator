"use strict";

// Keep in sync with DEFAULT_TRANSLATE_PROMPT in background.js
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

// Keep in sync with DEFAULT_DETECT_PROMPT in background.js
const DEFAULT_DETECT_PROMPT =
`Identify the dominant language of the text inside the <text> tags: the language most of the text is written in. Ignore quoted replies, signatures, disclaimers and isolated foreign words.
Reply with ONLY the ISO 639-1 two-letter language code.
Examples: "en" for English, "tl" for Filipino/Tagalog, "fr" for French, "de" for German,
"es" for Spanish, "ja" for Japanese, "zh" for Chinese, "ko" for Korean, "ar" for Arabic.
No explanation. Just the two-letter code.

<text>{TEXT}</text>`;

function translatePage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = browser.i18n.getMessage(key);
  });
  document.querySelectorAll("[title-i18n]").forEach((el) => {
    const key = el.getAttribute("title-i18n");
    el.setAttribute("title", browser.i18n.getMessage(key));
  });
}

// --- Element refs ---
const urlInput                = document.getElementById("ollamaUrl");
const modelSelect             = document.getElementById("model");
const detectionModelSelect    = document.getElementById("detectionModel");
const ollamaApiKeyInput       = document.getElementById("ollamaApiKey");
const libreUrlInput           = document.getElementById("libreUrl");
const openaiUrlInput          = document.getElementById("openaiUrl");
const openaiApiKeyInput       = document.getElementById("openaiApiKey");
const openaiModelInput        = document.getElementById("openaiModel");
const openaiDetectionInput    = document.getElementById("openaiDetectionModel");
const openaiModelList         = document.getElementById("openaiModelList");
const openaiTranslatePromptTA = document.getElementById("openaiTranslatePrompt");
const openaiDetectPromptTA    = document.getElementById("openaiDetectPrompt");
const testOpenaiBtn           = document.getElementById("testOpenaiConnection");
const openaiTestStatus        = document.getElementById("openaiTestStatus");
const libreApiKeyInput        = document.getElementById("libreApiKey");
const refreshBtn              = document.getElementById("refreshModels");
const refreshDetectionBtn     = document.getElementById("refreshDetectionModels");
const testBtn                 = document.getElementById("testConnection");
const testLibreBtn            = document.getElementById("testLibreConnection");
const saveBtn                 = document.getElementById("save");
const statusDiv               = document.getElementById("status");
const ollamaTestStatus        = document.getElementById("ollamaTestStatus");
const libreTestStatus         = document.getElementById("libreTestStatus");
const serviceRadios           = document.querySelectorAll("input[name='service']");
const ollamaTranslatePromptTA = document.getElementById("ollamaTranslatePrompt");
const ollamaDetectPromptTA    = document.getElementById("ollamaDetectPrompt");

// --- Status ---
function showStatus(messageKey, isError, replacements = {}) {
  const message = browser.i18n.getMessage(messageKey, Object.values(replacements));
  statusDiv.textContent = message || messageKey;
  statusDiv.className = "status " + (isError ? "error" : "success");
}

function clearStatus() {
  statusDiv.className = "status";
  statusDiv.textContent = "";
}

// --- Service radio helpers ---
function getSelectedService() {
  for (const r of serviceRadios) {
    if (r.checked) return r.value;
  }
  return "google";
}

function setSelectedService(service) {
  for (const r of serviceRadios) {
    r.checked = (r.value === service);
  }
}

// --- Load settings ---
async function loadSettings() {
  const settings = await browser.storage.local.get({
    ollamaUrl: "http://localhost:11434",
    model: "",
    detectionModel: "",
    ollamaApiKey: "",
    libreUrl: "https://libretranslate.com",
    libreApiKey: "",
    service: "google",
    ollamaTranslatePrompt: "",
    ollamaDetectPrompt: "",
    openaiUrl: "https://api.openai.com/v1",
    openaiApiKey: "",
    openaiModel: "",
    openaiDetectionModel: "",
    openaiTranslatePrompt: "",
    openaiDetectPrompt: "",
  });

  urlInput.value = settings.ollamaUrl;
  ollamaApiKeyInput.value = settings.ollamaApiKey;
  libreUrlInput.value = settings.libreUrl;
  libreApiKeyInput.value = settings.libreApiKey;
  ollamaTranslatePromptTA.value = settings.ollamaTranslatePrompt || DEFAULT_TRANSLATE_PROMPT;
  ollamaDetectPromptTA.value    = settings.ollamaDetectPrompt    || DEFAULT_DETECT_PROMPT;

  openaiUrlInput.value              = settings.openaiUrl;
  openaiApiKeyInput.value           = settings.openaiApiKey;
  openaiModelInput.value            = settings.openaiModel;
  openaiDetectionInput.value        = settings.openaiDetectionModel;
  openaiTranslatePromptTA.value     = settings.openaiTranslatePrompt || DEFAULT_TRANSLATE_PROMPT;
  openaiDetectPromptTA.value        = settings.openaiDetectPrompt    || DEFAULT_DETECT_PROMPT;

  setSelectedService(settings.service);

  await loadModels(settings.model);
  await loadDetectionModels(settings.detectionModel);
}

// --- Models ---
async function loadModels(selectedModel, ollamaUrl) {
  const result = await browser.runtime.sendMessage({ command: "getModels", ollamaUrl });

  modelSelect.innerHTML = "";

  if (!result.success) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = browser.i18n.getMessage("cannotLoadModels");
    modelSelect.appendChild(opt);
    if (selectedModel) {
      const saved = document.createElement("option");
      saved.value = selectedModel;
      saved.textContent = selectedModel + " " + browser.i18n.getMessage("saved");
      saved.selected = true;
      modelSelect.appendChild(saved);
    }
    return;
  }

  if (result.models.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = browser.i18n.getMessage("noModelsFound");
    modelSelect.appendChild(opt);
    return;
  }

  for (const name of result.models) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === selectedModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  if (selectedModel && !result.models.includes(selectedModel)) {
    const saved = document.createElement("option");
    saved.value = selectedModel;
    saved.textContent = selectedModel + " " + browser.i18n.getMessage("notFound");
    saved.selected = true;
    modelSelect.prepend(saved);
  }
}

// --- Detection Models ---
async function loadDetectionModels(selectedModel, ollamaUrl) {
  const result = await browser.runtime.sendMessage({ command: "getModels", ollamaUrl });

  // Keep the "Same as Translate Model" blank option, then populate the rest
  detectionModelSelect.innerHTML = '<option value="">Same as Translate Model</option>';

  if (!result.success) {
    if (selectedModel) {
      const saved = document.createElement("option");
      saved.value = selectedModel;
      saved.textContent = selectedModel + " " + browser.i18n.getMessage("saved");
      saved.selected = true;
      detectionModelSelect.appendChild(saved);
    }
    return;
  }

  for (const name of result.models) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === selectedModel) opt.selected = true;
    detectionModelSelect.appendChild(opt);
  }

  if (selectedModel && !result.models.includes(selectedModel) && selectedModel !== "") {
    const saved = document.createElement("option");
    saved.value = selectedModel;
    saved.textContent = selectedModel + " " + browser.i18n.getMessage("notFound");
    saved.selected = true;
    detectionModelSelect.prepend(saved);
  }
}

refreshBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  // ensureHostPermission must come before any other await — see its definition.
  if (!await ensureHostPermission(originPatternFromUrl(url))) {
    showInlineStatus(ollamaTestStatus, permissionDeniedText(url), true); return;
  }
  clearStatus();
  await loadModels(modelSelect.value, url);
  showStatus("modelsRefreshed", false);
});

refreshDetectionBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!await ensureHostPermission(originPatternFromUrl(url))) {
    showInlineStatus(ollamaTestStatus, permissionDeniedText(url), true); return;
  }
  clearStatus();
  await loadDetectionModels(detectionModelSelect.value, url);
  showStatus("modelsRefreshed", false);
});

function showInlineStatus(el, text, isError) {
  el.textContent = text;
  el.className = "status " + (isError ? "error" : "success");
}

// --- Host permissions ---
// Host access lives in optional_permissions, so nothing is granted at install.
// permissions.request() only works inside a user input handler, which is why
// every call below sits directly in a click handler rather than in load code.

const GOOGLE_ORIGIN = "https://translate.google.com/*";

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

function originForService(service, ollamaUrl, libreUrl, openaiUrl) {
  switch (service) {
    case "ollama":         return originPatternFromUrl(ollamaUrl);
    case "libretranslate": return originPatternFromUrl(libreUrl);
    case "openai":         return originPatternFromUrl(openaiUrl);
    case "google":         return GOOGLE_ORIGIN;
    default:               return null;
  }
}

// Returns true if the origin is granted, requesting it from the user if needed.
//
// permissions.request() is only allowed while the user gesture that triggered
// the handler is still active. Awaiting anything before it — including
// permissions.contains() — discards that gesture and the call throws. So this
// must be the first await in any click handler, and it does not pre-check:
// request() on an already-granted origin resolves true without prompting.
async function ensureHostPermission(origin) {
  if (!origin) return false;
  try {
    return await browser.permissions.request({ origins: [origin] });
  } catch (e) {
    console.error("[Translator] permissions.request failed:", e.message);
    return false;
  }
}

function permissionDeniedText(origin) {
  return browser.i18n.getMessage("permissionDenied", [origin])
    || `Access to ${origin} was not granted. Translation cannot reach that server without it.`;
}

testBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) { showInlineStatus(ollamaTestStatus, browser.i18n.getMessage("urlRequired") || "URL required", true); return; }
  const origin = originPatternFromUrl(url);
  if (!await ensureHostPermission(origin)) {
    showInlineStatus(ollamaTestStatus, permissionDeniedText(origin || url), true); return;
  }
  const result = await browser.runtime.sendMessage({ command: "testConnection", ollamaUrl: url });
  if (result.success) {
    showInlineStatus(ollamaTestStatus, (browser.i18n.getMessage("connectionSuccess", [result.models.length]) || `Connected. ${result.models.length} models available.`), false);
    await loadModels(modelSelect.value, url);
    await loadDetectionModels(detectionModelSelect.value, url);
  } else {
    showInlineStatus(ollamaTestStatus, (browser.i18n.getMessage("connectionFailed", [result.error]) || `Connection failed: ${result.error}`), true);
  }
});

testLibreBtn.addEventListener("click", async () => {
  const url = libreUrlInput.value.trim();
  if (!url) { showInlineStatus(libreTestStatus, browser.i18n.getMessage("urlRequired") || "URL required", true); return; }
  const origin = originPatternFromUrl(url);
  if (!await ensureHostPermission(origin)) {
    showInlineStatus(libreTestStatus, permissionDeniedText(origin || url), true); return;
  }
  try {
    const base = url.replace(/\/+$/, "").replace(/\/translate$/, "");
    const apiKey = libreApiKeyInput.value.trim();
    const endpoint = base + "/languages" + (apiKey ? "?api_key=" + encodeURIComponent(apiKey) : "");
    const resp = await fetch(endpoint);
    if (!resp.ok) throw new Error("HTTP " + resp.status + " " + resp.statusText);
    const langs = await resp.json();
    if (!Array.isArray(langs)) throw new Error("Unexpected response format");
    showInlineStatus(libreTestStatus, "Connected. " + langs.length + " languages available.", false);
  } catch (e) {
    showInlineStatus(libreTestStatus, "Connection failed: " + e.message, true);
  }
});

testOpenaiBtn.addEventListener("click", async () => {
  const url = openaiUrlInput.value.trim();
  if (!url) { showInlineStatus(openaiTestStatus, browser.i18n.getMessage("urlRequired") || "URL required", true); return; }
  const apiKey = openaiApiKeyInput.value.trim();
  const origin = originPatternFromUrl(url);
  // ensureHostPermission must come before any other await — see its definition.
  if (!await ensureHostPermission(origin)) {
    showInlineStatus(openaiTestStatus, permissionDeniedText(origin || url), true); return;
  }
  const result = await browser.runtime.sendMessage({
    command: "getOpenaiModels", openaiUrl: url, openaiApiKey: apiKey,
  });
  if (result.success) {
    openaiModelList.innerHTML = "";
    for (const name of result.models) {
      const opt = document.createElement("option");
      opt.value = name;
      openaiModelList.appendChild(opt);
    }
    showInlineStatus(openaiTestStatus, `Connected. ${result.models.length} models available.`, false);
  } else {
    // A gateway without /models can still translate, so this is not fatal.
    showInlineStatus(openaiTestStatus, `Could not list models: ${result.error}. Translation may still work if the model id is correct.`, true);
  }
});

saveBtn.addEventListener("click", async () => {
  clearStatus();

  const service             = getSelectedService();
  const ollamaUrl           = urlInput.value.trim();
  const model               = modelSelect.value;
  const detectionModel      = detectionModelSelect.value;
  const ollamaApiKey        = ollamaApiKeyInput.value.trim();
  const libreUrl            = libreUrlInput.value.trim();
  const libreApiKey         = libreApiKeyInput.value.trim();
  const ollamaTranslatePrompt = ollamaTranslatePromptTA.value.trim();
  const ollamaDetectPrompt    = ollamaDetectPromptTA.value.trim();
  const openaiUrl             = openaiUrlInput.value.trim();
  const openaiApiKey          = openaiApiKeyInput.value.trim();
  const openaiModel           = openaiModelInput.value.trim();
  const openaiDetectionModel  = openaiDetectionInput.value.trim();
  const openaiTranslatePrompt = openaiTranslatePromptTA.value.trim();
  const openaiDetectPrompt    = openaiDetectPromptTA.value.trim();

  if (service === "ollama" && !ollamaUrl) {
    showStatus("urlRequired", true); return;
  }
  if (service === "libretranslate" && !libreUrl) {
    showStatus("urlRequired", true); return;
  }
  if (service === "openai") {
    if (!openaiUrl)   { showStatus("urlRequired", true); return; }
    if (!openaiModel) { showStatus("modelRequired", true); return; }
  }

  // Grant the active service its host access now, while we still have the click.
  const origin = originForService(service, ollamaUrl, libreUrl, openaiUrl);
  if (!await ensureHostPermission(origin)) {
    showInlineStatus(statusDiv, permissionDeniedText(origin || service), true); return;
  }

  await browser.runtime.sendMessage({
    command: "saveSettings",
    ollamaUrl, model, detectionModel, ollamaApiKey,
    libreUrl, libreApiKey, service,
    ollamaTranslatePrompt, ollamaDetectPrompt,
    openaiUrl, openaiApiKey, openaiModel, openaiDetectionModel,
    openaiTranslatePrompt, openaiDetectPrompt,
  });

  showStatus("settingsSaved", false);
});

translatePage();
loadSettings();
