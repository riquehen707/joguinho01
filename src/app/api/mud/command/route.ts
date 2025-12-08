import { NextRequest, NextResponse } from "next/server";
import { executeCommand } from "@/lib/game/commands/handleCommand";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || !body.playerId || !body.input) {
    return NextResponse.json(
      { ok: false, error: "playerId e input obrigatórios" },
      { status: 400 }
    );
  }

  try {
    const result = await executeCommand({
      playerId: body.playerId,
      rawInput: body.input,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("MUD route error:", err);
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500 }
    );
  }
}
