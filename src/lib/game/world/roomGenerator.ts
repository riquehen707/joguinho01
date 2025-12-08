// src/lib/game/world/roomGenerator.ts

import { RoomState } from "../state/worldState"
import { PlayerState } from "../state/playerState"
import { randomInt, randomItem } from "../utils/randomSeeded"
import ambientEvents from "../entities/events/ambientEvents.json"
import discoveryEvents from "../entities/events/discoveryEvents.json"
import baseMonsters from "../entities/monsters/base.json"
import hordeMonsters from "../entities/monsters/hordes.json"
import eliteMonsters from "../entities/monsters/elite.json"
import ritualMonsters from "../entities/monsters/ritual.json"
import { setJSON, getJSON } from "../state/redisClient"
import { archetypeInfluenceDiscovery } from "../systems/archetypeInterpreter"

const ROOM_STATE_KEY = (id: string) => `mud:room:${id}:state`
const PLAYER_KEY = (id: string) => `mud:player:${id}:state`

async function saveRoom(room: RoomState) {
  await setJSON(ROOM_STATE_KEY(room.id), room)
}

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

export async function getRoom(id: string) {
  return await getJSON<RoomState>(ROOM_STATE_KEY(id))
}

/**
 * Seleciona se a sala terá spawn, evento ambiental ou trama simbólica
 */
export function roomLocalProbabilities(room: RoomState) {
  const danger = room.danger || 1

  return {
    ambient: danger >= 1 ? 50 : 20,
    spawn: danger >= 2 ? 45 : 25,
    discovery: danger >= 1 ? 15 : 5,
    trap: danger >= 2 ? 10 : 3
  }
}

/**
 * Gera ambientação narrativa com coerência simbólica
 */
export function generateAmbient(room: RoomState) {
  const biome = room.biome || "unknown"
  const candidates = ambientEvents.filter(x =>
    !x.biome || x.biome === biome
  )

  const ev = randomItem(candidates)
  if (!ev) return null

  return {
    id: ev.id,
    text: ev.text.replace("{name}", room.name),
    effect: ev.effect || null
  }
}

/**
 * Escolhe monstro contextual
 */
function pickMonsterTemplate(room: RoomState) {
  const danger = room.danger || 1
  let pool: any[] = baseMonsters

  if (danger >= 2 && randomInt(0, 5) === 2) pool = [...pool, ...eliteMonsters]
  if (danger >= 2 && randomInt(0, 4) === 1) pool = [...pool, ...hordeMonsters]
  if (danger >= 3 && randomInt(0, 4) === 1) pool = [...pool, ...ritualMonsters]

  return randomItem(pool)
}

/**
 * Instancia monstros para a sala
 */
export function spawnMonsters(room: RoomState) {
  const template = pickMonsterTemplate(room)
  if (!template) return null

  let count = 1

  if (template.stance === "horde") {
    count = randomInt(3, 8)
  }

  const monsters = []
  for (let i = 0; i < count; i++) {
    monsters.push({
      id: `${template.id}-${room.id}-${i}`,
      stance: template.stance,
      hp: template.hp || 4,
      moral: template.moral || 3,
      name: template.name || template.id
    })
  }

  return {
    templateId: template.id,
    monsters
  }
}

/**
 * Armadilha: drenagem silenciosa, veneno, sombra espiritual, gás
 */
export function generateTrap(room: RoomState) {
  const t = randomInt(0, 3)
  if (t === 0) return { type: "poison", dmg: 1 }
  if (t === 1) return { type: "shadow", dmg: 1, moral: -1 }
  if (t === 2) return { type: "gas", stamina: -2 }
  return null
}

/**
 * Evento de descoberta (secretos, túmulos, pactos, atalhos)
 */
export async function tryDiscovery(player: PlayerState, room: RoomState) {
  if (!archetypeInfluenceDiscovery(player)) return null

  const biome = room.biome || "unknown"
  const candidates = discoveryEvents.filter(x =>
    !x.biome || x.biome === biome
  )

  const ev = randomItem(candidates)
  if (!ev) return null

  room.events.push(`discovery:${ev.id}`)
  await saveRoom(room)

  return {
    id: ev.id,
    name: ev.name,
    text: ev.text.replace("{room}", room.name)
  }
}

/**
 * Processamento local ao entrar na sala:
 * - ambientação
 * - spawn
 * - descoberta secreta
 * - armadilha
 */
export async function processRoomEnter(
  player: PlayerState,
  room: RoomState
) {
  let result: any = {}

  const prob = roomLocalProbabilities(room)

  // ambient
  if (randomInt(0, 100) < prob.ambient) {
    const ambient = generateAmbient(room)
    if (ambient) {
      room.events.push(`ambient:${ambient.id}`)
      result.ambient = ambient
    }
  }

  // spawn
  if (randomInt(0, 100) < prob.spawn) {
    const spawn = spawnMonsters(room)
    if (spawn) {
      room.monsterState = {
        templateId: spawn.templateId,
        monsters: spawn.monsters
      }
      result.spawn = spawn
    }
  }

  // discovery (influenciado por arquétipo)
  if (randomInt(0, 100) < prob.discovery) {
    const secret = await tryDiscovery(player, room)
    if (secret) {
      result.discovery = secret
    }
  }

  // trap
  if (randomInt(0, 100) < prob.trap) {
    const trap = generateTrap(room)
    if (trap) {
      player.vitals.hp = Math.max(0, player.vitals.hp - (trap.dmg || 0))
      player.vitals.moral = Math.max(0, (player.vitals.moral || 4) + (trap.moral || 0))
      player.vitals.stamina = Math.max(0, (player.vitals.stamina || 4) + (trap.stamina || 0))

      await savePlayer(player)

      result.trap = trap
    }
  }

  await saveRoom(room)
  return result
}

/**
 * Chamada principal quando o jogador entra numa sala via comando go.ts
 */
export async function enterRoom(player: PlayerState, roomId: string) {
  const room = await getRoom(roomId)
  if (!room) return null

  if (!room.players.includes(player.id)) {
    room.players.push(player.id)
  }

  player.lastRoomId = room.id
  player.lastSeenAt = Date.now()

  await saveRoom(room)
  await savePlayer(player)

  const localEffects = await processRoomEnter(player, room)

  return {
    room,
    localEffects
  }
}
