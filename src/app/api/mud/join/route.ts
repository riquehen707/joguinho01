import { NextResponse } from "next/server";
import { joinPlayer, loginOrCreate, OriginId, Tendency } from "@/lib/mudEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json();
  const name: string | undefined = payload?.name;
  const playerId: string | undefined = payload?.playerId;
  const originId: OriginId | undefined = payload?.originId;
  const tendency: Tendency | undefined = payload?.tendency;
  const email: string | undefined = payload?.email;
  const password: string | undefined = payload?.password;

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
  }

  const snapshot =
    email && password
      ? await loginOrCreate(email, password, name, originId, tendency)
      : await joinPlayer(name, playerId, originId, tendency);

  const status = "error" in snapshot && snapshot.error ? 400 : 200;
  return NextResponse.json(snapshot as unknown as Record<string, unknown>, { status });
}
