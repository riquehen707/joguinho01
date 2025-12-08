// src/lib/game/systems/lootManager.ts

import { getJSON, setJSON } from "../state/redisClient"
import { PlayerState } from "../state/playerState"
import { RoomState } from "../state/worldState"
import baseLoot from "../entities/items/weapons.json"
import armorLoot from "../entities/items/armor.json"
import consumables from "../entities/items/consumables.json"
import artifacts from "../entities/items/artifacts.json"
import { randomInt } from "../utils/randomSeeded"

const PLAYER_KEY = (id: string) => `mud:player:${id}:state`
const ROOM_KEY = (id: string) => `mud:room:${id}:state`

async function savePlayer(p: PlayerState) {
  await setJSON(PLAYER_KEY(p.id), p)
}

async function saveRoom(r: RoomState) {
  await setJSON(ROOM_KEY(r.id), r)
}

function pickFrom<T>(arr: T[]) {
  if (!arr.length) return null
  return arr[randomInt(0, arr.length)]
}

export async function dropMonsterLoot(
  room: RoomState,
  monsterId: string,
  player: PlayerState
) {
  const pool = [
    ...baseLoot,
    ...armorLoot,
    ...consumables
  ]

  const item = pickFrom(pool)
  if (!item) return null

  room.events.push(`loot:${item.id}`)
  await saveRoom(room)

  return item
}

export async function assignLootToPlayer(
  player: PlayerState,
  item: any
) {
  if (!item) return null

  if (item.type === "weapon") {
    player.equipment.weapon = item.id
  }

  if (item.type === "armor") {
    player.equipment.armor = item.id
  }

  if (item.type === "artifact") {
    player.equipment.artifact = item.id
  }

  await savePlayer(player)
  return item
}

export async function rareArtifactRoll(
  player: PlayerState,
  room: RoomState
) {
  const luck = player.attributes.luck
  const instinct = player.attributes.instinct
  const base = luck + instinct

  const roll = randomInt(0, base + 4)
  if (roll < 4) return null

  const item = pickFrom(artifacts)
  if (!item) return null

  room.events.push(`artifact:${item.id}`)
  await saveRoom(room)

  player.equipment.artifact = item.id
  await savePlayer(player)

  return item
}
