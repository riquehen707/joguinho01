// src/lib/game/world/worldGenerator.ts

import baseRooms from "./rooms/baseRooms.json"
import secretRooms from "./rooms/secretRooms.json"
import subBossRooms from "./rooms/subBossRooms.json"
import bossRooms from "./rooms/bossRooms.json"
import namingTables from "./rooms/namingTables.json"
import connectionRules from "./rooms/connectionRules.json"

import { setJSON } from "../state/redisClient"
import { randomInt, randomItem } from "../utils/randomSeeded"
import { RoomState, WorldState } from "../state/worldState"

const WORLD_KEY = (id: string) => `mud:world:${id}:state`
const ROOM_STATE_KEY = (id: string) => `mud:room:${id}:state`

async function saveWorld(world: WorldState) {
  await setJSON(WORLD_KEY(world.id), world)
}

async function saveRoom(room: RoomState) {
  await setJSON(ROOM_STATE_KEY(room.id), room)
}

/**
 * Gera um nome procedural com coerência textual
 */
function generateRoomName() {
  const pre = randomItem(namingTables.prefix)
  const suf = randomItem(namingTables.suffix)
  return `${pre} ${suf}`
}

/**
 * Clone de template base para estado runtime
 */
function makeRoomState(template: any, index: number): RoomState {
  const id = `${template.id}-${index}-${Date.now()}`
  const name = template.customName || generateRoomName()

  return {
    id,
    name,
    biome: template.biome || "unknown",
    danger: template.danger || 1,
    exits: {},
    players: [],
    events: [],
    monsterState: {},
    lootState: {},
    discoveredAt: Date.now(),
    lastVisitedAt: null,
    flags: {}
  }
}

/**
 * Seleciona blocos de salas coerentes
 */
function pickRoomTemplates(count: number) {
  const arr = []
  for (let i = 0; i < count; i++) {
    const t = randomItem(baseRooms)
    if (t) arr.push(t)
  }
  return arr
}

/**
 * Seleciona sub-boss rooms com distribuição
 */
function pickSubBossTemplates(count: number) {
  const arr = []
  for (let i = 0; i < count; i++) {
    const t = randomItem(subBossRooms)
    if (t) arr.push(t)
  }
  return arr
}

/**
 * Seleciona boss rooms
 */
function pickBossTemplates(count: number) {
  const arr = []
  for (let i = 0; i < count; i++) {
    const t = randomItem(bossRooms)
    if (t) arr.push(t)
  }
  return arr
}

/**
 * Seleciona secret rooms com baixa frequência
 */
function pickSecretTemplates(count: number) {
  const arr = []
  for (let i = 0; i < count; i++) {
    const t = randomItem(secretRooms)
    if (t) arr.push(t)
  }
  return arr
}

/**
 * Conecta dois rooms por direção
 */
function connectRooms(a: RoomState, b: RoomState, dir: string) {
  a.exits[dir] = b.id
  const opposite = connectionRules.opposite[dir]
  if (opposite) b.exits[opposite] = a.id
}

/**
 * Gera layout geral:
 *
 * 80 salas base + ramificações + retorno topológico
 * conexões com 2–3 saídas
 * boss rooms no fundo
 * sub-boss rooms no meio
 * secret rooms ocultas
 */
export async function generateWorld(worldId: string) {
  const baseCount = 80
  const subBossCount = 12
  const bossCount = 4
  const secretCount = 20

  const baseTemplates = pickRoomTemplates(baseCount)
  const subBossTemplates = pickSubBossTemplates(subBossCount)
  const bossTemplates = pickBossTemplates(bossCount)
  const secretTemplates = pickSecretTemplates(secretCount)

  let rooms: RoomState[] = []
  let index = 0

  for (const t of baseTemplates) rooms.push(makeRoomState(t, index++))
  for (const t of subBossTemplates) rooms.push(makeRoomState(t, index++))
  for (const t of bossTemplates) rooms.push(makeRoomState(t, index++))
  for (const t of secretTemplates) rooms.push(makeRoomState(t, index++))

  /**
   * Conectar salas em linha base
   */
  for (let i = 0; i < rooms.length - 1; i++) {
    connectRooms(rooms[i], rooms[i + 1], randomItem(connectionRules.primaryDirs))
  }

  /**
   * Branch secundário: chance de virar
   */
  for (let i = 2; i < rooms.length - 2; i++) {
    if (randomInt(0, 4) === 1) {
      const target = rooms[i + randomInt(1, 4)]
      connectRooms(rooms[i], target, randomItem(connectionRules.secondaryDirs))
    }
  }

  /**
   * Retornos topológicos
   */
  for (let i = 3; i < rooms.length - 3; i++) {
    if (randomInt(0, 6) === 2) {
      const previous = rooms[i - randomInt(2, 3)]
      connectRooms(rooms[i], previous, randomItem(connectionRules.secondaryDirs))
    }
  }

  /**
   * Posicionar secret rooms
   */
  for (const r of rooms.filter(x => Object.keys(x.exits).length <= 2)) {
    if (randomInt(0, 8) === 1) {
      const secret = rooms[randomInt(rooms.length - secretCount, rooms.length - 1)]
      connectRooms(r, secret, "secret")
      secret.flags.isSecret = true
    }
  }

  /**
   * Boss rooms bem no fundo
   */
  for (const boss of rooms.slice(rooms.length - 4)) {
    boss.flags.isBoss = true
    boss.flags.permadeath = true
    boss.flags.highDanger = true
  }

  /**
   * Sub-boss rooms em seções intermediárias
   */
  for (const sub of rooms.slice(rooms.length - 20, rooms.length - 4)) {
    if (!sub.flags.isBoss) {
      sub.flags.isSubBoss = true
    }
  }

  /**
   * Salvar estado mundial
   */
  const world: WorldState = {
    id: worldId,
    totalRooms: rooms.length,
    rootRoomId: rooms[0].id,
    createdAt: Date.now(),
    lastResetAt: Date.now()
  }

  await saveWorld(world)

  /**
   * Salvar cada sala individualmente
   */
  for (const r of rooms) {
    await saveRoom(r)
  }

  return {
    world,
    rooms
  }
}
