// src/lib/game/systems/dungeonTraversal.ts

import { getJSON, setJSON } from "../state/redisClient"
import { PlayerState } from "../state/playerState"
import { WorldState, RoomState } from "../state/worldState"
import { randomInt } from "../utils/randomSeeded"
import { tryRoomEvent } from "./eventOrchestrator"
import { explorationCheck } from "./explorationManager"
import { joinCombatIfActive } from "./combatManager"
import { combatNarrator } from "./combatNarrator"

// =========================================
// CONSTANTES
// =========================================

const WORLD_KEY = "mud:world:state"
const PLAYER_KEY = (id: string) => `mud:player:${id}:state`
const ROOM_KEY = (id: string) => `mud:room:${id}:state`

// =========================================
// FUNÇÕES UTIL
// =========================================

async function getWorld(): Promise<WorldState> {
  const world = await getJSON<WorldState>(WORLD_KEY)
  if (!world) {
    throw new Error("World state missing — world not generated.")
  }
  return world
}

async function getPlayer(id: string): Promise<PlayerState> {
  const p = await getJSON<PlayerState>(PLAYER_KEY(id))
  if (!p) {
    throw new Error(`Player state missing: ${id}`)
  }
  return p
}

async function getRoom(id: string): Promise<RoomState> {
  const r = await getJSON<RoomState>(ROOM_KEY(id))
  if (!r) {
    throw new Error(`Room state missing: ${id}`)
  }
  return r
}

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

async function saveRoom(r: RoomState) {
  await setJSON(ROOM_KEY(r.id), r)
}

async function saveWorld(w: WorldState) {
  await setJSON(WORLD_KEY, w)
}

// =========================================
// LOG NARRATIVO NA SALA
// =========================================

async function pushRoomLog(room: RoomState, text: string) {
  // combat narrator já cuida de logs
  // aqui só broadcast textual
  room.events.push(text)
  await saveRoom(room)
}

// =========================================
// REMOVER JOGADOR DE UMA SALA
// =========================================

async function removePlayerFromRoom(playerId: string, room: RoomState) {
  const index = room.players.indexOf(playerId)
  if (index >= 0) {
    room.players.splice(index, 1)
    await saveRoom(room)
  }
}

// =========================================
// ADICIONAR JOGADOR A UMA SALA
// =========================================

async function addPlayerToRoom(playerId: string, room: RoomState) {
  if (!room.players.includes(playerId)) {
    room.players.push(playerId)
    await saveRoom(room)
  }
}

// =========================================
// TRAVERSAL PRINCIPAL
// =========================================

export async function movePlayer(playerId: string, direction: "north" | "south" | "east" | "west" | "secret") {
  const world = await getWorld()
  const player = await getPlayer(playerId)

  const currentRoom = await getRoom(player.roomId)
  const targetRoomId = currentRoom.connections[direction]

  // ======================================
  // VALIDAR CONEXÃO
  // ======================================
  if (!targetRoomId) {
    await pushRoomLog(currentRoom, `${player.name} tenta ir para ${direction}, mas a passagem é inexistente.`)
    return {
      ok: false,
      reason: "blocked",
      narration: "Não há saída nessa direção."
    }
  }

  const targetRoom = await getRoom(targetRoomId)

  // ======================================
  // SAIR DO COMBATE SE NECESSÁRIO
  // ======================================
  if (player.isInCombat && direction !== "secret") {
    // combate não permite saída livre
    // a não ser que a sala tenha fuga sistêmica
    const canEscape = randomInt(0, player.attributes.dexterity + player.attributes.luck) > 3
    if (!canEscape) {
      await pushRoomLog(currentRoom, `${player.name} tenta escapar, mas a pressão da batalha o impede.`)
      return {
        ok: false,
        reason: "combat-escape-failed",
        narration: "Você não conseguiu fugir."
      }
    } else {
      await pushRoomLog(currentRoom, `${player.name} escapa do combate entre sombras e sangue.`)
      player.isInCombat = false
      player.combatId = undefined
      await savePlayer(player)
    }
  }

  // ======================================
  // REMOVER DE SALA ATUAL
  // ======================================
  await removePlayerFromRoom(player.id, currentRoom)

  // ======================================
  // ENTRAR NA NOVA SALA
  // ======================================
  player.roomId = targetRoom.id
  player.lastSeenAt = Date.now()
  await savePlayer(player)

  await addPlayerToRoom(player.id, targetRoom)

  // ======================================
  // DETECÇÃO DE COMBATE
  // sala pode já ter combate ativo
  // ou monstros podem reagir
  // ======================================
  const combatResult = await joinCombatIfActive(player, targetRoom)
  if (combatResult?.enteredCombat) {
    await combatNarrator(player, targetRoom, combatResult)
    return {
      ok: true,
      moved: true,
      enteredCombat: true,
      narration: `Você entra em ${targetRoom.id} e a batalha já está em andamento.`
    }
  }

  // ======================================
  // SE NÃO HÁ COMBATE, PODE HAVER EVENTO AMBIENTAL
  // ======================================
  const roomEventTriggered = await tryRoomEvent(player, targetRoom)
  if (roomEventTriggered) {
    return {
      ok: true,
      moved: true,
      event: roomEventTriggered,
      narration: `Ao entrar em ${targetRoom.id}, uma transformação espiritual ocorre.`
    }
  }

  // ======================================
  // VERIFICAÇÃO DE EXPLORAÇÃO PROFUNDA
  // ======================================
  const explorationOutcome = await explorationCheck(player, targetRoom)
  if (explorationOutcome?.discovery) {
    return {
      ok: true,
      moved: true,
      discovery: explorationOutcome,
      narration: explorationOutcome.text
    }
  }

  // ======================================
  // SE NADA EXTRA OCORREU: MOVIMENTO NORMAL
  // ======================================
  await pushRoomLog(targetRoom, `${player.name} chega pela passagem ${direction}.`)

  return {
    ok: true,
    moved: true,
    narration: `Você chega em: ${targetRoom.id}`
  }
}
