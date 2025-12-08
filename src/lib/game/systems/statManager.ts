// src/lib/game/systems/statManager.ts

import { PlayerState } from "../state/playerState"
import { CombatState, CombatParticipant } from "../state/combatState"
import { setJSON } from "../state/redisClient"

const COMBAT_KEY = (id: string) => `mud:combat:${id}:state`
const PLAYER_KEY = (id: string) => `mud:player:${id}:state`

async function saveCombat(c: CombatState) {
  await setJSON(COMBAT_KEY(c.id), c)
}

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

export function baseDamage(p: PlayerState): number {
  const str = p.attributes.strength
  const dex = p.attributes.dexterity
  const will = p.attributes.will
  return Math.max(1, Math.floor((str + dex + will) / 3))
}

export function baseMitigation(p: PlayerState): number {
  const con = p.attributes.constitution
  const will = p.attributes.will
  const armor = p.equipment.armor ? 1 : 0
  return Math.floor((con + will) / 3) + armor
}

export function rollDamage(attacker: PlayerState, target: PlayerState): number {
  const dmg = baseDamage(attacker)
  const mitigation = baseMitigation(target)
  const result = Math.max(0, dmg - mitigation)
  return result
}

export async function applyHitPlayer(
  combat: CombatState,
  attacker: PlayerState,
  target: PlayerState
) {
  const dmg = rollDamage(attacker, target)
  target.vitals.hp = Math.max(0, target.vitals.hp - dmg)
  await savePlayer(target)

  combat.log.push({
    timestamp: Date.now(),
    text: `${attacker.name} causa ${dmg} de dano em ${target.name}.`
  })

  await saveCombat(combat)

  if (target.vitals.hp <= 0) {
    combat.log.push({
      timestamp: Date.now(),
      text: `${target.name} é derrotado.`
    })
    await saveCombat(combat)
  }

  return dmg
}

export async function applyHitMonster(
  combat: CombatState,
  attacker: PlayerState,
  monsterId: string
) {
  const participant = combat.participants[monsterId]
  if (!participant || !participant.vitals) return 0

  const atk = baseDamage(attacker)
  const reduction = 1
  const dmg = Math.max(0, atk - reduction)

  participant.vitals.hp = Math.max(0, participant.vitals.hp - dmg)
  await saveCombat(combat)

  combat.log.push({
    timestamp: Date.now(),
    text: `${attacker.name} atinge ${monsterId} causando ${dmg} de dano.`
  })

  await saveCombat(combat)

  return dmg
}

export async function recoverVitals(
  player: PlayerState,
  amount: number
) {
  player.vitals.hp = Math.min(player.vitals.hp + amount, 12)
  player.vitals.moral = Math.min(player.vitals.moral + 1, 10)
  await savePlayer(player)
}
