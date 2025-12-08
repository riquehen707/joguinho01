import { getRoom } from "../world/roomGenerator"

export async function look(player) {
  const room = await getRoom(player.lastRoomId)
  if (!room) return Nada ao redor.

  return [
    Sala: ,
    Saídas: ,
    room.monsterState ? Há presença hostil aqui. : Ambiente silencioso.,
  ].join("\n")
}
