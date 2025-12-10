import { NextRequest, NextResponse } from "next/server";
import { handleCommand } from "@/lib/game/commands/handleCommand";
import { getOrCreatePlayer, savePlayer } from "@/lib/game/state/playerState";
import { loadRoomState, saveRoomState } from "@/lib/game/state/roomState";
import { withRoomLock } from "@/lib/game/state/locks";
import { getWorld } from "@/lib/game/state/worldState";
import { touchPresence, listPresence, fetchGlobalChat } from "@/lib/game/state/presence";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { playerId?: string; nome?: string; command?: string };
    const { playerId, nome, command } = body || {};

    const world = await getWorld();
    let player = await getOrCreatePlayer(playerId ?? null, world, nome);

    const response = await withRoomLock(player.localizacao, 4000, async () => {
      let room = world.salas[player.localizacao];
      let roomState = await loadRoomState(room);
      const result = await handleCommand({
        command: command ?? "",
        player,
        world,
        room,
        roomState,
      });
      player = result.player;
      await savePlayer(player);

      if (player.localizacao !== room.id) {
        room = world.salas[player.localizacao];
        roomState = await loadRoomState(room);
      } else {
        roomState = result.roomState ?? roomState;
      }
      await saveRoomState(roomState);

      await touchPresence(player.id, player.localizacao, player.nome);

      return { result, room, roomState };
    });

    const presence = await listPresence(player.localizacao);
    const chatMessages = await fetchGlobalChat(10);

    return NextResponse.json({
      ...response.result,
      playerId: player.id,
      room: response.room,
      roomState: response.roomState,
      presence,
      chatMessages,
    });
  } catch (err) {
    console.error("Command error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
