import { NextRequest, NextResponse } from "next/server";

interface ScanContext {
  figmaUrl?: string;
  liveUrl?: string;
  checks?: string[];
  discrepancies?: Array<{ element: string; issue: string }>;
  summary?: string;
}

export async function POST(req: NextRequest) {
  const { message, history, context } = await req.json() as {
    message: string;
    history: Array<{ role: "user" | "assistant"; text: string }>;
    context?: ScanContext;
  };

  let systemPrompt = `You are Loupe AI, a design QA assistant embedded inside Loupe — a tool that compares Figma designs against live websites.

Your job is to help designers and developers understand and fix the discrepancies found between the Figma design and the live site. You have deep knowledge of typography, color, spacing, CSS, Figma, and design systems.

Rules:
- Be concise and direct. No fluff, no preamble.
- Format code or CSS in backtick blocks.
- Use bullet points for lists.
- When explaining how to fix an issue, give the actual CSS or Figma property, not just a description.`;

  if (context?.discrepancies?.length) {
    const rows = context.discrepancies
      .slice(0, 30)
      .map(d => `  • ${d.element}: ${d.issue}`)
      .join("\n");
    systemPrompt += `

The user just ran a design QA scan with these results:
- Figma: ${context.figmaUrl ?? "unknown"}
- Live site: ${context.liveUrl ?? "unknown"}
- Checks performed: ${context.checks?.join(", ") ?? "unknown"}
- Summary: ${context.summary ?? "see discrepancies below"}

Discrepancies found:
${rows}

When the user asks about "the results", "these issues", "the errors", etc., refer to this specific list. Give actionable CSS fixes where possible.`;
  } else if (context?.figmaUrl || context?.liveUrl) {
    systemPrompt += `

The user is comparing:
- Figma: ${context.figmaUrl ?? "not set"}
- Live site: ${context.liveUrl ?? "not set"}

No scan results yet — the user hasn't run a comparison or no discrepancies were found.`;
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:       "llama-3.1-8b-instant",
      temperature: 0.4,
      max_tokens:  600,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.text })),
        { role: "user", content: message },
      ],
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ reply: "AI is unavailable right now — try again shortly." }, { status: 200 });
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return NextResponse.json({ reply: data.choices[0]?.message?.content ?? "" });
}
