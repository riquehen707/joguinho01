import { getRoom } from "../world/roomGenerator"
import { explorationCheck } from "../systems/explorationManager"

export async function search(player) {
  const res = await explorationCheck(player, await getRoom(player.lastRoomId))
  if (!res) return Você não encontra nada relevante.
  return res.text
}
