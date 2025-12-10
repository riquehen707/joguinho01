import { MOBS } from "../data";
import { Mob } from "../types";

const mobMap = new Map<string, Mob>(MOBS.map((m) => [m.id, m]));

export function getMob(id: string): Mob | undefined {
  return mobMap.get(id);
}

export function mobsByBiome(biomeId: string): Mob[] {
  return MOBS.filter((m) => m.biome === biomeId);
}

export function randomMobFromBiome(biomeId: string): Mob | undefined {
  const list = mobsByBiome(biomeId);
  if (!list.length) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}
