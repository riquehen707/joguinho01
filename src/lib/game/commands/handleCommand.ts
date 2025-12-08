import { jsonGet, jsonSet } from "@/lib/game/state/redisClient";
import type { PlayerState } from "@/lib/game/state/playerState";
import type { RoomState } from "@/lib/game/state/worldState";
import type { CombatState } from "@/lib/game/state/combatState";
import {
  CommandInput,
  CommandHandler,
  CommandResult,
  CommandContext,
  fail,
} from "./types";

import { look } from "./look";
import { inventory } from "./inventory";
import { stats } from "./stats";
import { observe } from "./observe";
import { joinCombat } from "./joinCombat";

const COMMANDS: Record<string, CommandHandler> = {
  look,
  inventory,
  stats,
  observe,
  joincombat: joinCombat,
};

function parseInput(rawInput: string): CommandInput {
  const parts = rawInput.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { raw: rawInput, command, args };
}

async function loadPlayer(playerId: string): Promise<PlayerState> {
  const state = await jsonGet<PlayerState>(mud:player:);
  if (!state) throw new Error(\player \ não encontrado\);
  return state;
}

async function loadRoom(roomId: string): Promise<RoomState | null> {
  return await jsonGet<RoomState>(\mud:room:\\);
}

async function loadCombatByRoom(roomId: string): Promise<CombatState | null> {
  const id = await jsonGet<string>(\mud:room:\:combatId\);
  if (!id) return null;
  return await jsonGet<CombatState>(\mud:combat:\\);
}

async function savePlayer(state: PlayerState): Promise<void> {
  await jsonSet(\mud:player:\\, state);
}

async function saveRoom(state: RoomState): Promise<void> {
  await jsonSet(\mud:room:\\, state);
}

async function saveCombat(state: CombatState): Promise<void> {
  await jsonSet(\mud:combat:\\, state);
}

export async function executeCommand(params: {
  playerId: string;
  rawInput: string;
}): Promise<CommandResult> {
  const input = parseInput(params.rawInput);

  const player = await loadPlayer(params.playerId);
  const room = player.roomId ? await loadRoom(player.roomId) : null;
  const combat = player.combatId
    ? await jsonGet<CombatState>(\mud:combat:\\)
    : null;

  const ctx: CommandContext = {
    playerId: params.playerId,
    input,
    now: new Date(),
    player,
    room,
    combat,

    loadCombatByRoom,
    savePlayer,
    saveRoom,
    saveCombat,
  };

  const handler = COMMANDS[input.command];
  if (!handler) {
    return fail(\Comando '\' não reconhecido.\);
  }

  const result = await handler(ctx);
  return result;
}
