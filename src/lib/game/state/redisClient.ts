// src/lib/game/state/redisClient.ts

import { createClient } from "redis"

let client: ReturnType<typeof createClient> | null = null

export async function getRedis() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL })
    await client.connect()
  }
  return client
}

export async function setJSON(key: string, data: any) {
  const r = await getRedis()
  await r.set(key, JSON.stringify(data))
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const r = await getRedis()
  const raw = await r.get(key)
  if (!raw) return null
  return JSON.parse(raw)
}

export async function delKey(key: string) {
  const r = await getRedis()
  await r.del(key)
}
