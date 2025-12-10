import crypto from "crypto";
import { getRedis } from "./redisClient";
import { MobInstance, Room, RoomState } from "../types";
import { getMob } from "./mobCatalog";

function key(roomId: string) {
  return `mud:room:${roomId}`;
}

function createMobInstances(room: Room, deathCount = 0, lootPowerPool = 0): MobInstance[] {
  const base = room.mobs.length;
  const extra = deathCount > 0 ? Math.min(2, deathCount) : 0;
  if (base === 0) return [];
  const total = Math.max(base, 1 + extra);
  const mobs: MobInstance[] = [];
  for (let i = 0; i < total; i++) {
    const mobId = room.mobs[i % room.mobs.length] ?? room.mobs[0];
    const mob = getMob(mobId);
    const hpBonus = 1 + Math.min(0.4, deathCount * 0.15);
    const power = lootPowerPool > 0 ? 1 : 0;
    if (lootPowerPool > 0) lootPowerPool -= 1;
    mobs.push({
      id: crypto.randomUUID(),
      mobId,
      hp: Math.floor((mob?.hp ?? 20) * hpBonus * (1 + power * 0.1)),
      alive: true,
      power,
    });
  }
  return mobs;
}

export async function loadRoomState(room: Room, respawnMs = 90_000): Promise<RoomState> {
  const redis = await getRedis();
  const raw = await redis.get(key(room.id));
  if (raw) {
    const parsed = JSON.parse(raw) as RoomState;
    const allDead = parsed.mobs.every((m) => !m.alive || m.hp <= 0);
    const expired = Date.now() - (parsed.lastUpdated ?? 0) > respawnMs;
    if (allDead && expired) {
      const loot = parsed.loot ?? [];
      const lootTotal = loot.reduce((sum, l) => sum + l.qtd, 0);
      const lootPowerPool = Math.min(3, lootTotal);
      const mobs = createMobInstances(room, parsed.deathCount ?? 0, lootPowerPool);
      // mobs equipam parte do loot, removendo do chao
      let toConsume = mobs.filter((m) => m.power && m.power > 0).length;
      const updatedLoot = loot.map((l) => ({ ...l }));
      for (const stack of updatedLoot) {
        while (toConsume > 0 && stack.qtd > 0) {
          stack.qtd -= 1;
          toConsume -= 1;
        }
      }
      const cleanedLoot = updatedLoot.filter((l) => l.qtd > 0);
      const refreshed: RoomState = {
        roomId: room.id,
        mobs,
        lastUpdated: Date.now(),
        loot: cleanedLoot,
        deathCount: parsed.deathCount ?? 0,
      };
      await saveRoomState(refreshed);
      return refreshed;
    }
    if (!parsed.loot) parsed.loot = [];
    if (!parsed.deathCount) parsed.deathCount = 0;
    return parsed;
  }
  const state: RoomState = {
    roomId: room.id,
    mobs: createMobInstances(room),
    lastUpdated: Date.now(),
    loot: [],
    deathCount: 0,
  };
  await saveRoomState(state);
  return state;
}

export async function saveRoomState(state: RoomState): Promise<void> {
  const redis = await getRedis();
  state.lastUpdated = Date.now();
  await redis.set(key(state.roomId), JSON.stringify(state));
}

export function describeRoomMobs(state: RoomState): string {
  if (!state.mobs.length) return "Nenhum mob instanciado.";
  return state.mobs
    .map((m) => {
      const mob = getMob(m.mobId);
      const name = mob?.nome ?? m.mobId;
      return `${name} HP:${Math.max(0, m.hp)}`;
    })
    .join(" | ");
}
