const express = require("express");
const { chromium } = require("playwright");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Singleton browser — reused across requests, relaunched if it crashes
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",         // needed on Render free tier (low memory)
        "--disable-web-security",   // allow cross-origin font reads
      ],
    });
  }
  return browser;
}

// Font extraction — runs inside the page context via Playwright evaluate
async function extractStyles(page) {
  return page.evaluate(async () => {
    const systemFontNames = ["-apple-system", "blinkmacsystemfont", "system-ui", "arial", "helvetica", "sans-serif", "serif", "monospace"];
    function isSystem(font) {
      return systemFontNames.some(s => font.toLowerCase().startsWith(s));
    }

    // Build a set of web fonts actually loaded by the browser
    const loadedWebFonts = [...document.fonts]
      .filter(f => f.status === "loaded")
      .map(f => f.family.replace(/['"]/g, "").trim())
      .filter(f => !isSystem(f));

    // Primary font for page = most common loaded web font (by usage count on visible text)
    const fontUsage = new Map();
    for (const el of document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,button,li,span,td")) {
      const f = getComputedStyle(el).fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      if (!isSystem(f)) fontUsage.set(f, (fontUsage.get(f) ?? 0) + 1);
    }
    const pageDefaultFont = [...fontUsage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      ?? loadedWebFonts[0]
      ?? null;

    function getWebFont(el) {
      // Walk up to find an element whose computed font is a web font
      let current = el;
      for (let i = 0; i < 10; i++) {
        const font = getComputedStyle(current).fontFamily.split(",")[0].replace(/['"]/g, "").trim();
        if (!isSystem(font)) return font;
        if (!current.parentElement) break;
        current = current.parentElement;
      }
      // Fall back to most-used web font on the page
      return pageDefaultFont ?? getComputedStyle(el).fontFamily.split(",")[0].replace(/['"]/g, "").trim();
    }

    function rgbToHex(rgb) {
      if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return rgb;
      return "#" + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, "0").toUpperCase()).join("");
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen   = new Set();
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
        text:       text.slice(0, 60),
        fontFamily: getWebFont(el),
        fontSize:   cs.fontSize,
        fontWeight: cs.fontWeight,
        color:      rgbToHex(cs.color),
      });
    }

    const fontSet   = new Set(styles.map(s => s.fontFamily).filter(Boolean));
    const sizeSet   = new Set(styles.map(s => s.fontSize).filter(Boolean));
    const weightSet = new Set(styles.map(s => s.fontWeight).filter(Boolean));
    const colorSet  = new Set(styles.map(s => s.color).filter(Boolean));

    return {
      fonts:       [...fontSet],
      fontSizes:   [...sizeSet],
      fontWeights: [...weightSet],
      colors:      [...colorSet],
      styles:      styles.slice(0, 200),
    };
  });
}

// POST /scrape — main endpoint
app.post("/scrape", async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

  let page;
  try {
    const b = await getBrowser();
    page    = await b.newPage();

    // Block images/video but allow all fonts (including Google Fonts)
    await page.route("**/*", route => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media") return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    // Wait for fonts to load fully
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.fonts].map(f => f.load())));
    await page.waitForTimeout(500);

    const result = await extractStyles(page);
    res.json(result);
  } catch (err) {
    console.error("[scraper] error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true, version: "getWebFont-v4" }));

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
