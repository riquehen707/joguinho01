// src/lib/game/systems/combatManager.ts

import { getJSON, setJSON } from "../state/redisClient"
import { PlayerState } from "../state/playerState"
import { CombatState, CombatParticipant } from "../state/combatState"
import { RoomState } from "../state/worldState"
import { statDamage } from "./statManager"
import { randomInt } from "../utils/randomSeeded"
import { combatNarrator } from "./combatNarrator"
import { archetypeInfluenceEscape, archetypeInfluenceCritical, archetypeInfluenceDefense } from "./archetypeInterpreter"

const COMBAT_KEY = (id: string) => `mud:combat:${id}:state`
const PLAYER_KEY = (id: string) => `mud:player:${id}:state`
const ROOM_KEY = (id: string) => `mud:room:${id}:state`

async function saveCombat(c: CombatState) {
  await setJSON(COMBAT_KEY(c.id), c)
}

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

async function saveRoom(r: RoomState) {
  await setJSON(ROOM_KEY(r.id), r)
}

async function getCombat(id: string): Promise<CombatState | null> {
  return await getJSON<CombatState>(COMBAT_KEY(id))
}

async function createCombat(room: RoomState): Promise<CombatState> {
  const id = `combat-${room.id}-${Date.now()}`
  const combat: CombatState = {
    id,
    roomId: room.id,
    startedAt: Date.now(),
    active: true,
    turn: 0,
    participants: {},
    lastActionAt: Date.now(),
    log: []
  }
  await saveCombat(combat)
  return combat
}

async function registerParticipant(combat: CombatState, id: string, type: CombatParticipant["type"]) {
  if (!combat.participants[id]) {
    combat.participants[id] = {
      id,
      type,
      stance: "neutral",
      vitals: { hp: 8, moral: 4 }
    }
  }
}

export async function joinCombatIfActive(player: PlayerState, room: RoomState) {
  const activeCombatId = room.events.find(e => e.startsWith("combat:"))
  if (!activeCombatId) return null

  let combat = await getCombat(activeCombatId)
  if (!combat) {
    room.events = room.events.filter(e => !e.startsWith("combat:"))
    await saveRoom(room)
    return null
  }

  await registerParticipant(combat, player.id, "player")

  player.isInCombat = true
  player.combatId = combat.id
  await savePlayer(player)
  await saveCombat(combat)

  return { enteredCombat: true, combat }
}

export async function startCombatForRoom(room: RoomState) {
  let combat = await createCombat(room)
  room.events.push(`combat:${combat.id}`)
  await saveRoom(room)
  return combat
}

async function handleTurn(combat: CombatState) {
  combat.turn++
  combat.lastActionAt = Date.now()
  await saveCombat(combat)
}

async function playerAttack(combat: CombatState, attacker: PlayerState, target: PlayerState) {
  let dmg = statDamage(attacker, target)

  dmg += archetypeInfluenceCritical(attacker)
  dmg -= archetypeInfluenceDefense(target)
  if (dmg < 0) dmg = 0

  target.vitals.hp = Math.max(0, target.vitals.hp - dmg)
  await savePlayer(target)

  combat.log.push({
    timestamp: Date.now(),
    text: `${attacker.name} atinge ${target.name} causando ${dmg}.`
  })

  await saveCombat(combat)
}

export async function resolveCombatAction(
  combatId: string,
  actorId: string,
  action: string
) {
  const combat = await getCombat(combatId)
  if (!combat || !combat.active) return null

  const actor = combat.participants[actorId]
  if (!actor) return null

  if (action === "escape") {
    if (archetypeInfluenceEscape(await getJSON<PlayerState>(PLAYER_KEY(actorId)))) {
      combat.log.push({
        timestamp: Date.now(),
        text: `${actorId} escapa pela leitura comportamental.`
      })
      await saveCombat(combat)
      await handleTurn(combat)
      return combat
    }
  }

  if (action === "attack") {
    const targets = Object.keys(combat.participants).filter(x => x !== actorId)
    if (targets.length) {
      const pid = targets[randomInt(0, targets.length)]
      const attacker = await getJSON<PlayerState>(PLAYER_KEY(actorId))
      const defender = await getJSON<PlayerState>(PLAYER_KEY(pid))
      await playerAttack(combat, attacker!, defender!)
    }
  }

  await handleTurn(combat)
  return combat
}
