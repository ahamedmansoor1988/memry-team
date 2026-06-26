// Signal that the extension is installed
localStorage.setItem("loupe_extension_present", String(Date.now()));

function rgbToHex(rgb) {
  if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return rgb;
  return "#" + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, "0").toUpperCase()).join("");
}

function extractStyles() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  const styles = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text || text.length < 2 || seen.has(text)) continue;
    seen.add(text);
    const el = node.parentElement;
    if (!el) continue;
    const cs = window.getComputedStyle(el);
    styles.push({
      text: text.slice(0, 60),
      fontFamily: cs.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: rgbToHex(cs.color),
    });
  }
  return styles;
}

// Watch for scrape requests from the Loupe web app
function checkForRequest() {
  try {
    const raw = localStorage.getItem("loupe_scrape_request");
    if (!raw) return;
    const req = JSON.parse(raw);
    // Only process requests for the current page URL
    if (!req?.url || !window.location.href.startsWith(req.url.split("?")[0])) return;
    // Don't process the same request twice
    const lastHandled = localStorage.getItem("loupe_scrape_handled");
    if (lastHandled === String(req.timestamp)) return;
    localStorage.setItem("loupe_scrape_handled", String(req.timestamp));

    const styles = extractStyles();
    localStorage.setItem("loupe_bridge_styles", JSON.stringify({ styles }));
    localStorage.setItem("loupe_scrape_status", JSON.stringify({ status: "ready" }));
    localStorage.setItem("loupe_extension_present", String(Date.now()));
  } catch {}
}

// Check on load and poll for new requests
checkForRequest();
setInterval(checkForRequest, 1000);
