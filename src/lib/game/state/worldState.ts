// src/lib/game/state/worldState.ts

export type RoomConnection = {
  north?: string
  south?: string
  east?: string
  west?: string
  secret?: string
}

export type RoomState = {
  id: string
  biome: string
  danger: number
  players: string[]
  monsters: string[]
  events: string[]
  ambientTags: string[]
  parentRegion?: string
  connections: RoomConnection
}

export type RegionImpact = {
  ambientEvent?: string
  roomInfluence?: string[]
  lineageBias?: string[]
  moralShift?: "low" | "medium" | "high"
  spawnSuppression?: boolean
  spawnMutation?: boolean
}

export type WorldMemory = {
  bossesKilled: string[]
  ritualsPerformed: string[]
  lineageStabilizations: number
  narrativeMarks: string[]
}

export type WorldState = {
  id: string
  seed: string
  buildVersion: string
  createdAt: number
  lastTickAt: number
  rooms: Record<string, RoomState>
  regionEffects: Record<string, RegionImpact>
  memory: WorldMemory
}

export function createInitialWorldState(seed: string): WorldState {
  return {
    id: `world-${seed}`,
    seed,
    buildVersion: "1.0.0",
    createdAt: Date.now(),
    lastTickAt: Date.now(),
    rooms: {},
    regionEffects: {},
    memory: {
      bossesKilled: [],
      ritualsPerformed: [],
      lineageStabilizations: 0,
      narrativeMarks: []
    }
  }
}
