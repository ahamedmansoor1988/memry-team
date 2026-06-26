chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "EXTRACT_STYLES") return;
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return sendResponse({ error: "No active tab" });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function rgbToHex(rgb) {
          if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
          const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) return rgb;
          return "#" + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,"0").toUpperCase()).join("");
        }
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
    });
    sendResponse({ styles: results[0]?.result ?? [] });
  });
  return true;
});
