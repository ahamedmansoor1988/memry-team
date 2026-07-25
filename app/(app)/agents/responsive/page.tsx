"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Globe2, MonitorCheck, Play, RefreshCw, RotateCw } from "lucide-react";

const STUDIO_PRESETS = [
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, group: "Phone" },
  { id: "iphone-15-pro", label: "iPhone 15 Pro", width: 393, height: 852, group: "Phone" },
  { id: "pixel-8", label: "Pixel 8", width: 412, height: 915, group: "Phone" },
  { id: "ipad-pro", label: "iPad Pro", width: 1024, height: 1366, group: "Tablet" },
  { id: "macbook-air", label: "MacBook Air", width: 1280, height: 832, group: "Laptop" },
  { id: "macbook-pro", label: "MacBook Pro", width: 1440, height: 900, group: "Laptop" },
  { id: "full-hd", label: "Full HD", width: 1920, height: 1080, group: "Monitor" },
  { id: "2k-monitor", label: "2K Monitor", width: 2560, height: 1440, group: "Monitor" },
];

const PRESET_GROUPS = ["Phone", "Tablet", "Laptop", "Monitor"] as const;
const ZOOM_OPTIONS = [
  { id: "fit", label: "Fit to screen" },
  { id: "1", label: "100%" },
  { id: "0.75", label: "75%" },
  { id: "0.5", label: "50%" },
];

export default function ResponsiveAgentPage() {
  const [url, setUrl] = useState("");
  const [activePresetId, setActivePresetId] = useState(STUDIO_PRESETS[0].id);
  const [customWidth, setCustomWidth] = useState(1440);
  const [customHeight, setCustomHeight] = useState(900);
  const [frameKey, setFrameKey] = useState(0);
  const [zoomMode, setZoomMode] = useState("fit");
  const [fitScale, setFitScale] = useState(1);
  const [embedEnabled, setEmbedEnabled] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const activePreset = STUDIO_PRESETS.find(preset => preset.id === activePresetId);
  const studioViewport = activePreset ?? {
    id: "custom",
    label: "Custom",
    width: Math.max(customWidth, 280),
    height: Math.max(customHeight, 280),
  };
  const previewUrl = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }, [url]);
  const canPreview = previewUrl.startsWith("http") && previewUrl.includes(".");
  const previewHost = useMemo(() => {
    try {
      return canPreview ? new URL(previewUrl).hostname : "";
    } catch {
      return "";
    }
  }, [canPreview, previewUrl]);
  const previewScale = zoomMode === "fit" ? fitScale : Number(zoomMode);

  useEffect(() => {
    setEmbedEnabled(true);
  }, [previewUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateScale = () => {
      const rect = stage.getBoundingClientRect();
      const availableWidth = Math.max(rect.width - 72, 320);
      const availableHeight = Math.max(rect.height - 88, 280);
      const nextScale = Math.min(1, availableWidth / studioViewport.width, availableHeight / studioViewport.height);
      setFitScale(Math.max(0.18, Number(nextScale.toFixed(3))));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [studioViewport.width, studioViewport.height, panelOpen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get("url");
    const deviceParam = params.get("device");
    const widthParam = Number(params.get("width"));
    const heightParam = Number(params.get("height"));
    if (!urlParam?.startsWith("http")) return;

    setUrl(urlParam);
    if (deviceParam && STUDIO_PRESETS.some(preset => preset.id === deviceParam)) {
      setActivePresetId(deviceParam);
    } else if (Number.isFinite(widthParam) && Number.isFinite(heightParam) && widthParam >= 280 && heightParam >= 280) {
      setActivePresetId("custom");
      setCustomWidth(widthParam);
      setCustomHeight(heightParam);
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <section className="h-full">
        <div className="flex h-full min-h-full overflow-hidden">
          {panelOpen && (
            <aside className="w-[240px] shrink-0 border-r border-black/[0.06] bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-2 border-b border-black/[0.06] pb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.04]">
                    <MonitorCheck size={17} strokeWidth={1.8} />
                  </div>
                  <p className="truncate text-[17px] font-semibold text-[#17171c]">Responsive Check</p>
                </div>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-[#71717a] transition-colors hover:bg-black/[0.08] hover:text-[#17171c]"
                  title="Hide panel"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>

              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Page URL</label>
              <div className="mb-5 rounded-xl border border-black/[0.08] bg-[#fafafa] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Globe2 size={14} className="shrink-0 text-[#a1a1aa]" />
                  <input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && setFrameKey(key => key + 1)}
                    placeholder="https://example.com"
                    className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-[#17171c] outline-none placeholder:text-[#c4c4cc]"
                  />
                </div>
              </div>

              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Device</label>
              <select
                value={activePresetId}
                onChange={e => setActivePresetId(e.target.value)}
                className="mb-5 h-10 w-full rounded-xl border border-black/[0.08] bg-[#fafafa] px-3 text-[12px] font-semibold text-[#17171c] outline-none focus:border-black/20"
              >
                {PRESET_GROUPS.map(group => (
                  <optgroup key={group} label={group}>
                    {STUDIO_PRESETS.filter(preset => preset.group === group).map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label} · {preset.width}x{preset.height}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="custom">Custom size…</option>
              </select>

              {activePresetId === "custom" && (
                <>
                  <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <input
                      type="number"
                      min={280}
                      max={3840}
                      value={customWidth}
                      onChange={e => setCustomWidth(Number(e.target.value) || 0)}
                      className="h-10 rounded-xl border border-black/[0.08] bg-[#fafafa] px-3 font-mono text-[13px] font-semibold text-[#17171c] outline-none focus:border-black/20"
                    />
                    <span className="text-[#c4c4cc]">x</span>
                    <input
                      type="number"
                      min={280}
                      max={3840}
                      value={customHeight}
                      onChange={e => setCustomHeight(Number(e.target.value) || 0)}
                      className="h-10 rounded-xl border border-black/[0.08] bg-[#fafafa] px-3 font-mono text-[13px] font-semibold text-[#17171c] outline-none focus:border-black/20"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setCustomWidth(studioViewport.height);
                      setCustomHeight(studioViewport.width);
                    }}
                    className="mb-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-[#fafafa] text-[12px] font-semibold text-[#71717a] transition-colors hover:bg-black/[0.04] hover:text-[#17171c]"
                  >
                    <RotateCw size={13} /> Rotate
                  </button>
                </>
              )}

              <label className="mb-2 mt-5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a1a1aa]">Zoom</label>
              <select
                value={zoomMode}
                onChange={e => setZoomMode(e.target.value)}
                className="mb-5 h-10 w-full rounded-xl border border-black/[0.08] bg-[#fafafa] px-3 text-[12px] font-semibold text-[#17171c] outline-none focus:border-black/20"
              >
                {ZOOM_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>

              <div className="mt-5 space-y-2 border-t border-black/[0.06] pt-4">
                <button
                  onClick={() => setFrameKey(key => key + 1)}
                  disabled={!canPreview}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#111113] text-[13px] font-semibold text-white transition-colors hover:bg-[#27272a] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw size={14} /> Refresh preview
                </button>
              </div>
            </aside>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] bg-white px-4 py-2.5">
              <div className="flex items-center gap-2">
                {!panelOpen && (
                  <button
                    onClick={() => setPanelOpen(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/[0.04] text-[#71717a] transition-colors hover:bg-black/[0.08] hover:text-[#17171c]"
                    title="Show panel"
                  >
                    <ChevronRight size={16} />
                  </button>
                )}
                <span className="rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-[#71717a]">
                  {zoomMode === "fit" ? `Fit · ${Math.round(previewScale * 100)}%` : `${Math.round(previewScale * 100)}%`}
                </span>
              </div>
              <span className="rounded-lg bg-black/[0.04] px-2.5 py-1.5 font-mono text-[12px] font-semibold text-[#4b5563]">
                {studioViewport.width} x {studioViewport.height}
              </span>
            </div>

            <div ref={stageRef} className="relative min-h-[560px] flex-1 overflow-auto bg-[#f5f5f7]">
              <div
                className="absolute left-1/2 top-1/2 origin-center overflow-hidden rounded-[22px] bg-white shadow-[0_24px_90px_rgba(0,0,0,0.16)] ring-1 ring-black/[0.06]"
                style={{
                  width: studioViewport.width,
                  height: studioViewport.height,
                  transform: `translate(-50%, -50%) scale(${previewScale})`,
                }}
              >
              {canPreview && embedEnabled ? (
                <iframe
                  key={`${frameKey}-${previewUrl}-${studioViewport.width}-${studioViewport.height}`}
                  title="Viewport preview"
                  src={previewUrl}
                  className="h-full w-full border-0 bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-[#fafafa] px-8 text-center">
                  <div style={{ transform: `scale(${1 / previewScale})` }}>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f0f0f3] text-[#71717a]">
                      <MonitorCheck size={24} />
                    </div>
                    <p className="text-[18px] font-semibold text-[#17171c]">
                      {canPreview ? "Preview frame ready" : "Enter a page URL"}
                    </p>
                    <p className="mt-1 max-w-[360px] text-[13px] leading-relaxed text-[#71717a]">
                      {canPreview
                        ? `${previewHost} is set to ${studioViewport.width} x ${studioViewport.height}. Some sites block embedding — open it directly if the preview stays blank.`
                        : "Paste a live website URL, choose a preset, and Loupe will prepare that viewport."}
                    </p>
                    {canPreview && (
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        <button
                          onClick={() => setEmbedEnabled(true)}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-black/[0.1] bg-white px-3 text-[12px] font-semibold text-[#17171c] transition-colors hover:bg-[#f4f4f5]"
                        >
                          Try embedded preview
                        </button>
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#111113] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#27272a]"
                        >
                          <Play size={12} /> Open in new tab
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
