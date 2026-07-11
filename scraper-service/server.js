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

// Page screenshot as a data URL — clipped so huge pages don't blow up the
// response payload (Vercel proxies it and caps bodies around 4.5MB).
const SCREENSHOT_MAX_HEIGHT = 8000;
async function captureScreenshot(page, width) {
  const scrollHeight = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
  );
  const height = Math.min(scrollHeight, SCREENSHOT_MAX_HEIGHT);
  const buf = await page.screenshot({
    type: "jpeg",
    quality: 40,
    clip: { x: 0, y: 0, width, height },
  });
  return {
    dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
    width,
    height,
    truncated: scrollHeight > SCREENSHOT_MAX_HEIGHT,
    fullHeight: scrollHeight,
  };
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

    // Page-builder / CSS-in-JS tooling generates classes with no human
    // meaning ("elementor-element-db467a5", "css-a1b2c3"). Filtering these
    // out (plus a denylist of builder base classes present on every element)
    // is what keeps element names readable instead of raw selector soup.
    const GENERATED_CLASS_DENYLIST = new Set([
      "elementor-element", "elementor-widget", "elementor-widget-container",
      "e-con", "e-con-inner", "wp-block", "et_pb_module",
    ]);
    function isGeneratedClassToken(token) {
      if (GENERATED_CLASS_DENYLIST.has(token)) return true;
      if (/^elementor-element-[0-9a-z]+$/i.test(token)) return true;
      if (/-[0-9a-f]{5,}$/i.test(token)) return true;
      if (/^(css|sc|jsx|emotion|styled)-[a-z0-9]+$/i.test(token)) return true;
      return false;
    }
    function meaningfulClassLabel(el) {
      const tokens = String(el.className || "").trim().split(/\s+/).filter(Boolean).filter(t => !isGeneratedClassToken(t));
      return tokens.length > 0 ? `${el.tagName.toLowerCase()}.${tokens.slice(0, 2).join(".")}` : null;
    }

    const CAROUSEL_SLIDE_RE = /swiper-slide|slick-slide|owl-item|glide__slide|splide__slide|flickity-slide/i;
    const CAROUSEL_CONTAINER_RE = /swiper(?!-slide)|slick-(track|list|slider)|owl-carousel|owl-stage|glide__track|splide__track|flickity-viewport|carousel(?!-item)/i;

    // Walks up from a finding's element to see whether it sits inside a
    // known carousel/slider track, and whether that track's container
    // actually clips overflow. Off-screen slides are normal carousel
    // behavior — they only become a real bug when nothing clips them.
    function carouselContext(el) {
      let cur = el;
      let sawCarousel = false;
      while (cur && cur !== document.body) {
        const cls = String(cur.className || "");
        if (CAROUSEL_SLIDE_RE.test(cls) || CAROUSEL_CONTAINER_RE.test(cls)) {
          sawCarousel = true;
          let clipper = cur.parentElement;
          while (clipper && clipper !== document.body) {
            const cs = window.getComputedStyle(clipper);
            if (["hidden", "clip", "auto", "scroll"].includes(cs.overflowX)) {
              return { isCarouselSlide: true, carouselClipped: true };
            }
            clipper = clipper.parentElement;
          }
          return { isCarouselSlide: true, carouselClipped: false };
        }
        cur = cur.parentElement;
      }
      return { isCarouselSlide: sawCarousel, carouselClipped: false };
    }

    function labelFor(el) {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.slice(0, 80);
      const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      if (text) return text.slice(0, 80);
      const src = el.getAttribute("src");
      if (src) return src.split("/").pop()?.slice(0, 80) || el.tagName.toLowerCase();
      if (CAROUSEL_SLIDE_RE.test(String(el.className || ""))) return "Carousel slide";
      const classLabel = meaningfulClassLabel(el);
      if (classLabel) return classLabel;
      if (el.id && !isGeneratedClassToken(el.id)) return `#${el.id}`;
      return `Unlabeled <${el.tagName.toLowerCase()}> element`;
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

    // Human-readable page section for a finding — landmark ancestors first,
    // then the nearest preceding heading, then rough page position.
    function sectionNameFor(el) {
      let cur = el;
      while (cur && cur !== document.body) {
        const aria = cur.getAttribute?.("aria-label");
        const tag = cur.tagName;
        if (tag === "NAV") return aria ? `${aria} navigation` : "Navigation";
        if (tag === "HEADER") return "Page header";
        if (tag === "FOOTER") return "Footer";
        if (tag === "ASIDE") return aria || "Sidebar";
        if (tag === "SECTION" || tag === "ARTICLE") {
          const h = cur.querySelector("h1, h2, h3");
          const label = aria || h?.innerText?.trim()?.replace(/\s+/g, " ").slice(0, 50);
          if (label) return `${label} section`;
        }
        if (cur.matches?.("[role='dialog'], dialog, [class*='modal']")) return "Modal / dialog";
        if (cur.matches?.("[class*='megamenu'], [class*='mega-menu'], [class*='dropdown']")) return "Mega menu / dropdown";
        cur = cur.parentElement;
      }
      let nearest = null;
      for (const h of document.querySelectorAll("h1, h2, h3")) {
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) nearest = h;
      }
      const heading = nearest?.innerText?.trim()?.replace(/\s+/g, " ").slice(0, 50);
      if (heading) return `${heading} section`;
      const pageY = el.getBoundingClientRect().top + window.scrollY;
      const rel = pageY / Math.max(document.documentElement.scrollHeight, 1);
      return rel < 0.15 ? "Top of page" : rel > 0.85 ? "Bottom of page" : "Middle of page";
    }

    // Readable ancestor chain for the report's Element tree.
    function domPathFor(el) {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.documentElement && parts.length < 5) {
        // Reject aria-labels that are carousel/slide counters ("2 / 6") or
        // otherwise too short to identify the element meaningfully.
        const ariaRaw = cur.getAttribute?.("aria-label")?.trim();
        const aria = ariaRaw && ariaRaw.length >= 4 && !/^\d+\s*\/\s*\d+$/.test(ariaRaw) ? ariaRaw : null;
        const tag = cur.tagName.toLowerCase();
        let name;
        if (aria) name = aria.slice(0, 40);
        else if (tag === "nav") name = "Navigation";
        else if (tag === "header") name = "Header";
        else if (tag === "footer") name = "Footer";
        else if (tag === "main") name = "Main content";
        else if (CAROUSEL_SLIDE_RE.test(String(cur.className || ""))) name = "Carousel slide";
        else if (cur.id && !isGeneratedClassToken(cur.id)) name = `${tag}#${cur.id}`;
        else name = meaningfulClassLabel(cur) ?? tag;
        parts.unshift(name);
        cur = cur.parentElement;
      }
      if (parts[0] !== "body") parts.unshift("body");
      return parts;
    }

    // Only the computed CSS that can contribute to layout failures.
    function relevantCss(el) {
      const cs = window.getComputedStyle(el);
      const out = {};
      const DEFAULTS = { width: null, "min-width": "0px", "max-width": "none", position: "static", left: "auto", right: "auto", transform: "none", "white-space": "normal", "margin-left": "0px", "margin-right": "0px", display: null };
      for (const prop of Object.keys(DEFAULTS)) {
        const v = cs.getPropertyValue(prop);
        if (v && v !== DEFAULTS[prop]) out[prop] = v;
      }
      out["overflow-x"] = cs.overflowX;
      if (out.width && !/px/.test(out.width)) delete out.width;
      if (out.display === "block" || out.display === "inline") delete out.display;
      return out;
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
        section: el ? sectionNameFor(el) : "Whole page",
        domPath: el ? domPathFor(el) : ["document"],
        css: el ? relevantCss(el) : undefined,
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
      // Name the widest offending element instead of just "document".
      // No visibility filtering here: hidden off-canvas panels and utility
      // overlays still widen the scroll area, and they are the usual culprits.
      // Document order puts parents first, so >= lets the deepest element with
      // the same right edge win — the actual content, not its wrappers.
      let culprit = null;
      let culpritRect = null;
      for (const el of document.body.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right <= window.innerWidth + 2) continue;
        const carousel = carouselContext(el);
        if (carousel.isCarouselSlide && carousel.carouselClipped) continue;
        if (!culpritRect || rect.right >= culpritRect.right) {
          culprit = el;
          culpritRect = rect;
        }
      }
      add("horizontal_overflow", "high", culprit, "Page is wider than the viewport.", {
        viewportWidth: window.innerWidth,
        scrollWidth,
        overflowPx: scrollWidth - window.innerWidth,
        ...(culpritRect ? {
          width: Math.round(culpritRect.width),
          expectedMaxWidth: window.innerWidth,
          x: Math.round(culpritRect.left),
          y: Math.round(culpritRect.top),
        } : {}),
        ...(culprit ? carouselContext(culprit) : {}),
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
          ...carouselContext(el),
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
          ...carouselContext(el),
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
      const result = await inspectResponsive(page, viewport);
      result.screenshot = await captureScreenshot(page, viewport.width);
      results.push(result);
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

async function inspectAccessibility(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts?.ready?.catch?.(() => {});
    await new Promise(r => setTimeout(r, 600));
  });

  return page.evaluate(() => {
    const VALID_ROLES = new Set(["alert","alertdialog","application","article","banner","button","cell","checkbox","columnheader","combobox","complementary","contentinfo","definition","dialog","directory","document","feed","figure","form","grid","gridcell","group","heading","img","link","list","listbox","listitem","log","main","marquee","math","menu","menubar","menuitem","menuitemcheckbox","menuitemradio","navigation","none","note","option","presentation","progressbar","radio","radiogroup","region","row","rowgroup","rowheader","scrollbar","search","searchbox","separator","slider","spinbutton","status","switch","tab","table","tablist","tabpanel","term","textbox","timer","toolbar","tooltip","tree","treegrid","treeitem"]);

    function isVisible(el) {
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0" &&
        rect.width > 0 && rect.height > 0;
    }

    function isAssistiveHidden(el) {
      if (el.closest("[aria-hidden='true'], [hidden], template")) return true;
      const className = String(el.className || "").toLowerCase();
      return className.includes("screen-reader-text") || className.includes("sr-only") ||
        className.includes("visually-hidden") || className.includes("skip-link");
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
    const perType = {};
    const PER_TYPE_CAP = 12;
    function add(type, severity, el, details, metrics = {}) {
      const selector = el ? selectorFor(el) : "document";
      const key = `${type}:${selector}`;
      if (seen.has(key)) return;
      if ((perType[type] || 0) >= PER_TYPE_CAP) { perType[type] = (perType[type] || 0) + 1; return; }
      seen.add(key);
      perType[type] = (perType[type] || 0) + 1;
      const rect = el ? el.getBoundingClientRect() : null;
      issues.push({
        id: `a11y-${issues.length + 1}`,
        type,
        severity,
        element: el ? labelFor(el) : "document",
        selector,
        details,
        metrics: {
          ...(rect ? { x: Math.round(rect.left + window.scrollX), y: Math.round(rect.top + window.scrollY) } : {}),
          ...metrics,
        },
      });
    }

    // ---- Contrast helpers ----
    function parseColor(str) {
      const m = String(str).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }
    function blend(fg, bg) {
      const a = fg.a;
      return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
    }
    function luminance(c) {
      const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }
    function contrastRatio(a, b) {
      const l1 = luminance(a), l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    // Walk up for a solid background; bail (null) if a background image intervenes.
    function effectiveBackground(el) {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const cs = window.getComputedStyle(cur);
        if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
        const bg = parseColor(cs.backgroundColor);
        if (bg && bg.a >= 0.99) return bg;
        cur = cur.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    // ---- 1. Low contrast text ----
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const contrastChecked = new Set();
    let node;
    let textNodesChecked = 0;
    while ((node = walker.nextNode()) && textNodesChecked < 1500) {
      const text = node.textContent.trim();
      if (text.length < 3) continue;
      const el = node.parentElement;
      if (!el || contrastChecked.has(el)) continue;
      contrastChecked.add(el);
      if (!isVisible(el) || isAssistiveHidden(el)) continue;
      textNodesChecked++;
      const cs = window.getComputedStyle(el);
      let color = parseColor(cs.color);
      if (!color) continue;
      const bg = effectiveBackground(el);
      if (!bg) continue; // background image — cannot judge
      if (color.a < 1) color = blend(color, bg);
      const ratio = contrastRatio(color, bg);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;
      if (ratio < required) {
        add("low_contrast", ratio < 3 ? "high" : "medium", el, "Text contrast is below the WCAG AA minimum.", {
          contrastRatio: Math.round(ratio * 100) / 100,
          requiredRatio: required,
          fontSize: `${size}px`,
          textColor: cs.color,
          sampleText: text.slice(0, 50),
        });
      }
    }

    // ---- 2. Images without alt ----
    for (const img of document.querySelectorAll("img")) {
      if (!isVisible(img) || isAssistiveHidden(img)) continue;
      if (!img.hasAttribute("alt") && img.getAttribute("role") !== "presentation") {
        add("missing_alt", "medium", img, "Image has no alt attribute, so screen readers announce the file name or nothing.", {
          expected: "alt text (or alt=\"\" if decorative)",
          measured: "no alt attribute",
        });
      }
    }

    // ---- 3. Buttons / links without an accessible name ----
    for (const el of document.querySelectorAll("a[href], button, [role='button'], [role='link']")) {
      if (!isVisible(el) || isAssistiveHidden(el)) continue;
      const name = (el.innerText || "").trim() ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent?.trim()) ||
        el.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt") ||
        el.querySelector("svg title")?.textContent?.trim();
      if (!name) {
        add("unlabeled_control", "high", el, "Interactive element has no accessible name — screen readers announce nothing useful.", {
          expected: "visible text, aria-label, or labelled image",
          measured: "no accessible name",
        });
      }
    }

    // ---- 4. Form inputs without labels ----
    for (const input of document.querySelectorAll("input, select, textarea")) {
      const type = (input.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
      if (!isVisible(input) || isAssistiveHidden(input)) continue;
      const hasLabel = (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) ||
        input.closest("label") ||
        input.getAttribute("aria-label") ||
        input.getAttribute("aria-labelledby") ||
        input.getAttribute("title");
      if (!hasLabel) {
        const placeholderOnly = Boolean(input.getAttribute("placeholder"));
        add("input_missing_label", "high", input, placeholderOnly
          ? "Input relies on placeholder text only — placeholders disappear on typing and are not reliable labels."
          : "Form input has no label of any kind.", {
          expected: "label element, aria-label, or aria-labelledby",
          measured: placeholderOnly ? "placeholder only" : "no label",
        });
      }
    }

    // ---- 5. H1 usage + heading order ----
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .filter(h => isVisible(h) && !isAssistiveHidden(h));
    const h1s = headings.filter(h => h.tagName === "H1");
    if (h1s.length === 0) {
      add("missing_h1", "medium", null, "Page has no visible H1 — screen reader users lose the main landmark for what the page is about.", {
        expected: "exactly one H1",
        measured: "no H1",
      });
    } else if (h1s.length > 1) {
      add("multiple_h1", "low", h1s[1], "Page has more than one H1, which muddies the document outline.", {
        expected: "exactly one H1",
        measured: `${h1s.length} H1 elements`,
      });
    }
    let prevLevel = 0;
    for (const h of headings) {
      const level = +h.tagName[1];
      if (prevLevel > 0 && level > prevLevel + 1) {
        add("heading_order_skip", "low", h, `Heading level jumps from H${prevLevel} to H${level}, skipping levels in the outline.`, {
          expected: `H${prevLevel + 1} or lower`,
          measured: `H${level} after H${prevLevel}`,
        });
      }
      prevLevel = level;
    }

    // ---- 6. Small tap targets (WCAG 2.5.8 — 24px minimum) ----
    for (const el of document.querySelectorAll("a[href], button, input, select, [role='button']")) {
      if (!isVisible(el) || isAssistiveHidden(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) {
        add("small_tap_target", "low", el, "Interactive target is below the WCAG 24px minimum size.", {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          expectedMinWidth: 24,
          expectedMinHeight: 24,
        });
      }
    }

    // ---- 7. Missing focus styles (focus a sample and compare) ----
    const focusables = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"))
      .filter(el => isVisible(el) && !isAssistiveHidden(el))
      .slice(0, 60);
    const prevActive = document.activeElement;
    for (const el of focusables) {
      const before = window.getComputedStyle(el);
      const beforeSnapshot = `${before.outlineStyle}|${before.outlineWidth}|${before.boxShadow}|${before.backgroundColor}|${before.borderColor}|${before.textDecorationLine}`;
      try { el.focus({ preventScroll: true }); } catch { continue; }
      if (document.activeElement !== el) continue;
      const after = window.getComputedStyle(el);
      const afterSnapshot = `${after.outlineStyle}|${after.outlineWidth}|${after.boxShadow}|${after.backgroundColor}|${after.borderColor}|${after.textDecorationLine}`;
      const outlineGone = after.outlineStyle === "none" || parseFloat(after.outlineWidth) === 0;
      if (outlineGone && beforeSnapshot === afterSnapshot) {
        add("missing_focus_style", "medium", el, "Element shows no visible change when focused — keyboard users cannot see where they are.", {
          expected: "visible outline, ring, or style change on focus",
          measured: "no visual focus indicator",
        });
      }
    }
    try { prevActive?.focus?.({ preventScroll: true }); } catch {}
    if (document.activeElement && document.activeElement !== prevActive) document.activeElement.blur?.();

    // ---- 8. ARIA misuse ----
    for (const el of document.querySelectorAll("[role]")) {
      const role = el.getAttribute("role").trim().split(/\s+/)[0].toLowerCase();
      if (role && !VALID_ROLES.has(role)) {
        add("invalid_role", "medium", el, `role="${role}" is not a valid ARIA role, so assistive tech ignores it.`, {
          expected: "a valid ARIA role",
          measured: `role="${role}"`,
        });
      }
    }
    for (const el of document.querySelectorAll("[aria-hidden='true']")) {
      const focusable = el.matches("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")
        ? el
        : el.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
      if (focusable && isVisible(focusable)) {
        add("aria_hidden_focusable", "medium", focusable, "Element is focusable but inside aria-hidden — keyboard reaches it while screen readers cannot.", {
          expected: "aria-hidden content should not contain focusable elements",
          measured: "focusable element inside aria-hidden='true'",
        });
      }
    }
    for (const el of document.querySelectorAll("[aria-labelledby]")) {
      const ids = el.getAttribute("aria-labelledby").trim().split(/\s+/);
      const missing = ids.filter(id => !document.getElementById(id));
      if (missing.length > 0 && isVisible(el)) {
        add("broken_labelledby", "medium", el, "aria-labelledby points at an id that does not exist, so the element has no name.", {
          expected: "aria-labelledby referencing existing element ids",
          measured: `missing id: ${missing.join(", ")}`,
        });
      }
    }

    const truncatedTypes = Object.entries(perType)
      .filter(([, count]) => count > PER_TYPE_CAP)
      .map(([type, count]) => ({ type, total: count, shown: PER_TYPE_CAP }));

    return {
      issueCount: issues.length,
      issues,
      truncatedTypes,
      stats: {
        textElementsChecked: textNodesChecked,
        focusablesSampled: focusables.length,
        headings: headings.length,
      },
    };
  });
}

// POST /accessibility — WCAG-style checks on the rendered page
app.post("/accessibility", async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

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

    const result = await inspectAccessibility(page);
    const screenshot = await captureScreenshot(page, 1440);
    res.json({
      url,
      checkedAt: new Date().toISOString(),
      mode: "browser",
      screenshot,
      ...result,
    });
  } catch (err) {
    console.error("[accessibility] error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// Live-page equivalent of lib/figma-normalize.ts's NormalizedSnapshot —
// shaped so the exact same checkBrandConsistency() logic that runs on
// Figma data can run unmodified on a rendered webpage.
async function inspectBrand(page) {
  return page.evaluate(() => {
    function rgbToHex(rgb) {
      if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return null; // near-transparent, not a real fill
      return "#" + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, "0").toUpperCase()).join("");
    }

    function isVisible(el) {
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      if (rect.width < 2 || rect.height < 2) return false;
      // Screen-reader-only technique: real content pushed miles off-canvas
      // via a large negative offset. Not hidden by CSS visibility rules, so
      // isVisible() alone lets it through — it just isn't real page content.
      if (rect.right < -500 || rect.bottom < -500 || rect.left > 20000 || rect.top > 20000) return false;
      return true;
    }

    function labelFor(el) {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.slice(0, 60);
      const id = el.id ? `#${el.id}` : "";
      const cls = String(el.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}`;
    }

    // Human-readable page section for a finding — landmark ancestors first,
    // then the nearest preceding heading, then rough page position.
    function sectionNameFor(el) {
      let cur = el;
      while (cur && cur !== document.body) {
        const aria = cur.getAttribute?.("aria-label");
        const tag = cur.tagName;
        if (tag === "NAV") return aria ? `${aria} navigation` : "Navigation";
        if (tag === "HEADER") return "Page header";
        if (tag === "FOOTER") return "Footer";
        if (tag === "ASIDE") return aria || "Sidebar";
        if (tag === "SECTION" || tag === "ARTICLE") {
          const h = cur.querySelector("h1, h2, h3");
          const label = aria || h?.innerText?.trim()?.replace(/\s+/g, " ").slice(0, 50);
          if (label) return `${label} section`;
        }
        if (cur.matches?.("[role='dialog'], dialog, [class*='modal']")) return "Modal / dialog";
        cur = cur.parentElement;
      }
      let nearest = null;
      for (const h of document.querySelectorAll("h1, h2, h3")) {
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) nearest = h;
      }
      const heading = nearest?.innerText?.trim()?.replace(/\s+/g, " ").slice(0, 50);
      if (heading) return `${heading} section`;
      const pageY = el.getBoundingClientRect().top + window.scrollY;
      const rel = pageY / Math.max(document.documentElement.scrollHeight, 1);
      return rel < 0.15 ? "Top of page" : rel > 0.85 ? "Bottom of page" : "Middle of page";
    }

    function boundsOf(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) };
    }

    const SYSTEM_FONTS = new Set(["system-ui", "-apple-system", "blinkmacsystemfont", "sans-serif", "serif", "monospace", "arial", "helvetica", "times", "times new roman", "roboto"]);
    function firstBrandFont(fontFamily) {
      const fonts = String(fontFamily || "")
        .split(",")
        .map(font => font.replace(/['"]/g, "").trim())
        .filter(Boolean);
      return fonts.find(font => !SYSTEM_FONTS.has(font.toLowerCase())) || fonts[0] || "";
    }

    function hasVisibleText(el) {
      return Boolean(el.innerText && el.innerText.trim().length > 0);
    }

    function isInteractive(el) {
      return Boolean(el.closest("a, button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [tabindex]"));
    }

    function isMediaOrArtwork(el) {
      const identity = `${el.tagName} ${el.id || ""} ${String(el.className || "")} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      if (/^(IMG|PICTURE|VIDEO|CANVAS|SOURCE)$/i.test(el.tagName)) return true;
      if (el.closest("picture, video, canvas")) return true;
      if (el.querySelector("img, picture, video, canvas")) {
        const rect = el.getBoundingClientRect();
        if (!hasVisibleText(el) || rect.width * rect.height > 120000) return true;
      }
      return /\b(gallery|media|artwork|poster|photo|picture|image|product-image|animation|canvas|viewport-content)\b/.test(identity) &&
        !isInteractive(el);
    }

    function shouldInspectColorElement(el, cs) {
      if (isMediaOrArtwork(el)) return false;
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      const bg = rgbToHex(cs.backgroundColor);
      const border = cs.borderTopWidth !== "0px" ? rgbToHex(cs.borderTopColor) : null;
      if (!bg && !border) return false;
      if (area > 180000 && !hasVisibleText(el) && !isInteractive(el)) return false;
      if (area > 400000 && cs.backgroundImage && cs.backgroundImage !== "none") return false;
      return true;
    }

    const text_nodes = [];
    const color_nodes = [];
    const seenColorEls = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let count = 0;
    while ((node = walker.nextNode()) && count < 3000) {
      const text = node.textContent.trim();
      if (text.length < 2 || text.length > 300) continue;
      const el = node.parentElement;
      if (!el || !isVisible(el)) continue;
      count++;
      const cs = window.getComputedStyle(el);
      text_nodes.push({
        node_id: "", node_name: labelFor(el), content: text,
        font_family: firstBrandFont(cs.fontFamily),
        font_size: parseFloat(cs.fontSize) || 0,
        font_weight: parseInt(cs.fontWeight, 10) || 400,
        font_style: cs.fontStyle === "italic" ? "italic" : "normal",
        letter_spacing: 0, line_height_px: 0, text_align: cs.textAlign || "left",
        fill_color: rgbToHex(cs.color) || "#000000",
        style_id: null, fill_style_id: null,
        bounds: boundsOf(el), section: sectionNameFor(el),
      });
    }

    for (const el of document.body.querySelectorAll("*")) {
      if (!isVisible(el) || seenColorEls.has(el)) continue;
      const cs = window.getComputedStyle(el);
      if (!shouldInspectColorElement(el, cs)) continue;
      const bg = rgbToHex(cs.backgroundColor);
      const border = cs.borderTopWidth !== "0px" ? rgbToHex(cs.borderTopColor) : null;
      seenColorEls.add(el);
      color_nodes.push({
        node_id: "", node_name: labelFor(el), node_type: el.tagName,
        fill_color_hex: bg, fill_opacity: bg ? 1 : null,
        stroke_color_hex: border, stroke_width: border ? parseFloat(cs.borderTopWidth) : null,
        border_radius: parseFloat(cs.borderTopLeftRadius) || null, shadow: null,
        bounds: boundsOf(el), section: sectionNameFor(el),
      });
      if (color_nodes.length >= 1500) break;
    }

    const logo_nodes = [];
    const logoEls = document.querySelectorAll(
      "img[alt*='logo' i], [class*='logo' i], [id*='logo' i], svg[aria-label*='logo' i]"
    );
    function boxGap(a, b) {
      const hGap = Math.max(a.left - b.right, b.left - a.right, 0);
      const vGap = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
      if (hGap > 0 && vGap > 0) return Math.sqrt(hGap * hGap + vGap * vGap);
      return Math.max(hGap, vGap);
    }
    function boxOverlapRatio(a, b) {
      const left = Math.max(a.x, b.x), right = Math.min(a.x + a.width, b.x + b.width);
      const top = Math.max(a.y, b.y), bottom = Math.min(a.y + a.height, b.y + b.height);
      if (right <= left || bottom <= top) return 0;
      const inter = (right - left) * (bottom - top);
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      return smaller > 0 ? inter / smaller : 0;
    }

    // A real logo lockup is small and lives in the header — this also
    // throws out accidental matches like a body/html class that merely
    // contains the substring "logo", and third-party social/share icons
    // (e.g. a Facebook widget's "facebook-logo-button") sitting deep in
    // the page far from any real brand mark.
    const HEADER_ZONE_PX = 600;
    const candidates = [];
    for (const el of logoEls) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.width > 400 || rect.height > 200) continue;
      const pageY = rect.top + window.scrollY;
      if (pageY > HEADER_ZONE_PX) continue;
      candidates.push({ el, rect, area: rect.width * rect.height });
    }
    // Smallest first, so when a wrapper <a>/<div> and the <img> inside it
    // both match, the innermost (most specific) element wins and the
    // ancestor is dropped as a near-duplicate of the same visual logo.
    candidates.sort((a, b) => a.area - b.area);
    const accepted = [];
    for (const c of candidates) {
      if (accepted.length >= 10) break;
      const isDuplicate = accepted.some(a => boxOverlapRatio(
        { x: a.rect.left, y: a.rect.top, width: a.rect.width, height: a.rect.height },
        { x: c.rect.left, y: c.rect.top, width: c.rect.width, height: c.rect.height }
      ) > 0.6);
      if (isDuplicate) continue;
      accepted.push(c);
    }
    for (const { el, rect } of accepted) {
      const cs = window.getComputedStyle(el);
      const siblings = el.parentElement
        ? [...el.parentElement.children].filter(s => s !== el && isVisible(s))
        : [];
      const gaps = siblings.map(s => boxGap(rect, s.getBoundingClientRect()));
      logo_nodes.push({
        node_id: "", node_name: labelFor(el),
        bounds: { x: Math.round(rect.left + window.scrollX), y: Math.round(rect.top + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
        fill_color_hex: rgbToHex(cs.backgroundColor) || rgbToHex(cs.color),
        min_sibling_gap_px: gaps.length > 0 ? Math.round(Math.min(...gaps)) : null,
      });
    }

    return {
      frame_name: document.title || location.hostname,
      frame_bounds: null,
      text_nodes, color_nodes, spacing_nodes: [], logo_nodes,
      raw_node_count: text_nodes.length + color_nodes.length,
      visibility_stats: {},
    };
  });
}

// POST /brand-scan — live-page equivalent of the Figma brand-check data source
app.post("/brand-scan", async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

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

    const snapshot = await inspectBrand(page);
    const screenshot = await captureScreenshot(page, 1440);
    res.json({ url, checkedAt: new Date().toISOString(), snapshot, screenshot });
  } catch (err) {
    console.error("[brand-scan] error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true, version: "brand-scan-v4" }));

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
