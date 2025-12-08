// src/lib/game/systems/explorationManager.ts

import { PlayerState } from "../state/playerState"
import { RoomState } from "../state/worldState"
import { tryDiscoveryEvent } from "./eventOrchestrator"
import { randomInt } from "../utils/randomSeeded"
import { archetypeInfluenceDiscovery } from "./archetypeInterpreter"

export async function explorationCheck(player: PlayerState, room: RoomState) {
  const instinct = player.attributes.instinct
  const perception = player.attributes.perception
  const intelligence = player.attributes.intelligence
  const luck = player.attributes.luck

  const base = instinct + perception + intelligence + luck
  const diff = 4 + (room.danger || 0)

  let chance = randomInt(0, base)
  if (archetypeInfluenceDiscovery(player)) chance += 2

  if (chance < diff) return null

  const secret = await tryDiscoveryEvent(player, room)
  if (!secret) return null

  return {
    discovery: true,
    eventId: secret.id,
    name: secret.name,
    text: `Você descobre algo oculto: ${secret.name}.`
  }
}
