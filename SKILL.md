# figma-live-compare skill

Extract computed styles from a live website and push them to Loupe so the Figma vs Live comparison can use real browser fonts.

## When to use
When the user asks to compare a Figma frame against a live site, or when Loupe shows "no live styles" and needs accurate font data.

## Steps

1. Ask the user for the live site URL if not provided.

2. Extract styles by running this script in the browser console on the live page (or via Playwright):

```js
(function() {
  function rgbToHex(rgb) {
    if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return rgb;
    return '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0').toUpperCase()).join('');
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set(), styles = [];
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
      fontFamily: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: rgbToHex(cs.color),
    });
  }
  return JSON.stringify(styles);
})()
```

3. Generate a session key: a short random string like `loupe-<6 random chars>`.

4. POST the styles to Loupe:

```
POST https://getloupe.vercel.app/api/extract-styles
Content-Type: application/json

{
  "sessionKey": "<generated key>",
  "styles": <extracted styles array>
}
```

5. Print the session key to the user:

```
Session key: loupe-abc123

Paste this into the "Claude session key" field in Loupe and click Run.
```

## Notes
- The session key is valid until the next extraction overwrites it.
- If the site uses Google Fonts or web fonts, run the extraction after the page has fully loaded (wait for fonts).
- The Loupe endpoint is at `https://getloupe.vercel.app/api/extract-styles`.
