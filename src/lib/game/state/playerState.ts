// src/lib/game/state/playerState.ts

export type PlayerAttributes = {
  strength: number
  dexterity: number
  instinct: number
  perception: number
  intelligence: number
  concentration: number
  will: number
  luck: number
  constitution: number
  mana: number
}

export type PlayerVitals = {
  hp: number
  stamina: number
  mana: number
  moral: number
}

export type PlayerEquipment = {
  weapon?: string
  armor?: string
  artifact?: string
}

export type PlayerLineage = {
  type?: string
  stability?: number
  transformationLevel?: number
}

export type PlayerNarrativeMarks = {
  roomDiscoveries: string[]
  lineageEvents: string[]
  pactHistory: string[]
}

export type PlayerState = {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  roomId: string
  attributes: PlayerAttributes
  vitals: PlayerVitals
  equipment: PlayerEquipment
  lineage: PlayerLineage
  narrative: PlayerNarrativeMarks
  isInCombat: boolean
  combatId?: string
}

export function createInitialPlayerState(id: string): PlayerState {
  return {
    id,
    name: `player-${id}`,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    roomId: "crypt-entrance",
    attributes: {
      strength: 1,
      dexterity: 1,
      instinct: 1,
      perception: 1,
      intelligence: 1,
      concentration: 1,
      will: 1,
      luck: 1,
      constitution: 1,
      mana: 1
    },
    vitals: {
      hp: 12,
      stamina: 6,
      mana: 4,
      moral: 6
    },
    equipment: {},
    lineage: {},
    narrative: {
      roomDiscoveries: [],
      lineageEvents: [],
      pactHistory: []
    },
    isInCombat: false
  }
}
