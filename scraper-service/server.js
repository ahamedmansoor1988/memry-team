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
    // Wait for fonts and a settle window
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 500));

    // Try to force-load common web fonts found in the cascade
    const declaredFamilies = new Set();
    for (const sheet of [...document.styleSheets]) {
      try {
        for (const rule of [...(sheet.cssRules || [])]) {
          if (rule instanceof CSSFontFaceRule) {
            const f = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim();
            if (f) declaredFamilies.add(f);
          }
        }
      } catch {} // cross-origin stylesheet
    }
    await Promise.allSettled(
      [...declaredFamilies].map(f => document.fonts.load(`16px "${f}"`))
    );

    // Build loaded-font set after explicit loads
    const loadedSet = new Set(
      [...document.fonts]
        .filter(f => f.status === "loaded")
        .map(f => f.family.replace(/['"]/g, "").trim().toLowerCase())
    );

    // Read CSS-declared font-family from stylesheet rules
    // (bypasses computed-style fallback resolution when fonts aren't installed)
    function getDeclaredFont(el) {
      for (const sheet of [...document.styleSheets]) {
        try {
          const rules = [...(sheet.cssRules || [])];
          for (let i = rules.length - 1; i >= 0; i--) {
            const rule = rules[i];
            if (!(rule instanceof CSSStyleRule)) continue;
            const ff = rule.style.fontFamily;
            if (!ff || ff.includes("var(")) continue;
            try {
              if (el.matches(rule.selectorText)) {
                return ff.split(",")[0].replace(/['"]/g, "").trim();
              }
            } catch {}
          }
        } catch {}
      }
      return null;
    }

    function resolveFont(cs, el) {
      let family = cs.fontFamily;

      // Resolve CSS custom properties
      if (family.includes("var(")) {
        const varName = family.match(/var\(\s*(--[^,)\s]+)/)?.[1];
        if (varName) {
          const resolved = cs.getPropertyValue(varName).trim().replace(/['"]/g, "");
          if (resolved && !resolved.includes("var(")) family = resolved;
        }
      }

      // Walk the cascade — return first font that is actually loaded
      const cascade = family.split(",").map(f => f.replace(/['"]/g, "").trim());
      for (const f of cascade) {
        if (loadedSet.has(f.toLowerCase())) return f;
      }

      // Playwright has a full render engine, so fonts should load.
      // If still not in loadedSet, prefer CSS-declared over computed fallback.
      const cssFont = getDeclaredFont(el);
      if (cssFont) return cssFont;

      return cascade[0] || family;
    }

    function rgbToHex(rgb) {
      if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      return (
        "#" +
        [m[1], m[2], m[3]]
          .map(x => parseInt(x).toString(16).padStart(2, "0").toUpperCase())
          .join("")
      );
    }

    function isVisible(el) {
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0)
        return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.right < -200 || r.bottom < -200 || r.left > window.innerWidth + 200)
        return false;
      return true;
    }

    const selectors = "h1, h2, h3, h4, h5, h6, p, a, li, button, label, span, td, th";
    const elements = [...document.querySelectorAll(selectors)].filter(isVisible);

    const textMap   = new Map();
    const fontSet   = new Set();
    const sizeSet   = new Set();
    const weightSet = new Set();
    const colorSet  = new Set();

    for (const el of elements) {
      const text = (el.innerText || el.textContent || "").trim();
      if (!text || text.length < 2 || text.length > 200) continue;

      const cs       = window.getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize) || 0;
      if (fontSize < 8) continue;

      const font  = resolveFont(cs, el);
      const color = rgbToHex(cs.color);

      if (font)        fontSet.add(font);
      if (cs.fontSize) sizeSet.add(cs.fontSize);
      if (cs.fontWeight) weightSet.add(cs.fontWeight);
      if (color)       colorSet.add(color);

      const key      = text.slice(0, 60);
      const existing = textMap.get(key);
      if (!existing || fontSize > (existing._fontSize || 0)) {
        textMap.set(key, {
          text:       text.slice(0, 100),
          fontFamily: font,
          fontSize:   cs.fontSize,
          fontWeight: cs.fontWeight,
          color,
          _fontSize:  fontSize,
        });
      }
    }

    return {
      fonts:       [...fontSet],
      fontSizes:   [...sizeSet],
      fontWeights: [...weightSet],
      colors:      [...colorSet],
      styles:      [...textMap.values()]
        .map(({ _fontSize, ...rest }) => rest)
        .slice(0, 150),
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
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
