"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Globe2, MonitorCheck, Play, RefreshCw, RotateCw } from "lucide-react";

const STUDIO_PRESETS = [
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
  { id: "iphone-15-pro", label: "iPhone 15 Pro", width: 393, height: 852 },
  { id: "pixel-8", label: "Pixel 8", width: 412, height: 915 },
  { id: "ipad-pro", label: "iPad Pro", width: 1024, height: 1366 },
  { id: "macbook-air", label: "MacBook Air", width: 1280, height: 832 },
  { id: "macbook-pro", label: "MacBook Pro", width: 1440, height: 900 },
  { id: "full-hd", label: "Full HD", width: 1920, height: 1080 },
  { id: "2k-monitor", label: "2K Monitor", width: 2560, height: 1440 },
];

export default function ResponsiveAgentPage() {
  const [url, setUrl] = useState("");
  const [activePresetId, setActivePresetId] = useState(STUDIO_PRESETS[0].id);
  const [customWidth, setCustomWidth] = useState(1440);
  const [customHeight, setCustomHeight] = useState(900);
  const [frameKey, setFrameKey] = useState(0);
  const [previewScale, setPreviewScale] = useState(1);
  const [embedEnabled, setEmbedEnabled] = useState(true);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const activePreset = STUDIO_PRESETS.find(preset => preset.id === activePresetId);
  const studioViewport = activePreset ?? {
    id: "custom",
    label: "Custom",
    width: Math.max(customWidth, 280),
    height: Math.max(customHeight, 280),
  };
  const previewUrl = url.trim();
  const canPreview = previewUrl.startsWith("http");
  const previewHost = useMemo(() => {
    try {
      return canPreview ? new URL(previewUrl).hostname : "";
    } catch {
      return "";
    }
  }, [canPreview, previewUrl]);

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
      setPreviewScale(Math.max(0.18, Number(nextScale.toFixed(3))));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [studioViewport.width, studioViewport.height]);

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
      <section className="min-h-full px-5 py-5">
        <div className="grid min-h-[calc(100vh-40px)] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-[22px] border border-white/10 bg-[#101012] p-4 shadow-2xl shadow-black/30 xl:sticky xl:top-5">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <p className="text-[14px] font-semibold text-white">Viewport controls</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">Device presets</p>
              </div>
              <button
                onClick={() => setFrameKey(key => key + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] text-white/50 transition-colors hover:bg-white/[0.14] hover:text-white"
                title="Reload preview"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Page URL</label>
            <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Globe2 size={14} className="shrink-0 text-white/40" />
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setFrameKey(key => key + 1)}
                  placeholder="https://example.com"
                  className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-white outline-none placeholder:text-white/25"
                />
              </div>
            </div>

            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Presets</p>
            <div className="grid grid-cols-2 gap-2">
              {STUDIO_PRESETS.map(preset => {
                const active = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setActivePresetId(preset.id)}
                    className={`min-h-[66px] rounded-xl border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-white bg-white text-[#17171c]"
                        : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <span className="block text-[12px] font-semibold leading-tight">{preset.label}</span>
                    <span className={`mt-1 block font-mono text-[11px] ${active ? "text-[#71717a]" : "text-white/35"}`}>
                      {preset.width} x {preset.height}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Custom size</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input
                type="number"
                min={280}
                max={3840}
                value={customWidth}
                onFocus={() => setActivePresetId("custom")}
                onChange={e => {
                  setActivePresetId("custom");
                  setCustomWidth(Number(e.target.value) || 0);
                }}
                className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-[13px] font-semibold text-white outline-none focus:border-white/25"
              />
              <span className="text-white/30">x</span>
              <input
                type="number"
                min={280}
                max={3840}
                value={customHeight}
                onFocus={() => setActivePresetId("custom")}
                onChange={e => {
                  setActivePresetId("custom");
                  setCustomHeight(Number(e.target.value) || 0);
                }}
                className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-[13px] font-semibold text-white outline-none focus:border-white/25"
              />
            </div>
            <button
              onClick={() => {
                setActivePresetId("custom");
                setCustomWidth(studioViewport.height);
                setCustomHeight(studioViewport.width);
              }}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] text-[12px] font-semibold text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <RotateCw size={13} /> Rotate
            </button>

            <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
              <button
                onClick={() => setFrameKey(key => key + 1)}
                disabled={!canPreview}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-semibold text-[#17171c] transition-colors hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw size={14} /> Refresh preview
              </button>
            </div>
          </aside>

          <div ref={stageRef} className="relative min-h-[560px] overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.08),transparent_30%),#242426] shadow-2xl shadow-black/30">
            <div className="absolute right-5 top-5 z-10 rounded-xl bg-black/70 px-4 py-2 font-mono text-[14px] font-semibold text-white/75 shadow-lg">
              {studioViewport.width} x {studioViewport.height}
            </div>
            <div className="absolute left-5 top-5 z-10 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-[11px] font-medium text-white/50">
              Scale {Math.round(previewScale * 100)}%
            </div>

            <div
              className="absolute left-1/2 top-1/2 origin-center overflow-hidden rounded-[22px] bg-white shadow-[0_24px_90px_rgba(0,0,0,0.45)] ring-1 ring-white/20"
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
      </section>
    </div>
  );
}
