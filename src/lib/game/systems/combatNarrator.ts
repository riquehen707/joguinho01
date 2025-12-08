// src/lib/game/systems/combatNarrator.ts

import { CombatState, CombatParticipant } from "../state/combatState"
import { RoomState } from "../state/worldState"
import { PlayerState } from "../state/playerState"
import { setJSON } from "../state/redisClient"

const COMBAT_KEY = (id: string) => `mud:combat:${id}:state`
const ROOM_KEY = (id: string) => `mud:room:${id}:state`

async function saveCombat(c: CombatState) {
  await setJSON(COMBAT_KEY(c.id), c)
}

async function saveRoom(r: RoomState) {
  await setJSON(ROOM_KEY(r.id), r)
}

function describePresence(p: CombatParticipant) {
  if (p.type === "player") return `${p.id}`
  if (p.type === "monster") return `monstro ${p.id}`
  if (p.type === "horde") return `horda ${p.id}`
  if (p.type === "elite") return `elite ${p.id}`
  if (p.type === "spirit") return `entidade ${p.id}`
  return p.id
}

export async function combatNarrator(
  player: PlayerState,
  room: RoomState,
  payload: any
) {
  const combat = payload.combat || payload

  const participants = Object.values(combat.participants)
  const readable = participants.map(describePresence).join(", ")

  const entranceLine = `${player.name} entra no combate: ${readable}`

  combat.log.push({
    timestamp: Date.now(),
    text: entranceLine
  })

  await saveCombat(combat)

  room.events.push(entranceLine)
  await saveRoom(room)
}

export async function narrateAttack(
  combat: CombatState,
  attacker: string,
  target: string,
  damage: number
) {
  const line = `${attacker} atinge ${target} causando ${damage} de dano.`

  combat.log.push({
    timestamp: Date.now(),
    text: line
  })

  await saveCombat(combat)
}

export async function narrateDeath(
  combat: CombatState,
  victim: string
) {
  const line = `${victim} cai em combate.`

  combat.log.push({
    timestamp: Date.now(),
    text: line
  })

  await saveCombat(combat)
}

export async function narrateRetreat(
  combat: CombatState,
  actor: string
) {
  const line = `${actor} abandona a batalha.`

  combat.log.push({
    timestamp: Date.now(),
    text: line
  })

  await saveCombat(combat)
}

export async function narrateRound(
  combat: CombatState
) {
  const line = `O combate avança para o turno ${combat.turn}.`

  combat.log.push({
    timestamp: Date.now(),
    text: line
  })

  await saveCombat(combat)
}
