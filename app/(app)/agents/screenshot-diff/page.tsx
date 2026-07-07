"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  GitCompareArrows,
  ImagePlus,
  Loader2,
  Play,
  X,
} from "lucide-react";
import { BetaTag } from "@/app/(app)/_sidebar";
import { ScanHelpToggle } from "@/components/scan-help-toggle";

interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
  outOfBoundsPixels: number;
  baselineCrop: string;
  currentCrop: string;
}

interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  changedPixels: number;
  changedPercent: number;
  outOfBoundsPixels: number;
  outOfBoundsPercent: number;
  regions: DiffRegion[];
  diffDataUrl: string;
  sizeMismatch: boolean;
  baselineSize: { width: number; height: number };
  currentSize: { width: number; height: number };
  shiftDetectedPx: number | null;
}

const SCAN_STEPS = ["Upload baseline", "Upload new", "Compare pixels", "Review regions"];

// Per-channel-sum color distance above which a pixel counts as changed.
// Tolerates compression noise and font antialiasing without missing real edits.
const PIXEL_THRESHOLD = 48;
const REGION_CELL = 24;

function OnboardingPanels() {
  return (
    <div className="mb-5 rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">How it works</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SCAN_STEPS.map((step, index) => (
          <div key={step} className="rounded-lg bg-white px-3 py-3">
            <div className="mb-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#0f0f0f] text-[10px] font-semibold text-white">
              {index + 1}
            </div>
            <p className="text-[11px] font-medium leading-tight text-[#17171c]">{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name} as an image.`)); };
    img.src = url;
  });
}

const MAX_SHIFT_PX = 160;
const SHIFT_SAMPLE_GRID = 48;

/**
 * Detects a uniform vertical shift between two same-size screenshots — the
 * signature of a cookie banner, promo bar, or ad changing height. Naive
 * pixel-index diffing reads this as a huge change even though the actual
 * content is identical, just moved. Only reports a shift when aligning at
 * that offset makes the images look nearly identical (a real content edit
 * would not align cleanly at any single offset).
 */
function detectVerticalShift(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number) {
  const maxShift = Math.min(MAX_SHIFT_PX, Math.floor(height / 3));
  if (maxShift < 4) return null;

  const bandStart = maxShift;
  const bandEnd = height - maxShift;
  if (bandEnd <= bandStart) return null;

  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < SHIFT_SAMPLE_GRID; i++) {
    rows.push(bandStart + Math.floor((i + 0.5) * (bandEnd - bandStart) / SHIFT_SAMPLE_GRID));
    cols.push(Math.floor((i + 0.5) * width / SHIFT_SAMPLE_GRID));
  }

  function scoreAt(dy: number) {
    let total = 0;
    for (const y of rows) {
      const by = y + dy;
      const rowBase = y * width;
      const bRowBase = by * width;
      for (const x of cols) {
        const ai = (rowBase + x) * 4;
        const bi = (bRowBase + x) * 4;
        total += Math.abs(a[ai] - b[bi]) + Math.abs(a[ai + 1] - b[bi + 1]) + Math.abs(a[ai + 2] - b[bi + 2]);
      }
    }
    return total;
  }

  const zeroScore = scoreAt(0);
  let bestDy = 0;
  let bestScore = zeroScore;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    if (dy === 0) continue;
    const s = scoreAt(dy);
    if (s < bestScore) { bestScore = s; bestDy = dy; }
  }

  const sampleCount = rows.length * cols.length;
  const maxPossible = sampleCount * 255 * 3;
  const bestRatio = bestScore / maxPossible;
  // Require both a large improvement over "no shift" and a genuinely close
  // alignment — a real edit might coincidentally score a little better at
  // some offset, but won't look this clean.
  const improvedEnough = bestDy !== 0 && bestScore < zeroScore * 0.35 && bestRatio < 0.08;
  return improvedEnough ? bestDy : null;
}

function computeDiff(baseline: HTMLImageElement, current: HTMLImageElement): DiffResult {
  const width = Math.max(baseline.naturalWidth, current.naturalWidth);
  const height = Math.max(baseline.naturalHeight, current.naturalHeight);
  const sizeMismatch = baseline.naturalWidth !== current.naturalWidth || baseline.naturalHeight !== current.naturalHeight;

  function pixelsOf(img: HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  }

  const a = pixelsOf(baseline);
  const b = pixelsOf(current);
  const shiftDy = sizeMismatch ? null : detectVerticalShift(a, b, width, height);

  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext("2d")!;
  const out = diffCtx.createImageData(width, height);

  const cellsX = Math.ceil(width / REGION_CELL);
  const cellsY = Math.ceil(height / REGION_CELL);
  const cellChanged = new Uint32Array(cellsX * cellsY);
  const cellOutOfBounds = new Uint8Array(cellsX * cellsY);

  let changedPixels = 0;
  let outOfBoundsPixels = 0;
  for (let y = 0; y < height; y++) {
    const by = y + (shiftDy ?? 0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inA = x < baseline.naturalWidth && y < baseline.naturalHeight;
      const byInCanvas = by >= 0 && by < height;
      const inB = byInCanvas && x < current.naturalWidth && by < current.naturalHeight;
      const onlyInOne = inA !== inB;
      let changed;
      if (onlyInOne) {
        changed = true;
      } else {
        const bi = (by * width + x) * 4;
        const delta = Math.abs(a[i] - b[bi]) + Math.abs(a[i + 1] - b[bi + 1]) + Math.abs(a[i + 2] - b[bi + 2]) +
          Math.abs(a[i + 3] - b[bi + 3]);
        changed = delta > PIXEL_THRESHOLD;
      }
      if (changed) {
        changedPixels++;
        const cell = Math.floor(y / REGION_CELL) * cellsX + Math.floor(x / REGION_CELL);
        cellChanged[cell]++;
        if (onlyInOne) {
          outOfBoundsPixels++;
          cellOutOfBounds[cell] = 1;
          // Muted amber for "only in one screenshot" — a size/crop mismatch,
          // not a visual regression. Keeps it visually distinct from pink
          // (real pixel-level changes) so the two causes aren't confused.
          out.data[i] = 217;
          out.data[i + 1] = 119;
          out.data[i + 2] = 6;
          out.data[i + 3] = 255;
        } else {
          out.data[i] = 236;
          out.data[i + 1] = 34;
          out.data[i + 2] = 118;
          out.data[i + 3] = 255;
        }
      } else {
        // dimmed grayscale baseline so changes stand out
        const gray = (a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114) * 0.35 + 160;
        out.data[i] = gray;
        out.data[i + 1] = gray;
        out.data[i + 2] = gray;
        out.data[i + 3] = 255;
      }
    }
  }
  diffCtx.putImageData(out, 0, 0);

  // Merge changed grid cells into connected regions (4-neighbour BFS),
  // then report each region's bounding box.
  const visited = new Uint8Array(cellsX * cellsY);
  const regions: DiffRegion[] = [];
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const start = cy * cellsX + cx;
      if (visited[start] || cellChanged[start] === 0) continue;
      let minX = cx, maxX = cx, minY = cy, maxY = cy, pixels = 0, oob = 0;
      const queue = [start];
      visited[start] = 1;
      while (queue.length) {
        const cell = queue.pop()!;
        const x = cell % cellsX, y = Math.floor(cell / cellsX);
        pixels += cellChanged[cell];
        if (cellOutOfBounds[cell]) oob += cellChanged[cell];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (const n of [cell - 1, cell + 1, cell - cellsX, cell + cellsX]) {
          if (n < 0 || n >= cellChanged.length || visited[n] || cellChanged[n] === 0) continue;
          if ((n === cell - 1 && x === 0) || (n === cell + 1 && x === cellsX - 1)) continue;
          visited[n] = 1;
          queue.push(n);
        }
      }
      regions.push({
        x: minX * REGION_CELL,
        y: minY * REGION_CELL,
        width: Math.min((maxX - minX + 1) * REGION_CELL, width - minX * REGION_CELL),
        height: Math.min((maxY - minY + 1) * REGION_CELL, height - minY * REGION_CELL),
        changedPixels: pixels,
        outOfBoundsPixels: oob,
        baselineCrop: "",
        currentCrop: "",
      });
    }
  }
  regions.sort((r1, r2) => r2.changedPixels - r1.changedPixels);

  // Outline the top regions on the diff image
  diffCtx.strokeStyle = "#0f0f0f";
  diffCtx.lineWidth = Math.max(2, Math.round(width / 600));
  diffCtx.setLineDash([6, 4]);
  for (const region of regions.slice(0, 12)) {
    diffCtx.strokeRect(region.x + 1, region.y + 1, region.width - 2, region.height - 2);
  }

  // Crop a small before/after preview per top region so a finding can be
  // understood at a glance, instead of hunting for it in one huge diff image.
  const CROP_PAD = 16;
  const TOP_REGIONS_WITH_CROPS = 10;
  function cropOf(img: HTMLImageElement, rx: number, ry: number, rw: number, rh: number) {
    const sx = Math.max(0, rx - CROP_PAD);
    const sy = Math.max(0, ry - CROP_PAD);
    const sw = Math.min(width, rx + rw + CROP_PAD) - sx;
    const sh = Math.min(height, ry + rh + CROP_PAD) - sy;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    const srcSx = Math.min(sx, img.naturalWidth);
    const srcSw = Math.max(0, Math.min(sw, img.naturalWidth - srcSx));
    const srcSy = Math.min(sy, img.naturalHeight);
    const srcSh = Math.max(0, Math.min(sh, img.naturalHeight - srcSy));
    if (srcSw > 0 && srcSh > 0) {
      ctx.drawImage(img, srcSx, srcSy, srcSw, srcSh, srcSx - sx, srcSy - sy, srcSw, srcSh);
    }
    return canvas.toDataURL("image/png");
  }
  for (const region of regions.slice(0, TOP_REGIONS_WITH_CROPS)) {
    region.baselineCrop = cropOf(baseline, region.x, region.y, region.width, region.height);
    region.currentCrop = cropOf(current, region.x, region.y + (shiftDy ?? 0), region.width, region.height);
  }

  const totalPixels = width * height;
  return {
    width,
    height,
    totalPixels,
    changedPixels,
    changedPercent: Math.round((changedPixels / totalPixels) * 10000) / 100,
    outOfBoundsPixels,
    outOfBoundsPercent: Math.round((outOfBoundsPixels / totalPixels) * 10000) / 100,
    regions: regions.slice(0, 20),
    diffDataUrl: diffCanvas.toDataURL("image/png"),
    sizeMismatch,
    baselineSize: { width: baseline.naturalWidth, height: baseline.naturalHeight },
    currentSize: { width: current.naturalWidth, height: current.naturalHeight },
    shiftDetectedPx: shiftDy,
  };
}

function UploadSlot({ label, file, previewUrl, onFile, onClear }: {
  label: string;
  file: File | null;
  previewUrl: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`relative flex min-h-[180px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
        dragging ? "border-[#0f0f0f] bg-black/[0.03]" : "border-black/[0.12] bg-[#fafafa]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      {previewUrl ? (
        <>
          <button
            onClick={onClear}
            className="absolute right-2 top-2 z-10 rounded-full bg-white p-1 shadow hover:bg-[#f5f5f7]"
            title="Remove"
          >
            <X size={13} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={label} className="max-h-[220px] w-auto max-w-full rounded-lg border border-black/[0.08] object-contain" />
          <p className="mt-2 truncate text-[11px] text-[#71717a]">{file?.name}</p>
        </>
      ) : (
        <button onClick={() => inputRef.current?.click()} className="flex flex-col items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05]">
            <ImagePlus size={17} className="text-[#4b5563]" />
          </span>
          <span className="text-[13px] font-semibold text-[#17171c]">{label}</span>
          <span className="text-[11px] text-[#71717a]">Click to browse or drop an image</span>
        </button>
      )}
    </div>
  );
}

export default function ScreenshotDiffAgentPage() {
  const [baseline, setBaseline] = useState<File | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [baselineUrl, setBaselineUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiffResult | null>(null);

  const canRun = Boolean(baseline && current && !running);

  const setFile = useCallback((slot: "baseline" | "current", file: File) => {
    const url = URL.createObjectURL(file);
    if (slot === "baseline") {
      setBaseline(file);
      setBaselineUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } else {
      setCurrent(file);
      setCurrentUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    }
    setResult(null);
    setError(null);
  }, []);

  async function run() {
    if (!baseline || !current) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const [imgA, imgB] = await Promise.all([loadImageFromFile(baseline), loadImageFromFile(current)]);
      // Yield a frame so the spinner renders before the pixel loop blocks the thread
      await new Promise(r => setTimeout(r, 30));
      setResult(computeDiff(imgA, imgB));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white text-[#0f0f0f]">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex items-center gap-3 border-b border-black/[0.06] pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/[0.04]">
            <GitCompareArrows size={17} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-[17px] font-semibold">Screenshot Diff <BetaTag /></h1>
            <p className="mt-0.5 text-[12px] text-[#71717a]">Compare two screenshots pixel by pixel. Everything runs in your browser — images never leave your machine.</p>
          </div>
        </div>

        <ScanHelpToggle>
          <OnboardingPanels />
        </ScanHelpToggle>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="space-y-4">
            <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
              <UploadSlot
                label="Baseline screenshot"
                file={baseline}
                previewUrl={baselineUrl}
                onFile={f => setFile("baseline", f)}
                onClear={() => { setBaseline(null); if (baselineUrl) URL.revokeObjectURL(baselineUrl); setBaselineUrl(null); setResult(null); }}
              />
              <UploadSlot
                label="New screenshot"
                file={current}
                previewUrl={currentUrl}
                onFile={f => setFile("current", f)}
                onClear={() => { setCurrent(null); if (currentUrl) URL.revokeObjectURL(currentUrl); setCurrentUrl(null); setResult(null); }}
              />
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-[#71717a]">
                  Images stay local. Loupe highlights changed pixels and groups nearby edits.
                </p>
                <button
                  onClick={run}
                  disabled={!canRun}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0f0f0f] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#1f1f23] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Compare screenshots
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            {result && (
              <div className="space-y-3">
                {result.sizeMismatch && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[12px] font-medium text-amber-800">Screenshot sizes differ</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">
                      Baseline is {result.baselineSize.width} x {result.baselineSize.height}px, new is {result.currentSize.width} x {result.currentSize.height}px.
                      Areas covered by only one screenshot are shown in amber below and counted separately from real pixel changes.
                    </p>
                  </div>
                )}

                {result.outOfBoundsPercent > result.changedPercent / 2 && result.outOfBoundsPercent > 3 && (
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3.5">
                    <p className="text-[13px] font-semibold text-amber-900">Most of this diff is a size mismatch, not a real content change</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
                      {result.outOfBoundsPercent}% of the {result.changedPercent}% marked "changed" only exists in one screenshot (amber areas below). For an accurate comparison, capture both screenshots at the same size, or crop them to match before uploading.
                    </p>
                  </div>
                )}

                {result.shiftDetectedPx !== null && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                    <p className="text-[12px] font-medium text-blue-800">
                      Content shifted {result.shiftDetectedPx > 0 ? "down" : "up"} by {Math.abs(result.shiftDetectedPx)}px
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-blue-700">
                      Likely a banner, ad, or dynamic content area changing height — not necessarily a bug. The comparison below is aligned to account for this shift, so the shift itself is not counted as a change.
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold text-[#17171c]">Visual diff</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#71717a]">
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#ec2276" }} /> Real pixel change</span>
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#d97706" }} /> Only in one screenshot</span>
                        <span>Dashed boxes mark the largest regions.</span>
                      </p>
                    </div>
                    <a
                      href={result.diffDataUrl}
                      download="loupe-screenshot-diff.png"
                      className="inline-flex items-center gap-1.5 text-[12px] text-[#71717a] hover:text-[#0f0f0f]"
                    >
                      <Download size={12} /> Download
                    </a>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.diffDataUrl} alt="Visual diff" className="w-full rounded-lg border border-black/[0.08]" />
                </div>

                {result.regions.length > 0 && (
                  <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
                    <p className="mb-1 text-[13px] font-semibold text-[#17171c]">Where to inspect</p>
                    <p className="mb-3 text-[11px] text-[#71717a]">Largest regions first, with a before/after crop so you can see the change without hunting through the full diff.</p>
                    <div className="space-y-2">
                      {result.regions.map((region, index) => {
                        const mostlyOutOfBounds = region.outOfBoundsPixels > region.changedPixels * 0.6;
                        return (
                          <div key={index} className="rounded-lg bg-[#fafafa] p-3">
                            <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
                              <span className="font-medium text-[#17171c]">
                                Region {index + 1}
                                {mostlyOutOfBounds && (
                                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Size mismatch</span>
                                )}
                              </span>
                              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-medium text-[#4b5563]">
                                {region.changedPixels.toLocaleString()} px changed
                              </span>
                            </div>
                            {region.baselineCrop && region.currentCrop ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">Before</p>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={region.baselineCrop} alt={`Region ${index + 1} before`} className="w-full rounded border border-black/[0.08]" />
                                </div>
                                <div>
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">After</p>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={region.currentCrop} alt={`Region ${index + 1} after`} className="w-full rounded border border-black/[0.08]" />
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] text-[#71717a]">at x:{region.x}, y:{region.y}, {region.width} x {region.height}px</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Summary</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? `${result.changedPercent}%` : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Pixels changed</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? result.regions.length : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Regions</p>
              </div>
              <div className="col-span-2 rounded-lg bg-white p-3">
                <p className="text-[13px] font-semibold leading-none">{result ? `${result.changedPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()}` : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Changed / total pixels</p>
              </div>
            </div>
            <div className="mt-4 border-t border-black/[0.06] pt-3">
              <p className="text-[11px] leading-relaxed text-[#71717a]">
                {result
                  ? `Compared at ${result.width} x ${result.height}px. Small color noise from compression is tolerated; real edits are flagged.`
                  : "Upload a baseline and a new screenshot, then compare. Ideal for catching unintended visual changes after a deploy."}
              </p>
            </div>
            {!result && (
              <div className="mt-4 border-t border-black/[0.06] pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Output</p>
                <div className="space-y-2 text-[11px] text-[#71717a]">
                  <p>A diff image with changed pixels highlighted and top regions outlined.</p>
                  <p>Changed-pixel percentage and a list of changed regions with position and size.</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
