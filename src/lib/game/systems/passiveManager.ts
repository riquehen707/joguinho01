// src/lib/game/systems/passiveManager.ts

import { PlayerState } from "../state/playerState"
import { CombatState } from "../state/combatState"
import { setJSON } from "../state/redisClient"
import passives from "../entities/passives/passives.json"
import { randomInt } from "../utils/randomSeeded"

const PLAYER_KEY = (id: string) => `mud:player:${id}:state`
const COMBAT_KEY = (id: string) => `mud:combat:${id}:state`

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

async function saveCombat(c: CombatState) {
  await setJSON(COMBAT_KEY(c.id), c)
}

export async function applyPassiveOnHit(
  combat: CombatState,
  attacker: PlayerState,
  target: PlayerState,
  baseDamage: number
) {
  let result = baseDamage

  if (attacker.lineage?.type === "vampiric") {
    const bonus = Math.floor(attacker.attributes.will / 3)
    result += bonus
  }

  if (attacker.attributes.luck >= 3) {
    const critRoll = randomInt(0, attacker.attributes.luck + 2)
    if (critRoll >= 3) result += 1
  }

  if (result < 0) result = 0
  target.vitals.hp = Math.max(0, target.vitals.hp - result)
  await savePlayer(target)

  combat.log.push({
    timestamp: Date.now(),
    text: `${attacker.name} causa ${result} de dano em ${target.name} (com passivas).`
  })
  await saveCombat(combat)

  if (attacker.lineage?.type === "vampiric" && result > 0) {
    attacker.vitals.hp = Math.min(attacker.vitals.hp + 1, 12)
    await savePlayer(attacker)
    combat.log.push({
      timestamp: Date.now(),
      text: `${attacker.name} drena energia vital.`
    })
    await saveCombat(combat)
  }

  return result
}

export async function applyPassiveDefense(
  combat: CombatState,
  target: PlayerState,
  incomingDamage: number
) {
  let dmg = incomingDamage

  if (target.attributes.will >= 3) {
    const reduce = Math.floor(target.attributes.will / 3)
    dmg = Math.max(0, dmg - reduce)
  }

  if (target.attributes.luck >= 3) {
    const avoidRoll = randomInt(0, target.attributes.luck + 3)
    if (avoidRoll > 4) dmg = 0
  }

  target.vitals.hp = Math.max(0, target.vitals.hp - dmg)
  await savePlayer(target)

  combat.log.push({
    timestamp: Date.now(),
    text: `${target.name} sofre ${dmg} de dano após modificadores passivos.`
  })
  await saveCombat(combat)

  return dmg
}

export async function grantPassive(
  player: PlayerState,
  passiveId: string
) {
  const p = passives.find(x => x.id === passiveId)
  if (!p) return null

  if (!player.narrative.lineageEvents.includes(passiveId)) {
    player.narrative.lineageEvents.push(passiveId)
  }

  await savePlayer(player)
  return p
}
