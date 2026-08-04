const LOUPE_API = "https://getloupe.vercel.app/api/extension-styles";
const LOUPE_APP = "https://getloupe.vercel.app/agents/figma-compare";
const RESPONSIVE_APP = "https://getloupe.vercel.app/agents/responsive";
const BRAND_APP = "https://getloupe.vercel.app/agents/brand-consistency";
const ACCESSIBILITY_APP = "https://getloupe.vercel.app/agents/accessibility";
const SETTINGS_APP = "https://getloupe.vercel.app/agents/settings";

const figmaInput  = document.getElementById("figmaUrl");
const btn         = document.getElementById("btn");
const status      = document.getElementById("status");
const currentUrl  = document.getElementById("currentUrl");
const patWarning = document.getElementById("patWarning");
const patSettingsBtn = document.getElementById("patSettingsBtn");
const agentButtons = document.querySelectorAll("[data-agent]");

let activeTabCache = null;

const CHECK_IDS = ["family", "size", "weight", "color", "missing"];
const CHECK_MAP = {
  missing: "missing_elements",
  family:  "font_family",
  size:    "font_size",
  weight:  "font_weight",
  color:   "color",
};

// Load saved settings
chrome.storage.local.get(["figmaUrl", "checks", "figmaPatStatus", "patExpired"], ({ figmaUrl, checks, figmaPatStatus, patExpired }) => {
  if (figmaUrl) figmaInput.value = figmaUrl;
  const selected = Array.isArray(checks) ? checks : [];
  CHECK_IDS.forEach(id => {
    const el = document.getElementById(`chk-${id}`);
    if (el) el.checked = selected.includes(id);
  });
  if (figmaPatStatus === "expired" || patExpired === true) {
    patWarning.hidden = false;
  }
});

refreshCurrentTab();

// The side panel stays open across tab switches/navigation, but "activeTab"
// only grants URL visibility for the tab that was active at launch — without
// these listeners (plus the "tabs" permission) the display goes stale the
// moment you switch tabs or navigate, showing "No active page detected"
// even though a real page is right there.
chrome.tabs.onActivated.addListener(refreshCurrentTab);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) refreshCurrentTab();
});
chrome.windows?.onFocusChanged?.addListener(refreshCurrentTab);

agentButtons.forEach(button => {
  button.addEventListener("click", () => {
    openAgent(button.dataset.agent);
  });
});

patSettingsBtn.addEventListener("click", () => {
  openOrFocusLoupe(SETTINGS_APP, `${SETTINGS_APP}*`);
});

// "activeTab" only covers the tab that was focused when the extension was
// invoked, so once the panel has been open across a navigation, injecting
// into the current page is denied. Rather than ship a blanket <all_urls>
// grant (a scary install prompt and a much harder store review), we ask for
// just the origin being scanned, the first time it is scanned.
async function ensureHostAccess(tabUrl) {
  let origin;
  try {
    origin = `${new URL(tabUrl).origin}/*`;
  } catch {
    return false;
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

btn.addEventListener("click", async () => {
  const figmaUrl = figmaInput.value.trim();
  if (!figmaUrl) { setStatus("Enter a Figma URL first.", "error"); return; }
  const checks = CHECK_IDS.filter(id => document.getElementById(`chk-${id}`)?.checked);
  if (checks.length === 0) { setStatus("Choose at least one check.", "error"); return; }
  const checkKeys = checks.map(id => CHECK_MAP[id]);

  // Must run before any await so the click still counts as a user gesture.
  const cachedUrl = activeTabCache?.url ?? "";
  if (!cachedUrl.startsWith("http") || isLoupeUrl(cachedUrl)) {
    setStatus("Open the live site tab first.", "error");
    return;
  }
  const granted = await ensureHostAccess(cachedUrl);
  if (!granted) {
    setStatus("Loupe needs permission to read this page. Click again and choose Allow.", "error");
    return;
  }

  chrome.storage.local.set({ figmaUrl, checks });
  btn.disabled = true;
  setStatus("Extracting styles…");

  const tab = await getLiveTab();
  if (!tab) {
    btn.disabled = false;
    return;
  }

  let styles;
  let visibilityStats = null;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractStyles });
    const capture = results?.[0]?.result ?? [];
    styles = Array.isArray(capture) ? capture : (capture.styles ?? []);
    visibilityStats = Array.isArray(capture) ? null : (capture.visibilityStats ?? null);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.includes("Cannot access") || msg.includes("chrome://") || msg.includes("extension://")) {
      // Permission was granted above, so this is a page Chrome blocks outright
      // (chrome:// internals, the Web Store, other extensions' pages) — no
      // amount of granting permission makes those injectable.
      setStatus("Chrome blocks extensions on this page. Try a regular website.", "error");
    } else {
      setStatus("Reload the page and try again.", "error");
    }
    console.error("[Loupe] executeScript failed:", msg);
    btn.disabled = false;
    return;
  }

  if (!styles.length) { setStatus("No styles found — try reloading the page.", "error"); btn.disabled = false; return; }

  setStatus(`Sending ${styles.length} styles…`);
  try {
    await fetch(LOUPE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, styles, visibilityStats }),
    });
  } catch {
    setStatus("Failed to send styles.", "error");
    btn.disabled = false;
    return;
  }

  setStatus("Opening Loupe…", "ok");
  const params = new URLSearchParams({
    liveUrl:  tab.url,
    figmaUrl,
    autorun:  "1",
    checks:   checkKeys.join(","),
  });
  const loupeUrl = `${LOUPE_APP}?${params}`;
  await openOrFocusLoupe(loupeUrl, `${LOUPE_APP}*`);
  btn.disabled = false;
  setStatus("Loupe opened in a tab.", "ok");
});

const AGENT_LABELS = {
  responsive: "Device Preview",
  brand: "Brand Check",
  accessibility: "Accessibility",
};

async function openAgent(agent) {
  const routes = {
    responsive: RESPONSIVE_APP,
    brand: BRAND_APP,
    accessibility: ACCESSIBILITY_APP,
  };
  const route = routes[agent];
  if (!route) return;
  const tab = await getLiveTab();
  if (!tab) return;
  const params = new URLSearchParams({ url: tab.url });
  await openOrFocusLoupe(`${route}?${params}`, `${route}*`);
  setStatus(`${AGENT_LABELS[agent] ?? "Agent"} opened.`, "ok");
}

async function refreshCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Cached so the capture handler can request host access without awaiting
  // first — chrome.permissions.request() needs an unconsumed user gesture,
  // and an await before it can invalidate that.
  activeTabCache = tab ?? null;
  const tabUrl = tab?.url ?? "";
  if (!tabUrl) {
    currentUrl.textContent = "No active page detected";
    return;
  }
  if (!tabUrl.startsWith("http")) {
    currentUrl.textContent = "Open a website tab to scan";
    return;
  }
  if (isLoupeUrl(tabUrl)) {
    currentUrl.textContent = "Open the live site tab, not Loupe";
    return;
  }
  currentUrl.textContent = tabUrl.replace(/^https?:\/\//, "");
}

async function getLiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab?.url) {
    setStatus("No active tab found.", "error");
    return null;
  }
  const tabUrl = tab.url;
  if (!tabUrl.startsWith("http")) {
    setStatus("Open a website tab first.", "error");
    return null;
  }
  if (isLoupeUrl(tabUrl)) {
    setStatus("Open the live site tab, not Loupe.", "error");
    return null;
  }
  return tab;
}

function isLoupeUrl(url) {
  return /^https:\/\/(?:getloupe\.vercel\.app|loupe-[^.]+\.vercel\.app)\//.test(url);
}

async function openOrFocusLoupe(url, matchUrl) {
  const existing = await chrome.tabs.query({ url: matchUrl });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true, url });
  } else {
    await chrome.tabs.create({ url });
  }
}

function setStatus(msg, type = "") {
  status.textContent = msg;
  status.className = "status " + type;
}

function extractStyles() {
  function rgbToHex(rgb) {
    if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return rgb;
    return "#" + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, "0").toUpperCase()).join("");
  }
  const SYSTEM = ["-apple-system", "BlinkMacSystemFont", "system-ui", "Arial", "Helvetica", "Georgia", "Times"];
  const isSystem = f => SYSTEM.some(s => f.startsWith(s));
  function isValidCapturedText(text) {
    if (!text || text.length < 2) return false;
    if (text.length > 500) return false;
    if (/^@(?:keyframes|media|supports|font-face)\b/i.test(text)) return false;
    if (/[{};]/.test(text) && /\b(?:opacity|transform|animation|display|position|width|height)\s*:/.test(text)) return false;
    return true;
  }
  function hiddenReason(el, cs, rect) {
    if (el.closest("[aria-hidden='true']")) return "skippedAriaHidden";
    if (el.matches(".screen-reader-text, .sr-only, .visually-hidden, .skip-link")) return "skippedSrOnly";
    if (el.closest(".screen-reader-text, .sr-only, .visually-hidden, .skip-link")) return "skippedSrOnly";
    if (cs.display === "none" || cs.visibility === "hidden") return "skippedHiddenSelf";
    if (cs.opacity === "0") return "skippedTransparent";
    if (el.offsetParent === null && cs.position !== "fixed" && cs.position !== "sticky") return "skippedHiddenSelf";
    if (el.closest("[hidden]")) return "skippedHiddenSelf";
    if (el.closest("script, style, noscript, template, svg, dialog:not([open])")) return "skippedHiddenSelf";
    if (cs.clipPath === "inset(100%)") return "skippedSrOnly";
    if (cs.clip === "rect(0px, 0px, 0px, 0px)") return "skippedSrOnly";
    if (rect.width === 0 || rect.height === 0) return "skippedZeroSize";
    return null;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textMap = new Map();
  const visibilityStats = {
    textNodesTotal: 0,
    skippedHiddenInherited: 0,
    skippedHiddenSelf: 0,
    skippedZeroSize: 0,
    skippedTransparent: 0,
    skippedByName: 0,
    skippedComponentDef: 0,
    skippedVariant: 0,
    skippedAriaHidden: 0,
    skippedSrOnly: 0,
    diffCandidates: 0,
  };
  const doc = document.documentElement;
  const body = document.body;
  const pageWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0, window.innerWidth);
  const pageHeight = Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, window.innerHeight);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!isValidCapturedText(text)) continue;
    visibilityStats.textNodesTotal++;
    const el = node.parentElement;
    if (!el) continue;
    const cs = window.getComputedStyle(el);
    const fontFamily = cs.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
    // Capture DOM context — is this element inside a nav/header?
    const inNav = !!(el.closest("header, nav, [role='navigation'], .site-header, .main-nav, .ekit-menu-nav-link, .ekit-nav-menu"));
    const rect  = el.getBoundingClientRect();
    const reason = hiddenReason(el, cs, rect);
    if (reason) { visibilityStats[reason]++; continue; }
    visibilityStats.diffCandidates++;
    const inTopZone = rect.top < window.innerHeight * 0.2;
    const pageX = rect.left + window.scrollX;
    const pageY = rect.top + window.scrollY;
    const bounds = {
      x: pageX,
      y: pageY,
      width: rect.width,
      height: rect.height,
      pageWidth,
      pageHeight,
      normalized: {
        x: pageWidth ? pageX / pageWidth : 0,
        y: pageHeight ? pageY / pageHeight : 0,
        width: pageWidth ? rect.width / pageWidth : 0,
        height: pageHeight ? rect.height / pageHeight : 0,
        centerX: pageWidth ? (pageX + rect.width / 2) / pageWidth : 0,
        centerY: pageHeight ? (pageY + rect.height / 2) / pageHeight : 0,
      },
    };

    const entry = { text: text.slice(0, 200), fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: rgbToHex(cs.color), inNav: inNav || inTopZone, bounds };
    if (!textMap.has(text) || isSystem(textMap.get(text).fontFamily)) textMap.set(text, entry);
  }
  return { styles: [...textMap.values()], visibilityStats };
}
