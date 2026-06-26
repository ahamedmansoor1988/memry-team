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
  // Force-load all @font-face declared fonts before extracting computed styles
  await page.evaluate(async () => {
    const fontFamilies = [...document.styleSheets]
      .flatMap(sheet => {
        try { return [...sheet.cssRules]; } catch { return []; }
      })
      .filter(rule => rule instanceof CSSFontFaceRule)
      .map(rule => rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim());
    await Promise.all([
      document.fonts.ready,
      ...fontFamilies.map(f => document.fonts.load(`16px ${f}`)),
    ]);
    await new Promise(r => setTimeout(r, 500));
  });

  return page.evaluate(async () => {
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
        fontFamily: cs.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
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

    // Scroll through the full page to trigger viewport-gated font loads (Elementor etc.)
    await page.evaluate(async () => {
      const totalHeight = document.body.scrollHeight;
      const step = window.innerHeight;
      for (let y = 0; y < totalHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 50));
      }
      window.scrollTo(0, 0);
    });

    // Force-load every declared font family at multiple weights
    await page.evaluate(async () => {
      await document.fonts.ready;
      const families = [...new Set(
        [...document.fonts].map(f => f.family.replace(/['"]/g, "").trim())
      )];
      const weights = ["400", "500", "600", "700"];
      await Promise.all(
        families.flatMap(f => weights.map(w => document.fonts.load(`${w} 16px ${f}`).catch(() => {})))
      );
      await new Promise(r => setTimeout(r, 800));
    });

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
app.get("/health", (_req, res) => res.json({ ok: true, version: "scroll-preload-v6" }));

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
