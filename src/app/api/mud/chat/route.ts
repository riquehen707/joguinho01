import { NextRequest, NextResponse } from "next/server";
import { fetchGlobalChat, publishGlobalChat } from "@/lib/game/state/presence";

export async function GET() {
  const msgs = await fetchGlobalChat(20);
  return NextResponse.json({ messages: msgs });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { message?: string; author?: string };
    const msg = body.message?.trim();
    if (!msg) return NextResponse.json({ error: "empty" }, { status: 400 });
    const author = body.author?.slice(0, 24) || "anon";
    const tag = `[GLOBAL ${author}] ${msg}`;
    await publishGlobalChat(tag);
    const msgs = await fetchGlobalChat(20);
    return NextResponse.json({ ok: true, messages: msgs });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
