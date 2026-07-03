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

interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
}

interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  changedPixels: number;
  changedPercent: number;
  regions: DiffRegion[];
  diffDataUrl: string;
  sizeMismatch: boolean;
  baselineSize: { width: number; height: number };
  currentSize: { width: number; height: number };
}

const SCAN_STEPS = ["Upload baseline", "Upload new", "Compare pixels", "Review regions"];

// Per-channel-sum color distance above which a pixel counts as changed.
// Tolerates compression noise and font antialiasing without missing real edits.
const PIXEL_THRESHOLD = 48;
const REGION_CELL = 24;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name} as an image.`)); };
    img.src = url;
  });
}

function computeDiff(baseline: HTMLImageElement, current: HTMLImageElement): DiffResult {
  const width = Math.max(baseline.naturalWidth, current.naturalWidth);
  const height = Math.max(baseline.naturalHeight, current.naturalHeight);

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

  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext("2d")!;
  const out = diffCtx.createImageData(width, height);

  const cellsX = Math.ceil(width / REGION_CELL);
  const cellsY = Math.ceil(height / REGION_CELL);
  const cellChanged = new Uint32Array(cellsX * cellsY);

  let changedPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inA = x < baseline.naturalWidth && y < baseline.naturalHeight;
      const inB = x < current.naturalWidth && y < current.naturalHeight;
      let changed;
      if (inA !== inB) {
        changed = true; // area exists in only one screenshot
      } else {
        const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) +
          Math.abs(a[i + 3] - b[i + 3]);
        changed = delta > PIXEL_THRESHOLD;
      }
      if (changed) {
        changedPixels++;
        cellChanged[Math.floor(y / REGION_CELL) * cellsX + Math.floor(x / REGION_CELL)]++;
        out.data[i] = 236;
        out.data[i + 1] = 34;
        out.data[i + 2] = 118;
        out.data[i + 3] = 255;
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
      let minX = cx, maxX = cx, minY = cy, maxY = cy, pixels = 0;
      const queue = [start];
      visited[start] = 1;
      while (queue.length) {
        const cell = queue.pop()!;
        const x = cell % cellsX, y = Math.floor(cell / cellsX);
        pixels += cellChanged[cell];
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

  const totalPixels = width * height;
  return {
    width,
    height,
    totalPixels,
    changedPixels,
    changedPercent: Math.round((changedPixels / totalPixels) * 10000) / 100,
    regions: regions.slice(0, 20),
    diffDataUrl: diffCanvas.toDataURL("image/png"),
    sizeMismatch: baseline.naturalWidth !== current.naturalWidth || baseline.naturalHeight !== current.naturalHeight,
    baselineSize: { width: baseline.naturalWidth, height: baseline.naturalHeight },
    currentSize: { width: current.naturalWidth, height: current.naturalHeight },
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
            <h1 className="text-[17px] font-semibold">Screenshot Diff</h1>
            <p className="mt-0.5 text-[12px] text-[#71717a]">Compare two screenshots pixel by pixel. Everything runs in your browser — images never leave your machine.</p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">How it works</p>
          <div className="grid grid-cols-4 gap-2">
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="space-y-4">
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

            <button
              onClick={run}
              disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0f0f0f] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#1f1f23] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Compare screenshots
            </button>

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
                      Areas covered by only one screenshot are counted as changed.
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-black/[0.08] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[12px] font-semibold text-[#17171c]">Diff image</p>
                    <a
                      href={result.diffDataUrl}
                      download="loupe-screenshot-diff.png"
                      className="inline-flex items-center gap-1.5 text-[12px] text-[#71717a] hover:text-[#0f0f0f]"
                    >
                      <Download size={12} /> Download
                    </a>
                  </div>
                  <p className="mb-3 text-[11px] text-[#71717a]">Changed pixels in pink, top regions outlined. Unchanged content dimmed.</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.diffDataUrl} alt="Visual diff" className="w-full rounded-lg border border-black/[0.08]" />
                </div>

                {result.regions.length > 0 && (
                  <div className="rounded-xl border border-black/[0.08] bg-white p-4">
                    <p className="mb-3 text-[12px] font-semibold text-[#17171c]">Changed regions ({result.regions.length})</p>
                    <div className="space-y-1.5">
                      {result.regions.map((region, index) => (
                        <div key={index} className="flex items-center justify-between gap-3 rounded-lg bg-[#fafafa] px-3 py-2 text-[11px]">
                          <span className="text-[#4b5563]">
                            Region {index + 1} — at x:{region.x}, y:{region.y}, {region.width} x {region.height}px
                          </span>
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-medium text-[#17171c]">
                            {region.changedPixels.toLocaleString()} px
                          </span>
                        </div>
                      ))}
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
