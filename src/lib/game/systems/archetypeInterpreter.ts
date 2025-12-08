// src/lib/game/systems/archetypeInterpreter.ts

import { PlayerState } from "../state/playerState"
import { CombatState } from "../state/combatState"
import { setJSON } from "../state/redisClient"
import { randomInt } from "../utils/randomSeeded"

const PLAYER_KEY = (id: string) => `mud:player:${id}:state`

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

// -----------------------------------------------------
// ARQUÉTIPO INVISÍVEL: ESTADO HISTÓRICO + TENDÊNCIAS
// -----------------------------------------------------

export type ArchetypeHistory = {
  aggression: number
  caution: number
  exploration: number
  spirituality: number
  opportunism: number
  solidarity: number
  patience: number
  cruelty: number
}

export function initArchetypeHistory(): ArchetypeHistory {
  return {
    aggression: 0,
    caution: 0,
    exploration: 0,
    spirituality: 0,
    opportunism: 0,
    solidarity: 0,
    patience: 0,
    cruelty: 0
  }
}

export function getArchetypeHistory(player: PlayerState): ArchetypeHistory {
  const n = player.narrative
  if (!n || !n.pactHistory) return initArchetypeHistory()

  const arcEntries = n.pactHistory.filter(x => x.startsWith("arc:"))

  const hist = initArchetypeHistory()
  for (const tag of arcEntries) {
    const key = tag.slice(4) as keyof ArchetypeHistory
    if (hist[key] !== undefined) hist[key]++
  }
  return hist
}

// -----------------------------------------------------
// ARQUÉTIPO MOMENTÂNEO = HISTÓRICO + ESTADO ATUAL
// -----------------------------------------------------

export function getArchetypeState(player: PlayerState) {
  const h = getArchetypeHistory(player)

  const A = {
    aggression: h.aggression + (player.attributes.strength >= 3 ? 1 : 0),
    caution: h.caution + (player.vitals.hp <= 4 ? 1 : 0),
    exploration: h.exploration + (player.attributes.instinct + player.attributes.perception > 4 ? 1 : 0),
    spirituality: h.spirituality + (player.attributes.concentration + player.attributes.mana > 3 ? 1 : 0),
    opportunism: h.opportunism + (player.attributes.dexterity >= 3 ? 1 : 0),
    solidarity: h.solidarity + (player.vitals.moral >= 6 ? 1 : 0),
    patience: h.patience + (player.attributes.will >= 3 ? 1 : 0),
    cruelty: h.cruelty + (player.lineage?.type === "vampiric" ? 1 : 0)
  }

  return A
}

// -----------------------------------------------------
// REGISTRO DE COMPORTAMENTO
// -----------------------------------------------------

export async function registerArchetypeAction(
  player: PlayerState,
  tag: keyof ArchetypeHistory
) {
  if (!player.narrative.pactHistory) {
    player.narrative.pactHistory = []
  }
  player.narrative.pactHistory.push(`arc:${tag}`)
  await savePlayer(player)
}

// -----------------------------------------------------
// IMPACTOS SISTÊMICOS
// -----------------------------------------------------

export function archetypeInfluenceCritical(player: PlayerState): number {
  const arc = getArchetypeState(player)
  const score = arc.aggression + arc.opportunism
  if (score >= 4) return 2
  if (score >= 2) return 1
  return 0
}

export function archetypeInfluenceDefense(player: PlayerState): number {
  const arc = getArchetypeState(player)
  const score = arc.caution + arc.patience
  if (score >= 4) return 2
  if (score >= 2) return 1
  return 0
}

export function archetypeInfluenceEscape(player: PlayerState): boolean {
  const arc = getArchetypeState(player)
  const score = arc.caution + arc.opportunism
  const roll = randomInt(0, score + 2)
  return roll >= 2
}

export function archetypeInfluenceDiscovery(player: PlayerState): boolean {
  const arc = getArchetypeState(player)
  const score = arc.exploration + arc.spirituality
  const roll = randomInt(0, score + 2)
  return roll >= 3
}

export function archetypeInfluenceLoot(player: PlayerState): boolean {
  const arc = getArchetypeState(player)
  const score = arc.exploration + arc.opportunism
  const roll = randomInt(0, score + 2)
  return roll >= 3
}

export function archetypeInfluenceHealing(player: PlayerState): number {
  const arc = getArchetypeState(player)
  const score = arc.spirituality + arc.solidarity
  if (score >= 4) return 2
  if (score >= 2) return 1
  return 0
}

// -----------------------------------------------------
// IMPACTO COLETIVO EM COMBATE
// -----------------------------------------------------

export function archetypeCollectiveAura(
  players: PlayerState[],
  combat: CombatState
) {
  const groupScore = players.reduce((acc, p) => {
    const arc = getArchetypeState(p)
    return acc + arc.solidarity + arc.spirituality
  }, 0)

  if (groupScore >= 6) {
    combat.log.push({
      timestamp: Date.now(),
      text: `Uma calma coletiva se espalha entre os combatentes.`
    })
  }
}

// -----------------------------------------------------
// RITUAL / PACTO / EVENTO
// -----------------------------------------------------

export function archetypeAffinityRitual(player: PlayerState): boolean {
  const arc = getArchetypeState(player)
  const roll = randomInt(0, arc.spirituality + arc.patience + 2)
  return roll >= 3
}

export function archetypeAffinityLich(player: PlayerState): boolean {
  const arc = getArchetypeState(player)
  const roll = randomInt(0, arc.spirituality + arc.cruelty + 2)
  return roll >= 3
}

export function archetypeAffinityBotanic(player: PlayerState): boolean {
  const arc = getArchetypeState(player)
  const roll = randomInt(0, arc.exploration + arc.patience + 2)
  return roll >= 3
}
