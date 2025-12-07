import { OriginId, Formation, Tendency } from "./worldData";

export type EventKind = "system" | "combat" | "chat" | "loot" | "move" | "info";

export type GameEvent = {
  id: string;
  text: string;
  ts: number;
  type: EventKind;
  roomId?: string;
};

export type AttributeSet = {
  precision: number;
  agility: number;
  might: number;
  will: number;
  defense: number;
  resistance: number;
  recovery: number;
  crit: number;
};

export type StatusEffect = {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  stat?: keyof AttributeSet | "regen" | "energy" | "bleed" | "burn";
  magnitude: number;
  duration: number;
};

export type SkillKind = "attack" | "utility" | "defense" | "summon";

export type SkillState = {
  id: string;
  name: string;
  kind: SkillKind;
  description?: string;
  cost?: { energy?: number; hp?: number };
  damage?: number;
  aoe?: "single" | "line" | "cone" | "room";
  tags?: string[];
  cooldown?: number;
  currentCooldown?: number;
  equipped?: boolean;
};

export type Affinity = {
  id: string;
  name: string;
  originId: OriginId;
};

export type OriginDef = {
  id: OriginId;
  name: string;
  description: string;
  affinities: Affinity[];
  ranges: Record<keyof AttributeSet, [number, number]>;
};

export type Monster = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  reward: number;
  tags?: string[];
};

export type Room = {
  id: string;
  name: string;
  description: string;
  exits: Record<string, string>;
  items: string[];
  monsters: Monster[];
  biome?: string;
  danger?: number;
  siteType?: string;
  ownerId?: string;
  claimable?: boolean;
  vault?: string[];
  vaultSize?: number;
  buildCost?: { gold: number; items?: string[]; energy?: number };
};

export type PlayerRecord = {
  id: string;
  name: string;
  roomId: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  score: number;
  gold: number;
  inventory: string[];
  lastActive: number;
  isAlive: boolean;
  origin: OriginDef;
  tendency?: Tendency;
  affinity: Affinity;
  attributes: AttributeSet;
  affinityKnown: boolean;
  statusEffects: StatusEffect[];
  formation: Formation;
  skillsKnown?: string[];
  skillBar?: string[];
  passiveBar?: string[];
  skillCooldowns?: Record<string, number>;
  skills?: SkillState[];
  tagProgress?: Record<string, number>;
};

export type PlayerView = {
  id: string;
  name: string;
  roomId: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  score: number;
  gold: number;
  inventory: string[];
  inventoryLimit: number;
  isAlive: boolean;
  origin: { id: OriginId; name: string; description: string };
  tendency?: Tendency;
  affinityKnown: boolean;
  attributes: AttributeSet;
  statusEffects: StatusEffect[];
  formation: Formation;
  skills?: SkillState[];
  tagProgress?: Record<string, number>;
};

export type RoomView = {
  id: string;
  name: string;
  description: string;
  exits: { direction: string; to: string }[];
  items: string[];
  monsters: { id: string; name: string; hp: number; maxHp: number }[];
  occupants: { id: string; name: string }[];
  claimable?: boolean;
  ownerId?: string;
  ownerName?: string;
  vaultSize?: number;
  vaultCount?: number;
  danger?: number;
  biome?: string;
  siteType?: string;
  buildCost?: { gold: number; items?: string[]; energy?: number };
  layout?: string[]; // mapa local ASCII opcional
};

export type WorldRoomView = { id: string; name: string; exits: { direction: string; to: string }[] };

export type ScoreEntry = { id: string; name: string; score: number };

export type GameSnapshot = {
  player: PlayerView;
  room: RoomView;
  world: WorldRoomView[];
  scoreboard: ScoreEntry[];
  events: GameEvent[];
  now: number;
};
