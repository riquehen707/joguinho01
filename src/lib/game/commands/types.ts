import type { PlayerState } from "@/lib/game/state/playerState";
import type { RoomState } from "@/lib/game/state/worldState";
import type { CombatState } from "@/lib/game/state/combatState";

export interface CommandInput {
  raw: string;
  command: string;
  args: string[];
}

export interface CommandLogEntry {
  channel: "system" | "room" | "combat" | "self" | "error";
  message: string;
}

export interface CommandResultView {
  player?: any;
  room?: any;
  combat?: any;
}

export interface CommandResult {
  ok: boolean;
  logs: CommandLogEntry[];
  view?: CommandResultView;
}

export interface CommandContext {
  playerId: string;
  input: CommandInput;
  now: Date;
  player: PlayerState;
  room: RoomState | null;
  combat: CombatState | null;

  loadCombatByRoom(roomId: string): Promise<CombatState | null>;
  savePlayer(state: PlayerState): Promise<void>;
  saveRoom(state: RoomState): Promise<void>;
  saveCombat(state: CombatState): Promise<void>;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

export function log(channel: CommandLogEntry["channel"], message: string) {
  return { channel, message };
}

export function ok(
  logs: CommandLogEntry[],
  view?: CommandResultView
): CommandResult {
  return { ok: true, logs, view };
}

export function fail(message: string): CommandResult {
  return { ok: false, logs: [{ channel: "error", message }] };
}
