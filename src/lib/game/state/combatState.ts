// src/lib/game/state/combatState.ts

export type CombatParticipant = {
  id: string
  type: "player" | "monster" | "horde" | "elite" | "spirit"
  stance?: "defensive" | "aggressive" | "neutral"
  vitals?: {
    hp: number
    moral?: number
  }
}

export type CombatLogEntry = {
  timestamp: number
  text: string
}

export type CombatState = {
  id: string
  roomId: string
  startedAt: number
  active: boolean
  turn: number
  participants: Record<string, CombatParticipant>
  lastActionAt: number
  log: CombatLogEntry[]
}

export function createCombatState(roomId: string): CombatState {
  const id = `combat-${roomId}-${Date.now()}`
  return {
    id,
    roomId,
    startedAt: Date.now(),
    active: true,
    turn: 0,
    participants: {},
    lastActionAt: Date.now(),
    log: []
  }
}
