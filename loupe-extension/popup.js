const LOUPE_API = "https://memry-team-opal.vercel.app/api/extension-styles";
const LOUPE_APP = "https://memry-team-opal.vercel.app/agents/figma-compare";

const input  = document.getElementById("figmaUrl");
const btn    = document.getElementById("btn");
const status = document.getElementById("status");

// Load saved Figma URL
chrome.storage.local.get("figmaUrl", ({ figmaUrl }) => {
  if (figmaUrl) input.value = figmaUrl;
});

btn.addEventListener("click", async () => {
  const figmaUrl = input.value.trim();
  if (!figmaUrl) { setStatus("Enter a Figma URL first.", "error"); return; }

  chrome.storage.local.set({ figmaUrl });
  btn.disabled = true;
  setStatus("Extracting styles…");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { setStatus("No active tab.", "error"); btn.disabled = false; return; }

  let styles;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractStyles });
    styles = results?.[0]?.result ?? [];
  } catch (e) {
    setStatus("Could not extract styles.", "error");
    btn.disabled = false;
    return;
  }

  if (!styles.length) { setStatus("No styles found on this page.", "error"); btn.disabled = false; return; }

  setStatus(`Sending ${styles.length} styles…`);
  try {
    await fetch(LOUPE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, styles }),
    });
  } catch {
    setStatus("Failed to send styles.", "error");
    btn.disabled = false;
    return;
  }

  setStatus("Opening Loupe…", "ok");
  const loupeUrl = `${LOUPE_APP}?liveUrl=${encodeURIComponent(tab.url)}&figmaUrl=${encodeURIComponent(figmaUrl)}&autorun=1`;
  const existing = await chrome.tabs.query({ url: `${LOUPE_APP}*` });
  if (existing.length) {
    chrome.tabs.update(existing[0].id, { active: true, url: loupeUrl });
  } else {
    chrome.tabs.create({ url: loupeUrl });
  }
  window.close();
});

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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textMap = new Map();
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text || text.length < 2) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (el.offsetParent === null && cs.position !== "fixed") continue;
    const fontFamily = cs.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
    const entry = { text: text.slice(0, 60), fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: rgbToHex(cs.color) };
    if (!textMap.has(text) || isSystem(textMap.get(text).fontFamily)) textMap.set(text, entry);
  }
  return [...textMap.values()];
}
