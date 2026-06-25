import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function sse(type: string, payload: object) {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function toVarName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function closestColorName(hex: string, palette: string[]): string {
  // Simple heuristic: darkest = text, lightest = background, rest = accent
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 50)  return "dark";
  if (luminance > 220) return "light";
  return "accent";
}

export async function POST(req: NextRequest) {
  const { fileKey, nodeId } = await req.json() as { fileKey: string; nodeId: string };

  if (!fileKey || !nodeId) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", text: "fileKey and nodeId are required" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: object) {
        controller.enqueue(encoder.encode(sse(type, payload)));
      }

      try {
        const db = supabaseAdmin();

        // ── Load latest snapshot ────────────────────────────────────────────
        send("step", { text: "Loading snapshot…" });

        const { data: snap } = await db
          .from("figma_snapshots")
          .select("id, frame_name, text_node_count, color_node_count, synced_at")
          .eq("file_key", fileKey)
          .eq("node_id", nodeId)
          .eq("is_stale", false)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!snap) {
          send("error", { text: 'No snapshot found. Use "Sync Design" on the Figma vs Live page first.' });
          controller.close();
          return;
        }

        send("step", { text: `Snapshot: "${snap.frame_name}" — ${snap.text_node_count} text nodes, ${snap.color_node_count} color nodes.` });

        // ── Load text + color rows ──────────────────────────────────────────
        const [{ data: textRows }, { data: colorRows }] = await Promise.all([
          db.from("snapshot_text")
            .select("node_name, content, font_family, font_size, font_weight, fill_color, line_height_px, letter_spacing")
            .eq("snapshot_id", snap.id),
          db.from("snapshot_colors")
            .select("node_name, node_type, fill_color_hex, stroke_color_hex, border_radius, shadow")
            .eq("snapshot_id", snap.id),
        ]);

        if (!textRows?.length && !colorRows?.length) {
          send("error", { text: "Snapshot has no data. Re-sync the design." });
          controller.close();
          return;
        }

        send("step", { text: "Deriving brand metrics…" });

        // ── Derive metrics ──────────────────────────────────────────────────
        const fontFamilies = [...new Set((textRows ?? []).map(r => r.font_family).filter(Boolean))];
        const fontSizes    = [...new Set((textRows ?? []).map(r => r.font_size).filter(Boolean))].sort((a, b) => b - a) as number[];
        const fontWeights  = [...new Set((textRows ?? []).map(r => r.font_weight).filter(Boolean))].sort((a, b) => a - b) as number[];
        const textColors   = [...new Set((textRows ?? []).map(r => r.fill_color).filter(Boolean))];
        const bgColors     = [...new Set((colorRows ?? []).map(r => r.fill_color_hex).filter(Boolean))];
        const strokeColors = [...new Set((colorRows ?? []).map(r => r.stroke_color_hex).filter(Boolean))];
        const allColors    = [...new Set([...textColors, ...bgColors, ...strokeColors])];
        const borderRadii  = [...new Set((colorRows ?? []).map(r => r.border_radius).filter(n => n !== null && (n as number) > 0))].sort((a, b) => (a as number) - (b as number)) as number[];
        const shadows      = [...new Set((colorRows ?? []).map(r => r.shadow).filter(Boolean))];

        // Build a compact typography sample for AI
        const seenCombos = new Set<string>();
        const typographySample: string[] = [];
        for (const r of [...(textRows ?? [])].sort((a, b) => (b.font_size ?? 0) - (a.font_size ?? 0))) {
          const key = `${r.font_family}|${r.font_size}|${r.font_weight}`;
          if (seenCombos.has(key)) continue;
          seenCombos.add(key);
          typographySample.push(`"${(r.content ?? "").slice(0, 30)}" — ${r.font_family} ${r.font_size}px w${r.font_weight} lh${r.line_height_px ?? 0}px ${r.fill_color ?? ""}`);
          if (typographySample.length >= 15) break;
        }

        send("step", { text: "Sending to AI for brand analysis and handoff generation…" });

        // ── Groq: brand check + CSS tokens + handoff notes ──────────────────
        const prompt = `You are a design systems expert reviewing a Figma frame for brand consistency and generating a developer handoff.

FRAME: "${snap.frame_name}"

TYPOGRAPHY (${textRows?.length ?? 0} text nodes):
Font families: ${fontFamilies.join(", ") || "none"}
Font sizes: ${fontSizes.join(", ")}px
Font weights: ${fontWeights.join(", ")}
Samples:
${typographySample.join("\n")}

COLORS (${allColors.length} unique):
Text colors: ${textColors.slice(0, 12).join(", ")}
Background colors: ${bgColors.slice(0, 12).join(", ")}
Stroke colors: ${strokeColors.slice(0, 8).join(", ")}
Border radii: ${borderRadii.join(", ")}px
Shadows: ${shadows.slice(0, 3).join(" | ")}

Return a JSON object with these exact keys:
{
  "brand_issues": [{"category": "typography"|"color"|"spacing", "severity": "high"|"medium"|"low", "issue": "string", "fix": "string"}],
  "palette": [{"hex": "#XXXXXX", "role": "primary"|"secondary"|"text"|"background"|"border"|"accent", "usage": "string"}],
  "typography_scale": [{"size": number, "weight": number, "family": "string", "role": "string", "css_class": "string"}],
  "css_tokens": "string (complete :root { } block with CSS custom properties for all tokens)",
  "handoff_summary": "string (2-3 sentences for the developer implementing this design)"
}

Rules:
- brand_issues: flag >2 font families as high severity, >10 unique colors as medium, mixed font sizes that don't follow a scale
- palette: pick the 5-8 most meaningful colors, deduplicate near-identical shades
- css_tokens: use kebab-case variable names, include typography + color + spacing + border-radius + shadow
- Return ONLY the JSON object, no explanation`;

        const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method:  "POST",
          signal:  AbortSignal.timeout(45_000),
          headers: {
            Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model:       "llama-3.1-8b-instant",
            temperature: 0,
            max_tokens:  3000,
            messages:    [{ role: "user", content: prompt }],
          }),
        });

        if (!aiRes.ok) {
          send("error", { text: `AI error ${aiRes.status}` });
          controller.close();
          return;
        }

        const aiData    = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
        const rawContent = aiData.choices[0]?.message?.content?.trim() ?? "{}";

        let parsed: any = {};
        try {
          const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {
          send("error", { text: `Could not parse AI response: ${rawContent.slice(0, 200)}` });
          controller.close();
          return;
        }

        send("result", {
          frameName:      snap.frame_name,
          syncedAt:       snap.synced_at,
          metrics: {
            fontFamilies,
            fontSizes:    fontSizes.slice(0, 12),
            fontWeights,
            colorCount:   allColors.length,
            borderRadii,
          },
          brandIssues:     parsed.brand_issues    ?? [],
          palette:         parsed.palette         ?? [],
          typographyScale: parsed.typography_scale ?? [],
          cssTokens:       parsed.css_tokens      ?? "",
          handoffSummary:  parsed.handoff_summary ?? "",
        });

      } catch (err) {
        controller.enqueue(encoder.encode(sse("error", { text: `Unexpected error: ${String(err)}` })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
