import { generateWorld } from "../systems/worldGenerator";
import { WorldState } from "../types";
import { getRedis } from "./redisClient";

const WORLD_KEY = "mud:world:v1";

export async function getWorld(): Promise<WorldState> {
  const redis = await getRedis();
  const cached = await redis.get(WORLD_KEY);
  if (cached) {
    return JSON.parse(cached) as WorldState;
  }
  const world = generateWorld(WORLD_KEY, "v1");
  await redis.set(WORLD_KEY, JSON.stringify(world));
  return world;
}

export async function saveWorld(world: WorldState): Promise<void> {
  const redis = await getRedis();
  await redis.set(WORLD_KEY, JSON.stringify(world));
}
