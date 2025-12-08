// src/lib/game/systems/enemyAI.ts

import { PlayerState } from "../state/playerState"
import { CombatState } from "../state/combatState"
import { setJSON, getJSON } from "../state/redisClient"
import { randomInt } from "../utils/randomSeeded"
import { archetypeInfluenceDefense, archetypeInfluenceEscape } from "./archetypeInterpreter"

const PLAYER_KEY = (id: string) => `mud:player:${id}:state`
const COMBAT_KEY = (id: string) => `mud:combat:${id}:state`

async function saveCombat(c: CombatState) {
  await setJSON(COMBAT_KEY(c.id), c)
}

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

async function getPlayer(id: string) {
  return await getJSON<PlayerState>(PLAYER_KEY(id))
}

/**
 * O alvo não é aleatório:
 * - monstros preferem quem tem moral baixa
 * - monstros preferem quem tem HP menor
 * - monstros evitam alvo espiritual dominante
 * - monstros podem fugir de presença espiritual
 */
export async function pickAI_Target(
  combat: CombatState,
  monsterId: string
) {
  const ids = Object.keys(combat.participants).filter(x => x !== monsterId)
  if (!ids.length) return null

  let weights: { id: string; weight: number }[] = []

  for (const pid of ids) {
    const p = await getPlayer(pid)
    if (!p) continue

    let w = 1

    if (p.vitals.hp <= 3) w += 3
    if (p.vitals.moral <= 2) w += 2
    if (p.attributes.concentration >= 3) w -= 1
    if (p.attributes.will >= 3) w -= 1

    if (w < 1) w = 1
    weights.push({ id: pid, weight: w })
  }

  const sum = weights.reduce((a, b) => a + b.weight, 0)
  let roll = randomInt(0, sum - 1)

  for (let w of weights) {
    if (roll < w.weight) return w.id
    roll -= w.weight
  }

  return weights[0].id
}

/**
 * Monstros têm comportamento sistêmico:
 * - Elite resiste mais
 * - Horda ataca moral
 * - Assombração ataca estamina
 * - Ritualista tenta debuff
 */
export async function enemyAI_Action(
  combat: CombatState,
  monsterId: string
) {
  const participant = combat.participants[monsterId]
  if (!participant || !combat.active) return null

  const targetId = await pickAI_Target(combat, monsterId)
  if (!targetId) {
    combat.log.push({
      timestamp: Date.now(),
      text: `Monstro ${monsterId} hesita, sem alvo.`
    })
    await saveCombat(combat)
    return combat
  }

  const target = await getPlayer(targetId)
  if (!target) return null

  const stance = participant.stance || "neutral"
  let dmg = 1

  if (stance === "elite") dmg += 2
  if (stance === "swarm") dmg = 1
  if (stance === "ritual") dmg = 0

  if (stance === "swarm") {
    target.vitals.moral = Math.max(0, target.vitals.moral - 1)
    await savePlayer(target)

    combat.log.push({
      timestamp: Date.now(),
      text: `A horda pressiona ${target.name}, drenando moral.`
    })

    await saveCombat(combat)
    return combat
  }

  if (stance === "ritual") {
    target.vitals.stamina = Math.max(0, target.vitals.stamina - 2)
    await savePlayer(target)

    combat.log.push({
      timestamp: Date.now(),
      text: `${target.name} sofre tensão espiritual ritualística.`
    })

    await saveCombat(combat)
    return combat
  }

  dmg -= archetypeInfluenceDefense(target)
  if (dmg < 0) dmg = 0

  target.vitals.hp = Math.max(0, target.vitals.hp - dmg)
  await savePlayer(target)

  combat.log.push({
    timestamp: Date.now(),
    text: `${monsterId} golpeia ${target.name}, causando ${dmg}.`
  })

  await saveCombat(combat)
  return combat
}

/**
 * Monstros também recuam:
 * - moral baixa
 * - presença espiritual dominante
 * - arquétipo oportunista / predador
 * - alvo imprevisível
 */
export async function enemyAI_EscapeCheck(
  combat: CombatState,
  monsterId: string
) {
  const participant = combat.participants[monsterId]
  if (!participant) return false

  const moral = participant.vitals?.moral ?? 4
  const spiritualPressure = combat.log.filter(x =>
    x.text.includes("presença")
  ).length

  let chance = 0

  if (moral <= 2) chance += 2
  if (spiritualPressure >= 2) chance += 2

  const roll = randomInt(0, 4 + chance)
  if (roll < 4) return false

  combat.log.push({
    timestamp: Date.now(),
    text: `${monsterId} recua temendo a energia do grupo.`
  })

  participant.stance = "fleeing"
  await saveCombat(combat)
  return true
}

/**
 * Loop tático do monstro:
 * 1) tenta fugir
 * 2) se não fugir, age
 */
export async function enemyAI_Turn(
  combat: CombatState,
  monsterId: string
) {
  const escaped = await enemyAI_EscapeCheck(combat, monsterId)
  if (escaped) return combat

  return await enemyAI_Action(combat, monsterId)
}
