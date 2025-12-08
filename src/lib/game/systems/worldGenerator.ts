import { jsonSet } from "@/lib/game/state/redisClient";
import type { RoomState } from "@/lib/game/state/worldState";

export async function createInitialRoom(playerId: string): Promise<RoomState> {
  const room: RoomState = {
    id: "entrada",
    name: "Entrada Sombria",
    description: "Uma câmara silenciosa, úmida e fria.",
    exits: ["north"],
    monsters: [],
    players: [{ id: playerId, name: "Visitante" }],
    ambient: ["vento frio", "pedras antigas"]
  };
  await jsonSet(\mud:room:\\, room);
  return room;
}
