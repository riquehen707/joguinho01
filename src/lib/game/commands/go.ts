import { getRoom, enterRoom } from "../world/roomGenerator"

export async function go(player, dir) {
  const room = await getRoom(player.lastRoomId)
  if (!room || !room.exits[dir]) return Não há caminho para .

  const nextId = room.exits[dir]
  await enterRoom(player, nextId)

  return Você se move para .
}
