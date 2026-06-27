const LOUPE_API = "https://memry-team.vercel.app/api/extension-styles";
const LOUPE_APP = "https://memry-team.vercel.app/agents/figma-compare";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  // Run extraction in the active tab — fonts are loaded because user is on the page
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractStyles,
    });
  } catch (err) {
    console.error("[loupe] executeScript failed:", err);
    return;
  }

  const styles = results?.[0]?.result ?? [];
  if (!styles.length) {
    console.warn("[loupe] no styles extracted");
    return;
  }

  // POST styles to Loupe API keyed by the live URL
  try {
    await fetch(LOUPE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, styles }),
    });
  } catch (err) {
    console.error("[loupe] POST failed:", err);
  }

  // Open (or focus) the Loupe app
  const loupeUrl = `${LOUPE_APP}?liveUrl=${encodeURIComponent(tab.url)}`;
  const existing = await chrome.tabs.query({ url: `${LOUPE_APP}*` });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true, url: loupeUrl });
  } else {
    await chrome.tabs.create({ url: loupeUrl });
  }
});

// Pure function injected into the page — no closure over extension variables
function extractStyles() {
  function rgbToHex(rgb) {
    if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return rgb;
    return "#" + [m[1], m[2], m[3]]
      .map(x => parseInt(x).toString(16).padStart(2, "0").toUpperCase())
      .join("");
  }

  const SYSTEM_FONTS = ["-apple-system", "BlinkMacSystemFont", "system-ui", "Arial", "Helvetica", "Georgia", "Times"];
  function isSystem(f) { return SYSTEM_FONTS.some(s => f.startsWith(s)); }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textMap = new Map();
  let node;

  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text || text.length < 2) continue;

    const el = node.parentElement;
    if (!el) continue;

    // Skip hidden elements
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (el.offsetParent === null && cs.position !== "fixed") continue;

    const fontFamily = cs.fontFamily.split(",")[0].replace(/['"]/g, "").trim();

    const entry = {
      text: text.slice(0, 60),
      fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: rgbToHex(cs.color),
    };

    // Prefer web font over system font for same text
    if (!textMap.has(text) || isSystem(textMap.get(text).fontFamily)) {
      textMap.set(text, entry);
    }
  }

  return [...textMap.values()];
}
