// src/lib/game/systems/lineageManager.ts

import { PlayerState } from "../state/playerState"
import { CombatState } from "../state/combatState"
import { setJSON } from "../state/redisClient"
import lineages from "../entities/lineages/lineages.json"
import { randomInt } from "../utils/randomSeeded"

const PLAYER_KEY = (id: string) => `mud:player:${id}:state`
const COMBAT_KEY = (id: string) => `mud:combat:${id}:state`

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

async function saveCombat(c: CombatState) {
  await setJSON(COMBAT_KEY(c.id), c)
}

/**
 * absorve essência contextual
 * aumenta estabilidade da linhagem
 * pode gerar transformação
 */
export async function absorbEssence(
  player: PlayerState,
  essenceId: string
) {
  const lineage = lineages.find(l => l.essence === essenceId)
  if (!lineage) return null

  if (!player.lineage.type) {
    player.lineage.type = lineage.type
    player.lineage.stability = 1
    await savePlayer(player)
    return lineage
  }

  if (player.lineage.type === lineage.type) {
    player.lineage.stability = (player.lineage.stability || 1) + 1
    await savePlayer(player)
    return lineage
  }

  const roll = randomInt(0, 6)

  if (roll > 3) {
    player.lineage.type = lineage.type
    player.lineage.stability = 1
    await savePlayer(player)
    return lineage
  }

  return null
}

/**
 * influência passiva da linhagem na batalha
 */
export async function lineageCombatAura(
  combat: CombatState,
  player: PlayerState
) {
  if (!player.lineage?.type) return null

  if (player.lineage.type === "vampiric") {
    const roll = randomInt(0, 4)
    if (roll >= 3) {
      player.vitals.moral = Math.min(player.vitals.moral + 1, 10)
      await savePlayer(player)

      combat.log.push({
        timestamp: Date.now(),
        text: `${player.name} manifesta presença vampírica na sala.`
      })

      await saveCombat(combat)
    }
  }

  if (player.lineage.type === "necromantic") {
    const roll = randomInt(0, 4)
    if (roll >= 3) {
      combat.log.push({
        timestamp: Date.now(),
        text: `${player.name} convoca ecos de mortos.`
      })
      await saveCombat(combat)
    }
  }

  if (player.lineage.type === "feral") {
    const roll = randomInt(0, 4)
    if (roll >= 3) {
      player.vitals.stamina = Math.min(player.vitals.stamina + 1, 8)
      await savePlayer(player)

      combat.log.push({
        timestamp: Date.now(),
        text: `${player.name} desperta vigor animal.`
      })

      await saveCombat(combat)
    }
  }

  return true
}

/**
 * transformação de forma quando estabilidade cresce
 */
export async function lineageMutation(
  player: PlayerState
) {
  if (!player.lineage?.type) return null

  const stability = player.lineage.stability || 1
  if (stability < 3) return null

  const roll = randomInt(0, stability + 2)
  if (roll < 3) return null

  player.lineage.transformationLevel =
    (player.lineage.transformationLevel || 0) + 1

  await savePlayer(player)

  return {
    lineage: player.lineage.type,
    newLevel: player.lineage.transformationLevel
  }
}
