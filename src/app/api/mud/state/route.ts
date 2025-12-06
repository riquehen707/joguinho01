import { NextResponse } from "next/server";
import { getState } from "@/lib/mudEngine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playerId = url.searchParams.get("playerId");
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : undefined;

  if (!playerId) {
    return NextResponse.json({ error: "PlayerId ausente." }, { status: 400 });
  }

  const snapshot = await getState(playerId, since);
  if (!snapshot) {
    return NextResponse.json({ error: "Jogador não encontrado." }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}
