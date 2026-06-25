import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { message, history } = await req.json() as {
    message: string;
    history: Array<{ role: "user" | "assistant"; text: string }>;
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:       "llama-3.1-8b-instant",
      temperature: 0.7,
      max_tokens:  500,
      messages: [
        {
          role: "system",
          content: `You are a helpful design assistant inside Loupe, an AI-powered design QA tool.
You help designers and developers understand design concepts, Figma, CSS, typography, color theory, and design systems.
Keep answers concise and practical. If asked about results from the comparison agent, explain what the issues mean and how to fix them.`,
        },
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
