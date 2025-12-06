import { NextResponse } from "next/server";
import { runCommand } from "@/lib/mudEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json();
  const playerId: string | undefined = payload?.playerId;
  const command: string = payload?.command ?? "";

  if (!playerId) {
    return NextResponse.json({ error: "PlayerId ausente." }, { status: 400 });
  }

  const snapshot = await runCommand(playerId, command);
  const status = snapshot.error ? 400 : 200;
  return NextResponse.json(snapshot, { status });
}
