import crypto from "crypto";
import { getRedis } from "./redisClient";
import { MobInstance, Room, RoomState } from "../types";
import { getMob } from "./mobCatalog";

function key(roomId: string) {
  return `mud:room:${roomId}`;
}

function createMobInstances(room: Room): MobInstance[] {
  return room.mobs.map((mobId) => {
    const mob = getMob(mobId);
    return {
      id: crypto.randomUUID(),
      mobId,
      hp: mob?.hp ?? 20,
      alive: true,
    };
  });
}

export async function loadRoomState(room: Room, respawnMs = 90_000): Promise<RoomState> {
  const redis = await getRedis();
  const raw = await redis.get(key(room.id));
  if (raw) {
    const parsed = JSON.parse(raw) as RoomState;
    const allDead = parsed.mobs.every((m) => !m.alive || m.hp <= 0);
    const expired = Date.now() - (parsed.lastUpdated ?? 0) > respawnMs;
    if (allDead && expired) {
      const refreshed: RoomState = {
        roomId: room.id,
        mobs: createMobInstances(room),
        lastUpdated: Date.now(),
        loot: parsed.loot ?? [],
      };
      await saveRoomState(refreshed);
      return refreshed;
    }
    if (!parsed.loot) parsed.loot = [];
    return parsed;
  }
  const state: RoomState = {
    roomId: room.id,
    mobs: createMobInstances(room),
    lastUpdated: Date.now(),
    loot: [],
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
