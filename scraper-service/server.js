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
      if (process.env.BROWSERLESS_TOKEN) {
        console.log("[scraper] connecting to Browserless...");
        browser = await chromium.connectOverCDP(
          `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
        );
        console.log("[scraper] connected to Browserless");
      } else {
        const executablePath = process.env.CHROME_EXECUTABLE_PATH ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        console.log("[scraper] launching local Chrome...");
        browser = await chromium.launch({
          executablePath,
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        });
        console.log("[scraper] local Chrome ready");
      }
    } catch (err) {
      console.error("[scraper] browser startup failed:", err.message);
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

async function inspectResponsive(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts?.ready?.catch?.(() => {});
    await new Promise(r => setTimeout(r, 600));
  });

  return page.evaluate((vp) => {
    function isAssistiveOnly(el) {
      const className = String(el.className || "").toLowerCase();
      if (el.getAttribute("aria-hidden") === "true") return true;
      if (el.closest("[aria-hidden='true'], [hidden], template")) return true;
      return className.includes("screen-reader-text") ||
        className.includes("sr-only") ||
        className.includes("visually-hidden") ||
        className.includes("skip-link");
    }

    function isVisible(el) {
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        cs.opacity !== "0" &&
        cs.pointerEvents !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    }

    function isOnScreen(rect) {
      return rect.right > 1 &&
        rect.left < window.innerWidth - 1 &&
        rect.bottom > 1 &&
        rect.top < window.innerHeight - 1;
    }

    function isUtilityShell(el) {
      const id = String(el.id || "").toLowerCase();
      const className = String(el.className || "").toLowerCase();
      return id.includes("hs-web-interactives") ||
        className.includes("hs-web-interactives") ||
        className.includes("elementskit-menu-offcanvas-elements");
    }

    function labelFor(el) {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.slice(0, 80);
      const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      if (text) return text.slice(0, 80);
      const src = el.getAttribute("src");
      if (src) return src.split("/").pop()?.slice(0, 80) || el.tagName.toLowerCase();
      return el.id ? `#${el.id}` : el.className ? `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join(".")}` : el.tagName.toLowerCase();
    }

    function selectorFor(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        const tag = cur.tagName.toLowerCase();
        const cls = String(cur.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => `.${CSS.escape(c)}`).join("");
        parts.unshift(`${tag}${cls}`);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    }

    const issues = [];
    const seen = new Set();
    function add(type, severity, el, details, metrics = {}) {
      const selector = el ? selectorFor(el) : "document";
      const key = `${vp.name}:${type}:${selector}:${details}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({
        id: `${vp.name}-${issues.length + 1}`,
        viewport: vp.name,
        type,
        severity,
        element: el ? labelFor(el) : "document",
        selector,
        details,
        metrics: {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          ...metrics,
        },
      });
    }

    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth || 0);
    if (scrollWidth > window.innerWidth + 2) {
      add("horizontal_overflow", "high", null, "Document is wider than the viewport.", {
        viewportWidth: window.innerWidth,
        scrollWidth,
        overflowPx: scrollWidth - window.innerWidth,
      });
    }

    const elements = Array.from(document.body.querySelectorAll("*")).filter(el => {
      if (!isVisible(el) || isAssistiveOnly(el)) return false;
      const rect = el.getBoundingClientRect();
      return isOnScreen(rect);
    });
    for (const el of elements) {
      if (issues.length > 80) break;
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const text = (el.innerText || "").trim();

      if (rect.width > window.innerWidth + 2) {
        add("element_wider_than_viewport", "high", el, "Element is wider than the viewport.", {
          width: Math.round(rect.width),
          expectedMaxWidth: window.innerWidth,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }

      if ((rect.right > window.innerWidth + 2 || rect.left < -2) && isOnScreen(rect)) {
        add("element_outside_viewport", "medium", el, "Visible element extends outside the viewport bounds.", {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          expectedLeftMin: 0,
          expectedRightMax: window.innerWidth,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }

      const clipsX = el.scrollWidth > el.clientWidth + 2;
      const clipsY = el.scrollHeight > el.clientHeight + 2;
      const hidesOverflow = ["hidden", "clip", "auto", "scroll"].includes(cs.overflowX) || ["hidden", "clip", "auto", "scroll"].includes(cs.overflowY);
      if (text.length > 2 && hidesOverflow && (clipsX || clipsY) && !isUtilityShell(el)) {
        add("clipped_text", "high", el, "Text content appears clipped inside its container.", {
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          expectedWidthAtLeast: clipsX ? el.scrollWidth : el.clientWidth,
          expectedHeightAtLeast: clipsY ? el.scrollHeight : el.clientHeight,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }

      if (/\b(fixed|sticky)\b/.test(cs.position) &&
        text.length > 0 &&
        !isUtilityShell(el) &&
        rect.top <= 4 &&
        rect.height > Math.min(120, window.innerHeight * 0.18)) {
        add("sticky_covering_content", rect.height > window.innerHeight * 0.28 ? "high" : "medium", el, "Fixed or sticky element occupies a large top area.", {
          height: Math.round(rect.height),
          expectedMaxHeight: Math.round(window.innerHeight * 0.18),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }

      if ((el.matches("[role='dialog'], dialog, [class*='modal'], [class*='drawer']")) &&
        (rect.width > window.innerWidth || rect.height > window.innerHeight)) {
        add("oversized_modal", "high", el, "Dialog or modal is larger than the viewport.", {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          expectedMaxWidth: window.innerWidth,
          expectedMaxHeight: window.innerHeight,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }

      if (vp.name !== "desktop" &&
        (el.matches("a, button, input, select, textarea, [role='button'], [tabindex]")) &&
        rect.width > 0 && rect.height > 0 && (rect.width < 36 || rect.height < 36)) {
        add("small_tap_target", "low", el, "Interactive element is smaller than comfortable mobile tap target size.", {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          expectedMinWidth: 36,
          expectedMinHeight: 36,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const word = node.textContent?.match(/[^\s]{36,}/)?.[0];
      if (!word) continue;
      const el = node.parentElement;
      if (!el || !isVisible(el) || isAssistiveOnly(el) || !isOnScreen(el.getBoundingClientRect())) continue;
      const rect = el.getBoundingClientRect();
      add("long_unbroken_text", "medium", el, "Long unbroken text may force horizontal overflow on narrow screens.", {
        length: word.length,
        expectedWrap: true,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
      });
    }

    return {
      viewport: vp,
      scrollWidth,
      viewportWidth: window.innerWidth,
      issueCount: issues.length,
      issues,
    };
  }, viewport);
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

// POST /responsive — checks layout fit across viewport sizes
app.post("/responsive", async (req, res) => {
  const { url, viewports } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

  const checks = Array.isArray(viewports) && viewports.length > 0
    ? viewports
    : [
      { name: "mobile", width: 390, height: 844 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1440, height: 900 },
    ];

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.route("**/*", route => {
      const type = route.request().resourceType();
      if (type === "media") return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    const results = [];
    for (const viewport of checks) {
      results.push(await inspectResponsive(page, viewport));
    }

    res.json({
      url,
      checkedAt: new Date().toISOString(),
      mode: "browser",
      viewports: checks,
      issues: results.flatMap(r => r.issues),
      viewportResults: results,
    });
  } catch (err) {
    console.error("[responsive] error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true, version: "responsive-v1" }));

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
