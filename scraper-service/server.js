const express = require("express");
const { chromium } = require("playwright-core");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Browserless CDP connection — reconnects if dropped
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    try {
      console.log("[scraper] connecting to Browserless...");
      browser = await chromium.connectOverCDP(
        `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
      );
      console.log("[scraper] connected to Browserless");
    } catch (err) {
      console.error("[scraper] Browserless connection failed:", err.message);
      throw err;
    }
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

    // Build a map of CSS selector → first declared font-family (before fallbacks)
    // This gives us the *intended* font, not the fallback the headless browser rendered
    const declaredFontMap = new Map();
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = [...sheet.cssRules]; } catch { continue; }
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule && rule.style.fontFamily) {
            const firstFont = rule.style.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
            if (firstFont) declaredFontMap.set(rule.selectorText, firstFont);
          }
        }
      }
    } catch {}

    function getDeclaredFont(el) {
      // Walk up to find an element that matches a CSS rule with explicit font-family
      let cur = el;
      while (cur && cur !== document.body) {
        for (const [sel, font] of declaredFontMap) {
          try {
            if (cur.matches(sel)) return font;
          } catch {}
        }
        cur = cur.parentElement;
      }
      return null;
    }

    const SYSTEM_FONTS = ["-apple-system", "BlinkMacSystemFont", "system-ui", "Roboto", "Arial", "Helvetica", "Georgia", "Times"];
    function isSystemFont(f) { return SYSTEM_FONTS.some(s => f.startsWith(s)); }
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
      if (el.closest("template, dialog:not([open])")) return "skippedHiddenSelf";
      if (cs.clipPath === "inset(100%)") return "skippedSrOnly";
      if (cs.clip === "rect(0px, 0px, 0px, 0px)") return "skippedSrOnly";
      if (rect.width === 0 || rect.height === 0) return "skippedZeroSize";
      return null;
    }

    const walker  = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
    let node;

    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!isValidCapturedText(text)) continue;
      visibilityStats.textNodesTotal++;

      const el = node.parentElement;
      if (!el) continue;
      const cs              = window.getComputedStyle(el);
      const rect            = el.getBoundingClientRect();
      const reason          = hiddenReason(el, cs, rect);
      if (reason) { visibilityStats[reason]++; continue; }
      visibilityStats.diffCandidates++;
      if (text.toLowerCase().includes("sign")) {
        console.log("[raw-font]", text, "|", cs.fontFamily);
      }
      const computedFont    = cs.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      // Prefer the first declared font (intended) over computed (rendered fallback)
      const declaredFont    = getDeclaredFont(el);
      const fontFamily      = (declaredFont && !isSystemFont(declaredFont)) ? declaredFont : computedFont;

      const entry = {
        text:       text.slice(0, 60),
        fontFamily,
        fontSize:   cs.fontSize,
        fontWeight: cs.fontWeight,
        color:      rgbToHex(cs.color),
      };

      // Keep web font over system font when same text appears multiple times
      if (!textMap.has(text) || isSystemFont(textMap.get(text).fontFamily)) {
        textMap.set(text, entry);
      }
    }

    // Debug: log font info for sign-in elements
    for (const [text, entry] of textMap) {
      if (text.toLowerCase().includes("sign")) {
        console.log("[font-debug]", JSON.stringify({ text, fontFamily: entry.fontFamily }));
      }
    }

    const styles = [...textMap.values()];

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
      visibilityStats,
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
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on("console", msg => console.log("[browser]", msg.text()));

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
      // Force reflow so browser applies loaded fonts to computed styles
      document.body.style.opacity = "0.99";
      document.body.offsetHeight; // trigger layout
      document.body.style.opacity = "";
      await new Promise(r => setTimeout(r, 1500));
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
app.get("/health", (_req, res) => res.json({ ok: true, version: "dedup-v2" }));

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
