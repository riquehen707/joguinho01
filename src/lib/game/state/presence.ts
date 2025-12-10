import { getRedis } from "./redisClient";

function keyRoom(roomId: string) {
  return `mud:room:${roomId}:players`;
}

export async function touchPresence(playerId: string, roomId: string, nome: string) {
  const redis = await getRedis();
  const payload = JSON.stringify({ nome, at: Date.now() });
  await redis.hSet(keyRoom(roomId), playerId, payload);
  await redis.expire(keyRoom(roomId), 90);
}

export async function listPresence(roomId: string): Promise<{ id: string; nome: string }[]> {
  const redis = await getRedis();
  const raw = await redis.hGetAll(keyRoom(roomId));
  const now = Date.now();
  return Object.entries(raw)
    .map(([id, val]) => {
      try {
        const parsed = JSON.parse(val ?? "{}") as { nome?: string; at?: number };
        return { id, nome: parsed.nome ?? id, at: parsed.at ?? 0 };
      } catch {
        return { id, nome: id, at: 0 };
      }
    })
    .filter((p) => now - p.at < 120_000)
    .map((p) => ({ id: p.id, nome: p.nome }));
}

const CHAT_KEY = "mud:chat:global";

export async function publishGlobalChat(message: string) {
  const redis = await getRedis();
  await redis.lPush(CHAT_KEY, message);
  await redis.lTrim(CHAT_KEY, 0, 30);
}

export async function fetchGlobalChat(limit = 5): Promise<string[]> {
  const redis = await getRedis();
  const msgs = await redis.lRange(CHAT_KEY, 0, limit - 1);
  return msgs.reverse();
}
