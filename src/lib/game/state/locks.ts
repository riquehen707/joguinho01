import crypto from "crypto";
import { getRedis } from "./redisClient";

const LOCK_PREFIX = "mud:lock:";

async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const redis = await getRedis();
  const token = crypto.randomUUID();
  const res = await redis.set(key, token, { NX: true, PX: ttlMs });
  return res === "OK" ? token : null;
}

async function releaseLock(key: string, token: string): Promise<void> {
  const redis = await getRedis();
  const current = await redis.get(key);
  if (current === token) {
    await redis.del(key);
  }
}

export async function withRoomLock<T>(roomId: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const key = `${LOCK_PREFIX}${roomId}`;
  const maxAttempts = 5;
  let token: string | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    token = await acquireLock(key, ttlMs);
    if (token) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!token) {
    throw new Error("Nao foi possivel obter lock da sala");
  }
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}
