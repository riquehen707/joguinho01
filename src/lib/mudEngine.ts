import { randomUUID } from "crypto";
import { createClient } from "redis";
import {
  baseRooms,
  COMMON_LOOT,
  MONSTER_AFFINITY,
  MONSTER_TAGS,
  SKILL_TAG_UNLOCKS,
  OriginId,
  Tendency,
  Formation,
  RoomTemplate,
  MonsterTemplate,
  SKILLS,
  SKILL_DROPS,
  SkillDef,
} from "./worldData";
import { buildWorldTemplates } from "./mapGen";
import { Affinity, AttributeSet, EventKind, GameEvent, GameSnapshot, PlayerRecord, PlayerView, Room, RoomView, ScoreEntry, WorldRoomView, OriginDef, Monster } from "./types";

export type { OriginId, Tendency, Formation } from "./worldData";

type GameStore = {
  rooms: Record<string, Room>;
  players: Record<string, PlayerRecord>;
  accounts: Record<string, { email: string; passwordHash: string; playerId: string }>;
  log: GameEvent[];
};

export const INVENTORY_LIMIT = 12;
const REDIS_URL = process.env.REDIS_URL;
// bump para regenerar mundo procedural (mais salas)
const REDIS_KEY = "mud:store:v5";
type RedisInstance = ReturnType<typeof createClient> | null;
let redisClient: RedisInstance = null;
let redisLoaded = false;

type StatusEffect = {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  stat?: keyof AttributeSet | "regen" | "energy" | "bleed" | "burn";
  magnitude: number;
  duration: number;
};

type AwakenedEffect = {
  itemMatch: string;
  originId?: OriginId;
  affinityId?: string;
  bonusDamage?: number;
  bonusCrit?: number;
  text: string;
};

const initSkills = () => ({
  skillsKnown: [] as string[],
  skillBar: [] as string[], // ativas equipadas
  passiveBar: [] as string[],
  skillCooldowns: {} as Record<string, number>,
});

const INACTIVITY_TIMEOUT = 1000 * 60 * 15;
const LOG_LIMIT = 200;
const WORLD_SEED = process.env.WORLD_SEED || "frag-world";
const WORLD_TEMPLATES = buildWorldTemplates(baseRooms, WORLD_SEED, 99);
const MONSTER_POOLS: Record<string, MonsterTemplate[]> = WORLD_TEMPLATES.reduce((acc, tpl) => {
  if (!tpl.biome) return acc;
  acc[tpl.biome] = acc[tpl.biome] || [];
  acc[tpl.biome].push(...tpl.monsters);
  return acc;
}, {} as Record<string, MonsterTemplate[]>);
const DEFAULT_POOL: MonsterTemplate[] = WORLD_TEMPLATES.flatMap((tpl) => tpl.monsters);
const ACTIVE_SKILL_SLOTS = 2;
const PASSIVE_SKILL_SLOTS = 2;
const STARTER_SKILLS = ["basic-strike", "quick-shot"];

const ensureTagProgress = (player: PlayerRecord) => {
  if (!player.tagProgress) {
    player.tagProgress = {};
  }
};

const awardTagProgress = (
  player: PlayerRecord,
  tags: string[],
  localEvents: GameEvent[],
) => {
  if (!tags || tags.length === 0) return;
  if (!player.tagProgress) player.tagProgress = {};
  const unlocked: string[] = [];
  for (const tag of tags) {
    player.tagProgress[tag] = (player.tagProgress[tag] ?? 0) + 1;
    const unlocks = SKILL_TAG_UNLOCKS[tag];
    if (!unlocks) continue;
    for (const unlock of unlocks) {
      const knows = player.skillsKnown?.includes(unlock.skillId);
      if (!knows && player.tagProgress[tag] >= unlock.threshold) {
        player.skillsKnown = player.skillsKnown || [];
        player.skillsKnown.push(unlock.skillId);
        if ((player.skillBar?.length ?? 0) < ACTIVE_SKILL_SLOTS) {
          player.skillBar = player.skillBar || [];
          player.skillBar.push(unlock.skillId);
        }
        unlocked.push(unlock.skillId);
      }
    }
  }
  if (unlocked.length) {
    localEvents.push({
      id: randomUUID(),
      text: `${player.name} desbloqueou: ${unlocked.join(", ")}.`,
      ts: Date.now(),
      type: "info",
    });
  }
};

const FORMATION_MODS: Record<
  Formation,
  { hit: number; crit: number; mitigation: number; dmg: number; label: string }
> = {
  vanguarda: { hit: -3, crit: 0, mitigation: 0.2, dmg: 0, label: "Vanguarda" },
  retaguarda: { hit: 5, crit: 5, mitigation: -0.1, dmg: 0.05, label: "Retaguarda" },
  furtivo: { hit: 3, crit: 10, mitigation: -0.05, dmg: 0.08, label: "Furtivo/Flanco" },
  sentinela: { hit: -6, crit: -4, mitigation: 0.35, dmg: -0.05, label: "Sentinela/Guardião" },
  artilharia: { hit: 8, crit: 8, mitigation: -0.2, dmg: 0.12, label: "Artilharia/Longo alcance" },
};

const ORIGINS: OriginDef[] = [
  {
    id: "arcana",
    name: "Arcana/Oculta",
    description: "Magos, feiticeiros, necromantes e eco de ilusão.",
    affinities: [
      { id: "sangue", name: "Sangue", originId: "arcana" },
      { id: "sombra", name: "Sombra", originId: "arcana" },
      { id: "ruina", name: "Ruína", originId: "arcana" },
      { id: "eco", name: "Eco/Ilusão", originId: "arcana" },
      { id: "tempestade", name: "Tempestade", originId: "arcana" },
    ],
    ranges: {
      precision: [10, 16],
      agility: [8, 13],
      might: [8, 12],
      will: [14, 22],
      defense: [8, 12],
      resistance: [10, 18],
      recovery: [12, 18],
      crit: [6, 10],
    },
  },
  {
    id: "nocturna",
    name: "Nocturna/Sanguínea",
    description: "Vampiros, lupinos e predadores lunares que vivem de fúria e regeneração.",
    affinities: [
      { id: "feral", name: "Feral", originId: "nocturna" },
      { id: "predacao", name: "Predação", originId: "nocturna" },
      { id: "sangue-antigo", name: "Sangue Antigo", originId: "nocturna" },
      { id: "furia", name: "Fúria Lunar", originId: "nocturna" },
      { id: "regenerar", name: "Regeneração Sombria", originId: "nocturna" },
    ],
    ranges: {
      precision: [10, 15],
      agility: [12, 20],
      might: [12, 19],
      will: [10, 15],
      defense: [10, 16],
      resistance: [10, 16],
      recovery: [12, 18],
      crit: [8, 12],
    },
  },
  {
    id: "forja",
    name: "Forja/Engenharia",
    description: "Engenheiros, tecnomantes e usuários de implantes, pressão e drones.",
    affinities: [
      { id: "engrenagem", name: "Engrenagem", originId: "forja" },
      { id: "circuito", name: "Circuito", originId: "forja" },
      { id: "pressao", name: "Pressão/Calor", originId: "forja" },
      { id: "drone", name: "Drone", originId: "forja" },
      { id: "blindagem", name: "Blindagem", originId: "forja" },
    ],
    ranges: {
      precision: [12, 18],
      agility: [10, 16],
      might: [11, 17],
      will: [10, 15],
      defense: [12, 18],
      resistance: [12, 18],
      recovery: [10, 15],
      crit: [6, 10],
    },
  },
  {
    id: "mitica",
    name: "Mítica/Constelação",
    description: "Heróis, deuses e relíquias celestes que carregam destino.",
    affinities: [
      { id: "raio", name: "Raio/Trovão", originId: "mitica" },
      { id: "mar", name: "Mar/Mares", originId: "mitica" },
      { id: "sol", name: "Sol/Luz", originId: "mitica" },
      { id: "lua", name: "Lua/Ilusão", originId: "mitica" },
      { id: "destino", name: "Destino/Marca", originId: "mitica" },
    ],
    ranges: {
      precision: [11, 17],
      agility: [10, 16],
      might: [12, 18],
      will: [12, 18],
      defense: [11, 17],
      resistance: [11, 17],
      recovery: [11, 17],
      crit: [7, 11],
    },
  },
];

const makeMonster = (name: string, hp: number, attack: number, reward: number, tags?: string[]): Monster => ({
  id: randomUUID(),
  name,
  hp,
  maxHp: hp,
  attack,
  reward,
  tags,
});

const connectRedis = async () => {
  if (!REDIS_URL) return null;
  if (redisClient) return redisClient;
  const client = createClient({ url: REDIS_URL });
  await client.connect();
  redisClient = client;
  return client;
};

const makeMonsterFromTemplate = (tpl: MonsterTemplate): Monster => ({
  id: randomUUID(),
  name: tpl.name,
  hp: tpl.hp,
  maxHp: tpl.hp,
  attack: tpl.attack,
  reward: tpl.reward,
  tags: tpl.tags,
});

const buildCostForRoom = (tpl: RoomTemplate | Room) => {
  if (!tpl.claimable) return undefined;
  const danger = tpl.danger ?? 1;
  const items: string[] = [];
  if (danger >= 2) items.push("gabarito de corda");
  if (danger >= 3) items.push("rebite pesado");
  if (tpl.siteType === "ruina" || tpl.siteType === "fenda") {
    items.push("pequena runa");
  }
  const gold = Math.max(5, 4 + danger * 3);
  const uniqueItems = items.length ? Array.from(new Set(items)) : undefined;
  return { gold, items: uniqueItems };
};

const hydrateRooms = (templates: RoomTemplate[], saved?: Record<string, Room>): Record<string, Room> => {
  const rooms: Record<string, Room> = {};
  for (const tpl of templates) {
    const savedRoom = saved?.[tpl.id];
    const buildCost = savedRoom?.buildCost ?? (tpl.claimable ? buildCostForRoom(tpl) : undefined);
    rooms[tpl.id] = {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      exits: { ...(savedRoom?.exits ?? tpl.exits) },
      items: [...(savedRoom?.items ?? tpl.items)],
      monsters: (savedRoom?.monsters ?? tpl.monsters.map((m) => makeMonsterFromTemplate(m))).map((m) => ({ ...m })),
      biome: savedRoom?.biome ?? tpl.biome,
      danger: savedRoom?.danger ?? tpl.danger,
      siteType: savedRoom?.siteType ?? tpl.siteType,
      claimable: savedRoom?.claimable ?? tpl.claimable ?? true,
      ownerId: savedRoom?.ownerId,
      vault: savedRoom?.vault ? [...savedRoom.vault] : [],
      vaultSize: savedRoom?.vaultSize ?? tpl.vaultSize ?? 0,
      buildCost,
    };
  }
  return rooms;
};

const bootstrapMemoryStore = (): GameStore => ({
  rooms: hydrateRooms(WORLD_TEMPLATES),
  players: {},
  accounts: {},
  log: [],
});

const deserializeStore = (data: string | null): GameStore => {
  if (!data) return bootstrapMemoryStore();
  try {
    const parsed = JSON.parse(data) as GameStore;
    const rooms = hydrateRooms(WORLD_TEMPLATES, parsed.rooms);
    return {
      rooms,
      players: parsed.players ?? {},
      accounts: parsed.accounts ?? {},
      log: parsed.log ?? [],
    };
  } catch {
    return bootstrapMemoryStore();
  }
};

const getStore = async (): Promise<GameStore> => {
  const globalRef = global as typeof global & { __mudStore?: GameStore };

  if (!globalRef.__mudStore) {
    globalRef.__mudStore = bootstrapMemoryStore();
  }

  if (!redisLoaded) {
    const client = await connectRedis().catch(() => null);
    if (client) {
      const raw = await client.get(REDIS_KEY).catch(() => null);
      if (raw) {
        globalRef.__mudStore = deserializeStore(raw);
      }
    }
    redisLoaded = true;
  }

  return globalRef.__mudStore;
};

const persistStore = async (store: GameStore) => {
  const client = await connectRedis().catch(() => null);
  if (!client) return;
  await client.set(
    REDIS_KEY,
    JSON.stringify({
      rooms: store.rooms,
      players: store.players,
      accounts: store.accounts,
      log: store.log,
    }),
  );
};

const clampName = (name: string) => {
  const clean = name.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim();
  if (!clean) return "Anonimo";
  return clean.slice(0, 18);
};

const roll = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const hashPassword = (value: string) =>
  value ? Buffer.from(value).toString("base64") : "";

const pickOrigin = (originId?: OriginId): OriginDef => {
  if (originId) {
    const found = ORIGINS.find((item) => item.id === originId);
    if (found) return found;
  }
  return ORIGINS[roll(0, ORIGINS.length - 1)];
};

const pickAffinity = (origin: OriginDef): Affinity =>
  origin.affinities[roll(0, origin.affinities.length - 1)];

const biasedRoll = (range: [number, number], tendency?: Tendency, key?: Tendency): number => {
  const [min, max] = range;
  const base = roll(min, max);
  if (!tendency || !key || tendency !== key) return base;
  const bump = Math.max(1, Math.round((max - min) * 0.25));
  return Math.min(max, base + bump);
};

const makeAttributes = (origin: OriginDef, tendency?: Tendency): AttributeSet => ({
  precision: biasedRoll(origin.ranges.precision, tendency, "precisao"),
  agility: biasedRoll(origin.ranges.agility, tendency, "agilidade"),
  might: biasedRoll(origin.ranges.might, tendency, "forca"),
  will: biasedRoll(origin.ranges.will, tendency, "vontade"),
  defense: biasedRoll(origin.ranges.defense, tendency, "defesa"),
  resistance: roll(origin.ranges.resistance[0], origin.ranges.resistance[1]),
  recovery: roll(origin.ranges.recovery[0], origin.ranges.recovery[1]),
  crit: roll(origin.ranges.crit[0], origin.ranges.crit[1]),
});

const deriveVitals = (attributes: AttributeSet) => {
  const maxHp = Math.max(
    24,
    Math.round(30 + attributes.might * 0.9 + attributes.defense * 0.8 + attributes.will * 0.4),
  );
  const maxEnergy = Math.max(
    10,
    Math.round(10 + attributes.agility * 0.6 + attributes.recovery * 0.6),
  );
  return { maxHp, maxEnergy };
};

const createEssenceItem = (affinity: Affinity) =>
  `essencia-${affinity.id} (${affinity.name})`;

const addStatus = (player: PlayerRecord, effect: Omit<StatusEffect, "id">, local: GameEvent[]) => {
  const existing = player.statusEffects.find(
    (s) => s.name === effect.name && s.stat === effect.stat && s.kind === effect.kind,
  );
  if (existing) {
    existing.duration = Math.max(existing.duration, effect.duration);
    existing.magnitude = Math.max(existing.magnitude, effect.magnitude);
  } else {
    player.statusEffects.push({ ...effect, id: randomUUID() });
  }
  local.push({
    id: randomUUID(),
    text: `${effect.name} ativo por ${effect.duration} turnos.`,
    ts: Date.now(),
    type: effect.kind === "buff" ? "system" : "combat",
  });
};

const ensureVault = (room: Room) => {
  if (!room.vault) room.vault = [];
  if (!room.vaultSize) room.vaultSize = 0;
  return room.vault;
};

const spawnMonstersForRoom = (room: Room) => {
  if (room.ownerId) return; // não spawnar dentro de base dominada pelo dono
  const pool = (room.biome && MONSTER_POOLS[room.biome]) || DEFAULT_POOL;
  if (!pool || pool.length === 0) return;
  const danger = Math.max(1, room.danger ?? 1);
  const maxCount = Math.min(20, 2 + danger * 3);
  const count = Math.max(1, roll(1, maxCount));
  room.monsters = Array.from({ length: count }).map(() => makeMonsterFromTemplate(pool[roll(0, pool.length - 1)]));
};

const skillById = (id: string) => SKILLS.find((s) => s.id === id);
const skillByName = (name: string) =>
  SKILLS.find((s) => normalizeText(s.name) === normalizeText(name) || normalizeText(s.id) === normalizeText(name));

const getPassiveBonus = (player: PlayerRecord) => {
  const equipped = player.passiveBar ?? [];
  let precision = 0;
  let crit = 0;
  for (const id of equipped) {
    const skill = skillById(id);
    if (!skill || skill.kind !== "passive") continue;
    if (skill.id === "echo-veil") {
      precision += 2;
      crit += 5;
    }
  }
  return { precision, crit };
};

const tickCooldowns = (player: PlayerRecord) => {
  if (!player.skillCooldowns) player.skillCooldowns = {};
  for (const [key, val] of Object.entries(player.skillCooldowns)) {
    if (val > 0) player.skillCooldowns[key] = Math.max(0, val - 1);
  }
};

const equipSkillCommand = (player: PlayerRecord, arg: string, localEvents: GameEvent[]) => {
  const [idRaw] = arg.trim().split(/\s+/);
  if (!idRaw) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: skill equip <id> (ativa) ou skill equip <id> (passiva). Slots limitados.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const skill = skillById(idRaw) ?? skillByName(arg);
  if (!skill || !player.skillsKnown?.includes(skill.id)) {
    localEvents.push({
      id: randomUUID(),
      text: "Skill não conhecida.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (skill.kind === "active") {
    const bar = player.skillBar ?? [];
    if (bar.includes(skill.id)) {
      localEvents.push({
        id: randomUUID(),
        text: `${skill.name} já está equipada.`,
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    if (bar.length >= ACTIVE_SKILL_SLOTS) {
      localEvents.push({
        id: randomUUID(),
        text: `Slots ativos cheios (${ACTIVE_SKILL_SLOTS}).`,
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    bar.push(skill.id);
    player.skillBar = bar;
  } else {
    const bar = player.passiveBar ?? [];
    if (bar.includes(skill.id)) {
      localEvents.push({
        id: randomUUID(),
        text: `${skill.name} já está equipada.`,
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    if (bar.length >= PASSIVE_SKILL_SLOTS) {
      localEvents.push({
        id: randomUUID(),
        text: `Slots passivos cheios (${PASSIVE_SKILL_SLOTS}).`,
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    bar.push(skill.id);
    player.passiveBar = bar;
  }
  localEvents.push({
    id: randomUUID(),
    text: `${skill.name} equipada.`,
    ts: Date.now(),
    type: "info",
  });
};

const unequipSkillCommand = (player: PlayerRecord, arg: string, localEvents: GameEvent[]) => {
  const [idRaw] = arg.trim().split(/\s+/);
  if (!idRaw) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: skill unequip <id>.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const skill = skillById(idRaw) ?? skillByName(arg);
  if (!skill) {
    localEvents.push({
      id: randomUUID(),
      text: "Skill não encontrada.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (skill.kind === "active") {
    player.skillBar = (player.skillBar ?? []).filter((id) => id !== skill.id);
  } else {
    player.passiveBar = (player.passiveBar ?? []).filter((id) => id !== skill.id);
  }
  localEvents.push({
    id: randomUUID(),
    text: `${skill.name} removida do slot.`,
    ts: Date.now(),
    type: "info",
  });
};

const tickStatus = (player: PlayerRecord, local: GameEvent[]) => {
  if (player.statusEffects.length === 0) return;
  let hpDelta = 0;
  let energyDelta = 0;
  const next: StatusEffect[] = [];

  for (const status of player.statusEffects) {
    if (status.stat === "regen") {
      hpDelta += status.magnitude;
    }
    if (status.stat === "energy") {
      energyDelta += status.magnitude;
    }
    if (status.stat === "bleed") {
      hpDelta -= status.magnitude;
    }
    if (status.stat === "burn") {
      hpDelta -= status.magnitude;
      energyDelta -= 1;
    }
    const newDuration = status.duration - 1;
    if (newDuration > 0) {
      next.push({ ...status, duration: newDuration });
    }
  }

  if (hpDelta !== 0) {
    player.hp = Math.min(player.maxHp, Math.max(0, player.hp + hpDelta));
    local.push({
      id: randomUUID(),
      text: hpDelta > 0 ? `Regenera ${hpDelta} HP.` : `Sofre ${Math.abs(hpDelta)} por efeitos.`,
      ts: Date.now(),
      type: "info",
    });
  }
  if (energyDelta !== 0) {
    player.energy = Math.min(player.maxEnergy, Math.max(0, player.energy + energyDelta));
    local.push({
      id: randomUUID(),
      text:
        energyDelta > 0
          ? `Recupera ${energyDelta} de energia.`
          : `Perde ${Math.abs(energyDelta)} de energia.`,
      ts: Date.now(),
      type: "info",
    });
  }

  player.statusEffects = next;
};

const AWAKENED_EFFECTS: AwakenedEffect[] = [
  {
    itemMatch: "arpão curto",
    originId: "mitica",
    affinityId: "mar",
    bonusDamage: 5,
    text: "A maré responde ao arpão.",
  },
  {
    itemMatch: "estilhaço cintilante",
    originId: "forja",
    affinityId: "pressao",
    bonusDamage: 4,
    bonusCrit: 6,
    text: "O estilhaço aquece e amplifica o golpe.",
  },
  {
    itemMatch: "tomo partido",
    originId: "arcana",
    affinityId: "sombra",
    bonusDamage: 3,
    text: "Sombras ecoam das páginas.",
  },
  {
    itemMatch: "pelagem rija",
    originId: "nocturna",
    affinityId: "feral",
    bonusDamage: 3,
    text: "Instinto feral desperto.",
  },
];

const getAwakenedBonus = (player: PlayerRecord): { dmg: number; crit: number; text?: string } => {
  if (!player.affinityKnown) return { dmg: 0, crit: 0 };
  for (const effect of AWAKENED_EFFECTS) {
    const hasItem = player.inventory.some((item) =>
      normalizeText(item).includes(normalizeText(effect.itemMatch)),
    );
    if (!hasItem) continue;
    if (effect.originId && effect.originId !== player.origin.id) continue;
    if (effect.affinityId && effect.affinityId !== player.affinity.id) continue;
    return {
      dmg: effect.bonusDamage ?? 0,
      crit: effect.bonusCrit ?? 0,
      text: effect.text,
    };
  }
  return { dmg: 0, crit: 0 };
};

const MONSTER_DEBUFFS: Record<
  string,
  { stat: "bleed" | "burn"; magnitude: number; duration: number; name: string }
> = {
  "Lobo Sombrio": { stat: "bleed", magnitude: 3, duration: 2, name: "Mordida" },
  "Corsário das Profundezas": { stat: "bleed", magnitude: 2, duration: 3, name: "Corrente Serrilhada" },
  "Golem de Estilhaços": { stat: "burn", magnitude: 2, duration: 2, name: "Cacos Incandescentes" },
  "Eco Primordial": { stat: "bleed", magnitude: 2, duration: 2, name: "Eco Cortante" },
};

const ITEM_PRICE: Record<string, number> = {
  "moeda de bronze": 2,
  "pequena runa": 4,
  "pelagem rija": 5,
  "presa trincada": 4,
  "tomo partido": 6,
  "tinta esmaecida": 3,
  "placa enferrujada": 5,
  "rebite pesado": 4,
  "arpão curto": 7,
  "gabarito de corda": 3,
  "estilhaço cintilante": 6,
  "areia cristalizada": 4,
  "fragmento de eco": 8,
  "lente rachada": 5,
  "erva curativa": 3,
  "flecha envenenada": 4,
  "pergaminho de faísca": 6,
  "fragmento de vidro": 2,
  "barril de pólvora": 6,
  "tocha curta": 3,
  "anzol amaldiçoado": 5,
  "corda reforçada": 3,
  "núcleo instável": 5,
  "pedaço de meteoro": 7,
  "poção de vigor": 6,
  "talismã rachado": 4,
};

const findItemPrice = (itemName: string): number | null => {
  const normalized = normalizeText(itemName);
  const match = Object.entries(ITEM_PRICE).find(
    ([key]) => normalizeText(key) === normalized,
  );
  if (match) return match[1];

  if (normalized.includes("essencia-fundida")) return 10;
  if (normalized.startsWith("essencia-")) return 6;
  return null;
};

const pushEvent = (
  store: GameStore,
  text: string,
  type: EventKind,
  roomId?: string,
): GameEvent => {
  const event: GameEvent = {
    id: randomUUID(),
    text,
    ts: Date.now(),
    type,
    roomId,
  };

  store.log.push(event);
  if (store.log.length > LOG_LIMIT) {
    store.log.splice(0, store.log.length - LOG_LIMIT);
  }

  return event;
};

const toPlayerView = (player: PlayerRecord): PlayerView => ({
  id: player.id,
  name: player.name,
  roomId: player.roomId,
  hp: player.hp,
  maxHp: player.maxHp,
  energy: player.energy,
  maxEnergy: player.maxEnergy,
  score: player.score,
  gold: player.gold,
  inventory: [...player.inventory],
  inventoryLimit: INVENTORY_LIMIT,
  isAlive: player.isAlive,
  origin: { id: player.origin.id, name: player.origin.name, description: player.origin.description },
  tendency: player.tendency,
  affinityKnown: player.affinityKnown,
  attributes: player.attributes,
  statusEffects: player.statusEffects,
  formation: player.formation,
  skills: (player.skillsKnown ?? []).map((id) => {
    const skill = skillById(id);
    return {
      id,
      name: skill?.name ?? id,
      kind: (skill?.kind as any) ?? "active",
      equipped: (player.skillBar ?? []).includes(id) || (player.passiveBar ?? []).includes(id),
      cooldown: player.skillCooldowns?.[id] ?? 0,
    };
  }),
});

const skillListEvent = (player: PlayerRecord, localEvents: GameEvent[]) => {
  const skills = player.skillsKnown ?? [];
  if (!skills.length) {
    localEvents.push({
      id: randomUUID(),
      text: "Nenhuma habilidade conhecida.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const lines = skills.map((id) => {
    const s = skillById(id);
    const equipped = (player.skillBar ?? []).includes(id) || (player.passiveBar ?? []).includes(id);
    const cd = player.skillCooldowns?.[id] ?? 0;
    return `${s?.name ?? id} [${s?.kind ?? "?"}]${equipped ? " (equipada)" : ""}${cd > 0 ? ` CD:${cd}` : ""}`;
  });
  localEvents.push({
    id: randomUUID(),
    text: `Skills: ${lines.join(" | ")}`,
    ts: Date.now(),
    type: "info",
  });
};

export const loginOrCreate = async (
  email: string,
  password: string,
  name: string,
  originId?: OriginId,
  tendency?: Tendency,
): Promise<GameSnapshot & { error?: string }> => {
  const store = await getStore();
  cleanupIdle(store);

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password.trim()) {
    return {
      ...joinPlayer(name, undefined, originId, tendency),
      error: "Email e senha são obrigatórios.",
    };
  }

  const account = store.accounts[normalizedEmail];
  const hashed = hashPassword(password.trim());

  if (account) {
    if (account.passwordHash !== hashed) {
      return {
        ...(await joinPlayer(name, undefined, originId, tendency)),
        error: "Senha incorreta para esta conta.",
      };
    }
    return joinPlayer(name, account.playerId, originId, tendency);
  }

  const playerId = randomUUID();
  store.accounts[normalizedEmail] = { email: normalizedEmail, passwordHash: hashed, playerId };
  const snapshot = await joinPlayer(name, playerId, originId, tendency);
  await persistStore(store);
  return snapshot;
};

const buildScoreboard = (store: GameStore): ScoreEntry[] =>
  Object.values(store.players)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((p) => ({ id: p.id, name: p.name, score: p.score }));

const buildRoomView = (store: GameStore, player: PlayerRecord): RoomView => {
  const room = store.rooms[player.roomId] ?? store.rooms["praca"];
  const exits = Object.entries(room.exits).map(([direction, to]) => ({
    direction,
    to: store.rooms[to]?.name ?? to,
  }));

  const occupants = Object.values(store.players)
    .filter((p) => p.roomId === room.id && p.id !== player.id && p.isAlive)
    .map((p) => ({ id: p.id, name: p.name }));

  const ownerName = room.ownerId ? store.players[room.ownerId]?.name : undefined;

  return {
    id: room.id,
    name: room.name,
    description: room.description,
    exits,
    items: [...room.items],
    monsters: (room.monsters ?? []).map((m) => ({ id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp })),
    occupants,
    claimable: room.claimable,
    ownerId: room.ownerId,
    ownerName,
    vaultSize: room.vaultSize,
    vaultCount: room.vault?.length ?? 0,
    danger: room.danger,
    biome: room.biome,
    siteType: room.siteType,
    buildCost: room.buildCost,
  };
};

const packSnapshot = (
  store: GameStore,
  player: PlayerRecord,
  events: GameEvent[],
): GameSnapshot => ({
  player: toPlayerView(player),
  room: buildRoomView(store, player),
  world: Object.values(store.rooms).map((room) => ({
    id: room.id,
    name: room.name,
    exits: Object.entries(room.exits).map(([direction, to]) => ({ direction, to })),
  })),
  scoreboard: buildScoreboard(store),
  events,
  now: Date.now(),
});

const ensureAlive = (
  store: GameStore,
  player: PlayerRecord,
  localEvents: GameEvent[],
): boolean => {
  if (player.isAlive) return true;

  localEvents.push({
    id: randomUUID(),
    text: "Você está desacordado. Use 'respawn' ou 'renascer' para voltar a luta.",
    ts: Date.now(),
    type: "info",
  });
  return false;
};

const cleanupIdle = (store: GameStore) => {
  const now = Date.now();
  for (const [id, player] of Object.entries(store.players)) {
    if (now - player.lastActive > INACTIVITY_TIMEOUT) {
      delete store.players[id];
      pushEvent(store, `${player.name} desaparece nas sombras (inatividade).`, "system", player.roomId);
    }
  }
};

const movePlayer = (
  store: GameStore,
  player: PlayerRecord,
  direction: string,
  localEvents: GameEvent[],
) => {
  const room = store.rooms[player.roomId];
  const targetId = room.exits[direction];

  if (!targetId) {
    localEvents.push({
      id: randomUUID(),
      text: "Não ha passagem nessa dire??o.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const targetRoom = store.rooms[targetId];
  player.roomId = targetRoom.id;
  player.energy = Math.max(0, player.energy - 2);
  player.lastActive = Date.now();
  if (!targetRoom.monsters || targetRoom.monsters.length === 0) {
    spawnMonstersForRoom(targetRoom);
  }

  const event = pushEvent(
    store,
    `${player.name} se moveu para ${targetRoom.name} (${direction}).`,
    "move",
    targetRoom.id,
  );
  localEvents.push(event);
};

const lookAround = (store: GameStore, player: PlayerRecord, localEvents: GameEvent[]) => {
  const roomView = buildRoomView(store, player);
  const exits = roomView.exits.map((exit) => exit.direction).join(", ") || "nenhuma";
  const occupants =
    roomView.occupants.length > 0
      ? roomView.occupants.map((o) => o.name).join(", ")
      : "ninguem alem de voc?";

  const text = `${roomView.name}: ${roomView.description} Saidas: ${exits}. Jogadores aqui: ${occupants}.`;
  localEvents.push({
    id: randomUUID(),
    text,
    ts: Date.now(),
    type: "info",
    roomId: roomView.id,
  });

  if (roomView.id === "caverna" && !player.affinityKnown) {
    localEvents.push({
      id: randomUUID(),
      text: "Há um altar antigo aqui. Talvez 'altar' ou 'pray' possa revelar algo.",
      ts: Date.now(),
      type: "system",
    });
  }
};

const claimRoom = (store: GameStore, player: PlayerRecord, localEvents: GameEvent[]) => {
  const room = store.rooms[player.roomId];
  if (!room.claimable) {
    localEvents.push({
      id: randomUUID(),
      text: "Esta area não pode ser dominada.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if ((room.danger ?? 1) > 3) {
    localEvents.push({
      id: randomUUID(),
      text: "Esta área é instável demais para montar base (perigo alto).",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (room.ownerId && room.ownerId === player.id) {
    localEvents.push({
      id: randomUUID(),
      text: "Você já é o dono deste local.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (room.ownerId && room.ownerId !== player.id) {
    localEvents.push({
      id: randomUUID(),
      text: "Alguém já domina esta área. Enfrente ou negocie antes de tomar.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const cost = room.buildCost ?? buildCostForRoom(room);
  const goldCost = cost?.gold ?? Math.max(5, ((room.danger ?? 1) * 3) | 0);
  const energyCost = 4;
  const neededItems = cost?.items ?? [];
  const missing = neededItems.filter(
    (item) => !player.inventory.some((inv) => normalizeText(inv) === normalizeText(item)),
  );
  if (missing.length) {
    localEvents.push({
      id: randomUUID(),
      text: `Falta suprimentos para dominar: ${missing.join(", ")}.`,
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (player.gold < goldCost) {
    localEvents.push({
      id: randomUUID(),
      text: `Você precisa de ${goldCost} ouro para reivindicar.`,
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (player.energy < energyCost) {
    localEvents.push({
      id: randomUUID(),
      text: "Energia insuficiente para canalizar a reivindicação.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  player.gold -= goldCost;
  player.energy = Math.max(0, player.energy - energyCost);
  if (neededItems.length) {
    for (const req of neededItems) {
      const idx = player.inventory.findIndex((inv) => normalizeText(inv) === normalizeText(req));
      if (idx !== -1) {
        player.inventory.splice(idx, 1);
      }
    }
  }
  room.ownerId = player.id;
  ensureVault(room);
  if (!room.vaultSize) room.vaultSize = 4;

  localEvents.push({
    id: randomUUID(),
    text: `${player.name} domina ${room.name} como base. Custo pago: ${goldCost} ouro${neededItems.length ? ` + ${neededItems.join(", ")}` : ""}. Cofre disponível (${room.vaultSize} slots).`,
    ts: Date.now(),
    type: "system",
  });
};

const unclaimRoom = (store: GameStore, player: PlayerRecord, localEvents: GameEvent[]) => {
  const room = store.rooms[player.roomId];
  if (room.ownerId !== player.id) {
    localEvents.push({
      id: randomUUID(),
      text: "Você não é o dono desta área.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  // drop vault items no chão
  if (room.vault?.length) {
    room.items.push(...room.vault);
  }
  room.vault = [];
  room.ownerId = undefined;
  localEvents.push({
    id: randomUUID(),
    text: `${player.name} abandona ${room.name}. Cofre esvaziado no chão.`,
    ts: Date.now(),
    type: "system",
  });
};

const vaultCommand = (store: GameStore, player: PlayerRecord, arg: string, localEvents: GameEvent[]) => {
  const room = store.rooms[player.roomId];
  if (room.ownerId !== player.id) {
    localEvents.push({
      id: randomUUID(),
      text: "Apenas o dono pode acessar o cofre.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (!room.vaultSize || room.vaultSize <= 0) {
    localEvents.push({
      id: randomUUID(),
      text: "Não há cofre disponível nesta sala.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  ensureVault(room);
  const [action, ...rest] = arg.trim().split(/\s+/);
  const itemName = rest.join(" ");
  if (!action) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: vault deposit <item> ou vault take <item>.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (action === "deposit" || action === "guardar" || action === "put") {
    if (!itemName) {
      localEvents.push({
        id: randomUUID(),
        text: "Informe o item para guardar.",
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    if (room.vault!.length >= room.vaultSize) {
      localEvents.push({
        id: randomUUID(),
        text: "Cofre cheio. Melhore ou esvazie slots.",
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    const idx = player.inventory.findIndex(
      (entry) => normalizeText(entry) === normalizeText(itemName),
    );
    if (idx === -1) {
      localEvents.push({
        id: randomUUID(),
        text: "Você não possui esse item.",
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    const [item] = player.inventory.splice(idx, 1);
    room.vault!.push(item);
    localEvents.push({
      id: randomUUID(),
      text: `${item} guardado no cofre (${room.vault!.length}/${room.vaultSize}).`,
      ts: Date.now(),
      type: "loot",
    });
    return;
  }
  if (action === "take" || action === "pegar" || action === "get") {
    if (!itemName) {
      localEvents.push({
        id: randomUUID(),
        text: "Informe o item para retirar.",
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    if (player.inventory.length >= INVENTORY_LIMIT) {
      localEvents.push({
        id: randomUUID(),
        text: "Inventário cheio. Libere espaço antes de retirar do cofre.",
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    const idx = room.vault!.findIndex(
      (entry) => normalizeText(entry) === normalizeText(itemName),
    );
    if (idx === -1) {
      localEvents.push({
        id: randomUUID(),
        text: "Item não está no cofre.",
        ts: Date.now(),
        type: "info",
      });
      return;
    }
    const [item] = room.vault!.splice(idx, 1);
    player.inventory.push(item);
    localEvents.push({
      id: randomUUID(),
      text: `${item} retirado do cofre.`,
      ts: Date.now(),
      type: "loot",
    });
    return;
  }

  localEvents.push({
    id: randomUUID(),
    text: "Use: vault deposit <item> ou vault take <item>.",
    ts: Date.now(),
    type: "info",
  });
};

const takeItem = (
  store: GameStore,
  player: PlayerRecord,
  itemName: string,
  localEvents: GameEvent[],
) => {
  const room = store.rooms[player.roomId];
  const index = room.items.findIndex(
    (item) => normalizeText(item) === normalizeText(itemName),
  );
  if (index === -1) {
    localEvents.push({
      id: randomUUID(),
      text: "Esse item não está aqui.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const [item] = room.items.splice(index, 1);
  if (player.inventory.length >= INVENTORY_LIMIT) {
    localEvents.push({
      id: randomUUID(),
      text: "Inventario cheio. Descarte ou venda algo antes de pegar.",
      ts: Date.now(),
      type: "info",
    });
    room.items.splice(index, 0, item);
    return;
  }

  player.inventory.push(item);
  player.score += 3;
  const event = pushEvent(store, `${player.name} pegou ${item}.`, "loot", room.id);
  localEvents.push(event);
};

const dropItem = (
  store: GameStore,
  player: PlayerRecord,
  itemName: string,
  localEvents: GameEvent[],
) => {
  const idx = player.inventory.findIndex(
    (item) => normalizeText(item) === normalizeText(itemName),
  );
  if (idx === -1) {
    localEvents.push({
      id: randomUUID(),
      text: "Você não possui esse item.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const [item] = player.inventory.splice(idx, 1);
  const room = store.rooms[player.roomId];
  room.items.push(item);

  const event = pushEvent(store, `${player.name} largou ${item}.`, "system", room.id);
  localEvents.push(event);
};

const sellItem = (
  store: GameStore,
  player: PlayerRecord,
  itemName: string,
  localEvents: GameEvent[],
) => {
  if (!itemName.trim()) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: sell <item> ou vender <item>.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const idx = player.inventory.findIndex(
    (entry) => normalizeText(entry) === normalizeText(itemName),
  );
  if (idx === -1) {
    localEvents.push({
      id: randomUUID(),
      text: "Você não possui esse item.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const item = player.inventory[idx];
  const price = findItemPrice(item);
  if (price === null) {
    localEvents.push({
      id: randomUUID(),
      text: "Ninguem oferece preco por isso agora.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  player.inventory.splice(idx, 1);
  player.gold += price;
  player.score += Math.max(1, Math.round(price / 2));

  const event = pushEvent(
    store,
    `${player.name} vendeu ${item} por ${price} ouro.`,
    "loot",
    player.roomId,
  );
  localEvents.push(event);
};

function equipKnownSkill(player: PlayerRecord, skillId: string) {
  const skill = skillById(skillId);
  if (!skill) return;
  if (skill.kind === "active") {
    const bar = player.skillBar ?? [];
    if (!bar.includes(skillId) && bar.length < ACTIVE_SKILL_SLOTS) {
      bar.push(skillId);
      player.skillBar = bar;
    }
  } else {
    const bar = player.passiveBar ?? [];
    if (!bar.includes(skillId) && bar.length < PASSIVE_SKILL_SLOTS) {
      bar.push(skillId);
      player.passiveBar = bar;
    }
  }
}

function learnSkill(player: PlayerRecord, skillId: string, localEvents: GameEvent[]) {
  if (!player.skillsKnown) player.skillsKnown = [];
  if (!player.skillBar) player.skillBar = [];
  if (!player.passiveBar) player.passiveBar = [];
  if (!player.skillCooldowns) player.skillCooldowns = {};
  if (!player.skillsKnown.includes(skillId)) {
    player.skillsKnown.push(skillId);
    equipKnownSkill(player, skillId);
    localEvents.push({
      id: randomUUID(),
      text: `Nova habilidade aprendida: ${skillById(skillId)?.name ?? skillId}.`,
      ts: Date.now(),
      type: "system",
    });
  } else {
    localEvents.push({
      id: randomUUID(),
      text: `Você já conhece ${skillById(skillId)?.name ?? skillId}.`,
      ts: Date.now(),
      type: "info",
    });
  }
}

const consumeItem = (
  store: GameStore,
  player: PlayerRecord,
  itemName: string,
  localEvents: GameEvent[],
) => {
  const idx = player.inventory.findIndex(
    (item) => normalizeText(item) === normalizeText(itemName),
  );
  if (idx === -1) {
    localEvents.push({
      id: randomUUID(),
      text: "Item não encontrado no inventario.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const item = player.inventory[idx];
  player.inventory.splice(idx, 1);

  const lower = normalizeText(item);

  const skillDrop = Object.entries(SKILL_DROPS).find(([key]) => normalizeText(key) === lower)?.[1];
  if (skillDrop) {
    learnSkill(player, skillDrop, localEvents);
    return;
  }

  if (lower.includes("pocao")) {
    const heal = roll(10, 22);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    player.energy = Math.min(player.maxEnergy, player.energy + 4);
    localEvents.push({
      id: randomUUID(),
      text: `Você usa ${item} e recupera ${heal} de vida.`,
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  if (lower.includes("nucleo")) {
    player.energy = Math.min(player.maxEnergy, player.energy + 8);
    player.score += 4;
    localEvents.push({
      id: randomUUID(),
      text: `A energia do ${item} vibra. Energia restaurada!`,
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  if (lower.includes("estilhaco") || lower.includes("fragmento")) {
    const buff = roll(2, 5);
    player.energy = Math.min(player.maxEnergy, player.energy + buff);
    player.score += 2;
    localEvents.push({
      id: randomUUID(),
      text: `${item} se dissolve e pulsa em você (+${buff} energia).`,
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  if (lower.includes("placa") || lower.includes("rebite")) {
    addStatus(
      player,
      { name: "Fortify", kind: "buff", stat: "defense", magnitude: 3, duration: 3 },
      localEvents,
    );
    return;
  }

  if (lower.includes("arpao")) {
    addStatus(
      player,
      { name: "Focus Ranged", kind: "buff", stat: "precision", magnitude: 3, duration: 3 },
      localEvents,
    );
    return;
  }

  localEvents.push({
    id: randomUUID(),
    text: `${item} não teve efeito visivel... por enquanto.`,
    ts: Date.now(),
    type: "info",
  });
};

const fuseEssences = (
  player: PlayerRecord,
  args: string,
  localEvents: GameEvent[],
) => {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: fuse <essenciaA> <essenciaB>.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const [a, b] = parts;
  const findItem = (needle: string) =>
    player.inventory.findIndex((item) => normalizeText(item).includes(normalizeText(needle)));

  const idxA = findItem(a);
  const idxB = findItem(b);
  if (idxA === -1 || idxB === -1 || idxA === idxB) {
    localEvents.push({
      id: randomUUID(),
      text: "Essências não encontradas ou iguais.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const futureSize = player.inventory.length - 1;
  if (futureSize > INVENTORY_LIMIT) {
    localEvents.push({
      id: randomUUID(),
      text: "Inventario no limite. Descarte ou venda algo antes de fundir.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const itemA = player.inventory[idxA];
  const itemB = player.inventory[idxB];
  player.inventory.splice(Math.max(idxA, idxB), 1);
  player.inventory.splice(Math.min(idxA, idxB), 1);

  const fused = `essencia-fundida (${itemA} + ${itemB})`;
  player.inventory.push(fused);
  player.score += 6;
  localEvents.push({
    id: randomUUID(),
    text: `As essências reagem e formam ${fused}.`,
    ts: Date.now(),
    type: "loot",
  });
};

const setFormation = (player: PlayerRecord, arg: string, localEvents: GameEvent[]) => {
  const map: Record<string, Formation> = {
    vanguarda: "vanguarda",
    frente: "vanguarda",
    front: "vanguarda",
    tanque: "vanguarda",
    retaguarda: "retaguarda",
    backline: "retaguarda",
    suporte: "retaguarda",
    back: "retaguarda",
    apoio: "retaguarda",
    furtivo: "furtivo",
    stealth: "furtivo",
    flanco: "furtivo",
    sentinela: "sentinela",
    guardiao: "sentinela",
    parede: "sentinela",
    artilharia: "artilharia",
    range: "artilharia",
    longe: "artilharia",
  };

  const normalized = normalizeText(arg);
  const target = map[normalized];
  if (!target) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: formation <vanguarda|retaguarda|furtivo|sentinela|artilharia> (ou frente/back/flanco).",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  player.formation = target;
  const mods = FORMATION_MODS[target];
  localEvents.push({
    id: randomUUID(),
    text: `Formacao ajustada para ${mods.label}. (acerto ${mods.hit >= 0 ? "+" : ""}${mods.hit}, crit ${mods.crit >= 0 ? "+" : ""}${mods.crit}, mitigacao ${mods.mitigation >= 0 ? "+" : ""}${Math.round(mods.mitigation * 100)}%)`,
    ts: Date.now(),
    type: "info",
  });
};

const selectMonster = (room: Room, arg?: string): Monster | undefined => {
  if (!room.monsters || room.monsters.length === 0) return undefined;
  if (!arg) return room.monsters[0];
  const normalized = normalizeText(arg);
  const idx = parseInt(arg, 10);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= room.monsters.length) {
    return room.monsters[idx - 1];
  }
  return room.monsters.find((m) => normalizeText(m.name).includes(normalized));
};

const attack = (
  store: GameStore,
  player: PlayerRecord,
  arg: string,
  localEvents: GameEvent[],
) => {
  const room = store.rooms[player.roomId];
  const monsters = room.monsters ?? [];
  const listMonsters = () =>
    monsters.map((m, idx) => `${idx + 1}. ${m.name} (${m.hp}/${m.maxHp ?? m.hp} HP)`).join(' | ');

  if (monsters.length === 0) {
    localEvents.push({
      id: randomUUID(),
      text: "Nenhum inimigo na sala. Use 'look' ou mova-se para outra sala.",
      ts: Date.now(),
      type: 'info',
    });
    return;
  }

  if (!arg) {
    localEvents.push({
      id: randomUUID(),
      text: `Escolha um alvo: ${listMonsters()} (use 'attack <id|nome>').`,
      ts: Date.now(),
      type: 'info',
    });
    return;
  }

  const target = selectMonster(room, arg);
  if (!target) {
    localEvents.push({
      id: randomUUID(),
      text: `Alvo nao encontrado. Alvos validos: ${listMonsters()}.`,
      ts: Date.now(),
      type: 'info',
    });
    return;
  }

  if (player.energy <= 0) {
    localEvents.push({
      id: randomUUID(),
      text: "Voce esta exausto. Use 'rest' ou 'descansar'.",
      ts: Date.now(),
      type: 'info',
    });
    return;
  }

  const energyCost = Math.max(2, 5 - Math.floor(player.attributes.agility / 6));
  if (player.energy < energyCost) {
    localEvents.push({
      id: randomUUID(),
      text: 'Energia insuficiente para atacar. Descanse.',
      ts: Date.now(),
      type: 'info',
    });
    return;
  }

  const buffPrecision = player.statusEffects
    .filter((s) => s.kind === 'buff' && s.stat === 'precision')
    .reduce((acc, s) => acc + s.magnitude, 0);
  const buffMight = player.statusEffects
    .filter((s) => s.kind === 'buff' && s.stat === 'might')
    .reduce((acc, s) => acc + s.magnitude, 0);
  const passiveBonus = getPassiveBonus(player);
  const awakened = getAwakenedBonus(player);
  const formationMods = FORMATION_MODS[player.formation] ?? FORMATION_MODS.vanguarda;

  const hitChance = Math.max(
    35,
    Math.min(
      95,
      65 +
        (player.attributes.precision + buffPrecision + passiveBonus.precision) * 2 -
        Math.floor(player.attributes.agility / 5) +
        awakened.crit +
        passiveBonus.crit +
        formationMods.hit,
    ),
  );
  const rollHit = Math.random() * 100;
  if (rollHit > hitChance) {
    player.energy = Math.max(0, player.energy - Math.max(1, Math.floor(energyCost / 2)));
    localEvents.push({
      id: randomUUID(),
      text: `${player.name} erra ${target.name}.`,
      ts: Date.now(),
      type: 'combat',
    });
    return;
  }

  const critChance = Math.min(
    40,
    player.attributes.crit +
      (player.attributes.precision + buffPrecision + passiveBonus.precision) * 0.6 +
      awakened.crit +
      passiveBonus.crit +
      formationMods.crit,
  );
  const isCrit = Math.random() * 100 < critChance;
  const essenceBonus =
    player.affinityKnown &&
    player.inventory.some((item) => normalizeText(item).includes(normalizeText(player.affinity.id)))
      ? 4
      : 0;
  const baseDamage =
    roll(6, 10) +
    Math.round((player.attributes.might + buffMight) * 0.8) +
    Math.round(player.attributes.will * 0.3) +
    essenceBonus +
    awakened.dmg;
  const playerHit = Math.max(
    3,
    Math.round(baseDamage * (1 + formationMods.dmg) * (isCrit ? 1.4 : 1)),
  );

  target.hp -= playerHit;
  player.energy = Math.max(0, player.energy - energyCost);

  const attackEvent = pushEvent(
    store,
    `${player.name} ${isCrit ? 'crita' : 'atinge'} ${target.name} (-${playerHit} HP).`,
    'combat',
    room.id,
  );
  localEvents.push(attackEvent);
  if (awakened.text) {
    localEvents.push({
      id: randomUUID(),
      text: awakened.text,
      ts: Date.now(),
      type: 'info',
    });
  }

  if (target.hp <= 0) {
    const reward = target.reward;
    player.score += reward;
    player.hp = Math.min(player.maxHp, player.hp + 6);
  const monsterAffinity = (MONSTER_AFFINITY[target.name] as Affinity | undefined) ?? player.affinity;
  const essence = createEssenceItem(monsterAffinity);
  room.items.push(essence);
  const lootTable = COMMON_LOOT[target.name];
  if (lootTable && Math.random() < 0.65) {
      const loot = lootTable[roll(0, lootTable.length - 1)];
      room.items.push(loot);
    }
    const defeatEvent = pushEvent(
      store,
      `${player.name} derrotou ${target.name}! (+${reward} pontos)`,
      'combat',
      room.id,
    );
    localEvents.push(defeatEvent);
    localEvents.push(
      pushEvent(
        store,
        `${target.name} deixou cair ${essence}.`,
        'loot',
        room.id,
      ),
    );
    const tags = MONSTER_TAGS[target.name] || target.tags || [];
    awardTagProgress(player, tags, localEvents);
    room.monsters = room.monsters.filter((m) => m.id !== target.id);
    return;
  }

  const mitigationBase = Math.round(player.attributes.defense * 0.6 + player.attributes.resistance * 0.3);
  const mitigation = Math.round(mitigationBase * (1 + formationMods.mitigation));
  const retaliation = Math.max(
    2,
    target.attack + roll(-2, 3) - Math.round(mitigation * 0.2),
  );
  player.hp -= retaliation;

  const retaliationEvent = pushEvent(
    store,
    `${target.name} contra-ataca ${player.name} (-${retaliation} HP).`,
    'combat',
    room.id,
  );
  localEvents.push(retaliationEvent);

  const debuff = MONSTER_DEBUFFS[target.name];
  if (debuff) {
    addStatus(
      player,
      { name: debuff.name, kind: 'debuff', stat: debuff.stat, magnitude: debuff.magnitude, duration: debuff.duration },
      localEvents,
    );
  }

  if (player.hp <= 0) {
    player.isAlive = false;
    player.hp = 0;
    pushEvent(store, `${player.name} foi nocauteado!`, 'combat', room.id);
  }
};

function castSkill(
  store: GameStore,
  player: PlayerRecord,
  arg: string,
  localEvents: GameEvent[],
) {
  const [first, ...rest] = arg.trim().split(/\s+/);
  if (!first) {
    localEvents.push({
      id: randomUUID(),
      text: "Use: skill <nome|id> [alvo|all].",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const skill =
    skillByName(first) ??
    skillById(first) ??
    skillByName(rest.join(" "));
  if (!skill) {
    localEvents.push({
      id: randomUUID(),
      text: "Habilidade desconhecida.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (!player.skillsKnown?.includes(skill.id)) {
    localEvents.push({
      id: randomUUID(),
      text: "Você não conhece essa habilidade.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (skill.kind !== "active") {
    localEvents.push({
      id: randomUUID(),
      text: "Essa habilidade é passiva.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const bar = player.skillBar ?? [];
  if (!bar.includes(skill.id)) {
    localEvents.push({
      id: randomUUID(),
      text: "Equipe a habilidade primeiro (slots limitados).",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (!player.skillCooldowns) player.skillCooldowns = {};
  if ((player.skillCooldowns[skill.id] ?? 0) > 0) {
    localEvents.push({
      id: randomUUID(),
      text: `${skill.name} está em recarga (${player.skillCooldowns[skill.id]}).`,
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const room = store.rooms[player.roomId];
  const targets: Monster[] = [];
  if (skill.target === "aoe") {
    targets.push(...(room.monsters ?? []));
  } else if (skill.target === "single") {
    const targetArg = rest.join(" ");
    const target = selectMonster(room, targetArg) ?? room.monsters?.[0];
    if (target) targets.push(target);
  }
  if (skill.target !== "self" && targets.length === 0) {
    localEvents.push({
      id: randomUUID(),
      text: "Nenhum alvo para a habilidade.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  const energyCost = skill.cost?.energy ?? 0;
  const hpCost = skill.cost?.hp ?? 0;
  if (player.energy < energyCost) {
    localEvents.push({
      id: randomUUID(),
      text: "Energia insuficiente.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  if (player.hp <= hpCost) {
    localEvents.push({
      id: randomUUID(),
      text: "HP insuficiente para usar.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  player.energy = Math.max(0, player.energy - energyCost);
  player.hp = Math.max(1, player.hp - hpCost);
  if (skill.cooldown) player.skillCooldowns[skill.id] = skill.cooldown;

  const passiveBonus = getPassiveBonus(player);
  const baseDamage = skill.base ?? 0;
  const scale =
    (skill.scaling?.might ?? 0) * player.attributes.might +
    (skill.scaling?.precision ?? 0) * (player.attributes.precision + passiveBonus.precision) +
    (skill.scaling?.will ?? 0) * player.attributes.will;
  const totalBase = Math.max(0, Math.round(baseDamage + scale));

  if (skill.target === "self") {
    if (skill.status) {
      addStatus(
        player,
        { name: skill.name, kind: "buff", stat: skill.status.stat as any, magnitude: skill.status.magnitude, duration: skill.status.duration },
        localEvents,
      );
    }
    localEvents.push({
      id: randomUUID(),
      text: `${player.name} ativa ${skill.name}.`,
      ts: Date.now(),
      type: "system",
    });
    return;
  }

  for (const target of targets) {
    const dmg = Math.max(1, totalBase + roll(-3, 3));
    target.hp -= dmg;
    localEvents.push(
      pushEvent(
        store,
        `${player.name} usa ${skill.name} em ${target.name} (-${dmg} HP).`,
        "combat",
        room.id,
      ),
    );
    if (skill.status) {
      localEvents.push({
        id: randomUUID(),
        text: `${target.name} sofre efeito ${skill.status.stat} (${skill.status.magnitude}/${skill.status.duration}).`,
        ts: Date.now(),
        type: "combat",
      });
    }
    if (target.hp <= 0) {
      const reward = target.reward;
      player.score += reward;
      player.hp = Math.min(player.maxHp, player.hp + 4);
      const monsterAffinity = (MONSTER_AFFINITY[target.name] as Affinity | undefined) ?? player.affinity;
      const essence = createEssenceItem(monsterAffinity);
      room.items.push(essence);
      const lootTable = COMMON_LOOT[target.name];
      if (lootTable && Math.random() < 0.65) {
        const loot = lootTable[roll(0, lootTable.length - 1)];
        room.items.push(loot);
      }
      localEvents.push(
        pushEvent(
          store,
          `${player.name} derrotou ${target.name}! (+${reward} pontos)`,
          "combat",
          room.id,
        ),
      );
      room.monsters = room.monsters.filter((m) => m.id !== target.id);
    }
  }
}


const restAction = (player: PlayerRecord, localEvents: GameEvent[]) => {
  const heal = roll(4, 10);
  const energy = roll(4, 8);
  player.hp = Math.min(player.maxHp, player.hp + heal);
  player.energy = Math.min(player.maxEnergy, player.energy + energy);
  player.lastActive = Date.now();

  localEvents.push({
    id: randomUUID(),
    text: `Você respira fundo e recupera ${heal} de vida e ${energy} de energia.`,
    ts: Date.now(),
    type: "info",
  });

  tickStatus(player, localEvents);
};

const respawn = (store: GameStore, player: PlayerRecord, localEvents: GameEvent[]) => {
  player.roomId = "praca";
  player.hp = player.maxHp;
  player.energy = Math.min(player.maxEnergy, Math.round(player.maxEnergy * 0.8));
  player.isAlive = true;
  player.lastActive = Date.now();

  const event = pushEvent(store, `${player.name} retorna a Praca Central.`, "system", player.roomId);
  localEvents.push(event);
};

const say = (
  store: GameStore,
  player: PlayerRecord,
  phrase: string,
  localEvents: GameEvent[],
) => {
  if (!phrase.trim()) {
    localEvents.push({
      id: randomUUID(),
      text: "Fale algo apos 'say'.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const event = pushEvent(store, `${player.name}: ${phrase}`, "chat", player.roomId);
  localEvents.push(event);
};

const help = (localEvents: GameEvent[]) => {
  localEvents.push({
    id: randomUUID(),
    text: "Comandos: north/sul/leste/oeste (ou n/s/l/o), look, attack [alvo], rest, say <texto>, take <item>, drop <item>, sell <item>, use <item>, fuse <a> <b>, skill <id>, formation <vanguarda|retaguarda|furtivo|sentinela|artilharia>, claim/unclaim (custa ouro + sucatas), vault deposit/take, reveal/altar (afinidade na caverna), respawn.",
    ts: Date.now(),
    type: "info",
  });
};

const revealAffinity = (player: PlayerRecord, localEvents: GameEvent[], viaAltar?: boolean) => {
  if (player.affinityKnown) {
    localEvents.push({
      id: randomUUID(),
      text: "Sua afinidade ja desperta.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }
  player.affinityKnown = true;
  const source = viaAltar ? "Um altar murmura" : "Um sussurro antigo revela";
  localEvents.push({
    id: randomUUID(),
    text: `${source} sua afinidade: ${player.affinity.name}. Itens relacionados agora despertam.`,
    ts: Date.now(),
    type: "system",
  });
};

export const joinPlayer = async (
  name: string,
  preferredId?: string,
  originId?: OriginId,
  tendency?: Tendency,
): Promise<GameSnapshot> => {
  const store = await getStore();
  cleanupIdle(store);

  const playerId = preferredId ?? randomUUID();
  const playerName = clampName(name);
  let player = store.players[playerId];

  if (!player) {
    const origin = pickOrigin(originId);
    const affinity = pickAffinity(origin);
    const attributes = makeAttributes(origin, tendency);
    const vitals = deriveVitals(attributes);
    player = {
      id: playerId,
      name: playerName,
      roomId: "praca",
      hp: vitals.maxHp,
      maxHp: vitals.maxHp,
      energy: Math.round(vitals.maxEnergy * 0.8),
      maxEnergy: vitals.maxEnergy,
      score: 0,
      gold: 0,
      inventory: [],
      lastActive: Date.now(),
      isAlive: true,
      origin,
      tendency,
      affinity,
      attributes,
      affinityKnown: false,
      statusEffects: [],
      formation: "vanguarda",
      tagProgress: {},
      ...initSkills(),
      skillsKnown: STARTER_SKILLS.slice(),
      skillBar: STARTER_SKILLS.slice(0, ACTIVE_SKILL_SLOTS),
      passiveBar: [],
      skillCooldowns: {},
    };
    store.players[playerId] = player;
    const room = store.rooms[player.roomId];
    pushEvent(store, `${player.name} entrou na arena em ${room.name}.`, "system", room.id);
  } else {
    player.name = playerName;
    player.lastActive = Date.now();

    if (!player.origin) {
      const origin = pickOrigin(originId);
      player.origin = origin;
      player.affinity = pickAffinity(origin);
    }
    if (!player.attributes) {
      player.attributes = makeAttributes(player.origin, player.tendency);
    }
    if (!player.affinity) {
      player.affinity = pickAffinity(player.origin);
    }
    if (player.affinityKnown === undefined) {
      player.affinityKnown = false;
    }
    if (!player.tagProgress) {
      player.tagProgress = {};
    }
    if (!player.formation) {
      player.formation = "vanguarda";
    }
    if (!player.statusEffects) {
      player.statusEffects = [];
    }
    if (!player.skillsKnown) player.skillsKnown = [];
    if (!player.skillBar) player.skillBar = [];
    if (!player.passiveBar) player.passiveBar = [];
    if (!player.skillCooldowns) player.skillCooldowns = {};
    for (const starter of STARTER_SKILLS) {
      if (!player.skillsKnown.includes(starter)) player.skillsKnown.push(starter);
    }
    if (!player.skillBar.length) {
      player.skillBar = STARTER_SKILLS.slice(0, ACTIVE_SKILL_SLOTS);
    }
    const vitals = deriveVitals(player.attributes);
    if (!player.maxEnergy) {
      player.maxEnergy = vitals.maxEnergy;
    }
    if (!player.maxHp) {
      player.maxHp = vitals.maxHp;
    }
    if (player.gold === undefined) {
      player.gold = 0;
    }
    player.energy = Math.min(player.energy ?? player.maxEnergy, player.maxEnergy);
    player.hp = Math.min(player.hp ?? player.maxHp, player.maxHp);
  }

  const snapshot = packSnapshot(store, player, []);
  await persistStore(store);
  return snapshot;
};

export const getState = async (playerId: string, since?: number): Promise<GameSnapshot | null> => {
  const store = await getStore();
  cleanupIdle(store);
  const player = store.players[playerId];
  if (!player) return null;

  player.lastActive = Date.now();
  if (!player.formation) {
    player.formation = "vanguarda";
  }
  const events =
    since && Number.isFinite(since)
      ? store.log.filter((event) => event.ts > since)
      : [];

  return packSnapshot(store, player, events);
};

export const runCommand = async (
  playerId: string,
  rawCommand: string,
): Promise<GameSnapshot & { error?: string }> => {
  const store = await getStore();
  cleanupIdle(store);

  const player = store.players[playerId];
  if (!player) {
    return {
      player: {
        id: "missing",
        name: "Desconhecido",
        roomId: "",
        hp: 0,
        maxHp: 0,
        energy: 0,
        maxEnergy: 0,
        score: 0,
        gold: 0,
        inventory: [],
        inventoryLimit: INVENTORY_LIMIT,
        isAlive: false,
        origin: ORIGINS[0],
        affinityKnown: false,
        attributes: makeAttributes(ORIGINS[0]),
        formation: "vanguarda",
      } as unknown as PlayerView,
      room: {
        id: "",
        name: "Nenhum",
        description: "Jogador não encontrado.",
        exits: [],
        items: [],
        monsters: [],
        occupants: [],
      },
      world: Object.values(store.rooms).map((r) => ({
        id: r.id,
        name: r.name,
        exits: Object.entries(r.exits).map(([direction, to]) => ({ direction, to })),
      })),
      scoreboard: [],
      events: [],
      now: Date.now(),
      error: "Jogador não encontrado. Reentre na partida.",
    };
  }

  player.lastActive = Date.now();
  tickCooldowns(player);
  if (!player.formation) {
    player.formation = "vanguarda";
  }

  const input = rawCommand?.trim();
  const localEvents: GameEvent[] = [];

  if (!input) {
    localEvents.push({
      id: randomUUID(),
      text: "Digite um comando para agir.",
      ts: Date.now(),
      type: "info",
    });
    return packSnapshot(store, player, localEvents);
  }

  const [command, ...rest] = input.split(/\s+/);
  const arg = rest.join(" ").trim();
  const cmd = command.toLowerCase();

  tickStatus(player, localEvents);

  if (cmd === "help" || cmd === "ajuda" || cmd === "?") {
    help(localEvents);
    return packSnapshot(store, player, localEvents);
  }

  if ((cmd === "respawn" || cmd === "renascer") && !player.isAlive) {
    respawn(store, player, localEvents);
    return packSnapshot(store, player, localEvents);
  }

  if (!ensureAlive(store, player, localEvents)) {
    return packSnapshot(store, player, localEvents);
  }

  switch (cmd) {
    case "n":
    case "north":
    case "norte":
      movePlayer(store, player, "norte", localEvents);
      break;
    case "s":
    case "south":
    case "sul":
      movePlayer(store, player, "sul", localEvents);
      break;
    case "e":
    case "l":
    case "east":
    case "leste":
      movePlayer(store, player, "leste", localEvents);
      break;
    case "w":
    case "o":
    case "west":
    case "oeste":
      movePlayer(store, player, "oeste", localEvents);
      break;
    case "attack":
    case "atacar":
    case "fight":
      attack(store, player, arg, localEvents);
      break;
    case "look":
    case "olhar":
    case "scan":
      lookAround(store, player, localEvents);
      break;
    case "say":
    case "falar":
    case "dizer":
      say(store, player, arg, localEvents);
      break;
    case "rest":
    case "descansar":
      restAction(player, localEvents);
      break;
    case "take":
    case "pegar":
      takeItem(store, player, arg, localEvents);
      break;
    case "drop":
    case "largar":
      dropItem(store, player, arg, localEvents);
      break;
    case "sell":
    case "vender":
      sellItem(store, player, arg, localEvents);
      break;
    case "use":
    case "usar":
      consumeItem(store, player, arg, localEvents);
      break;
    case "fuse":
    case "fundir":
      fuseEssences(player, arg, localEvents);
      break;
    case "skill":
    case "cast":
      {
        const sub = normalizeText(arg.split(/\s+/)[0] ?? "");
        if (sub === "list") {
          skillListEvent(player, localEvents);
        } else if (sub === "equip") {
          equipSkillCommand(player, arg.replace(/^\s*equip\s+/i, ""), localEvents);
        } else if (sub === "unequip" || sub === "remove") {
          unequipSkillCommand(player, arg.replace(/^\s*(unequip|remove)\s+/i, ""), localEvents);
        } else {
          castSkill(store, player, arg, localEvents);
        }
      }
      break;
    case "claim":
    case "dominar":
    case "conquistar":
      claimRoom(store, player, localEvents);
      break;
    case "unclaim":
    case "abandonar":
    case "liberar":
      unclaimRoom(store, player, localEvents);
      break;
    case "vault":
    case "cofre":
      vaultCommand(store, player, arg, localEvents);
      break;
    case "fortify":
    case "aegis":
      addStatus(player, { name: "Fortify", kind: "buff", stat: "defense", magnitude: 4, duration: 3 }, localEvents);
      break;
    case "focus":
      addStatus(player, { name: "Focus", kind: "buff", stat: "precision", magnitude: 4, duration: 3 }, localEvents);
      break;
    case "haste":
      addStatus(player, { name: "Haste", kind: "buff", stat: "energy", magnitude: 2, duration: 3 }, localEvents);
      break;
    case "status":
    case "sheet":
      localEvents.push({
        id: randomUUID(),
        text: `Status ativos: ${
          player.statusEffects.length
            ? player.statusEffects.map((s) => `${s.name}(${s.duration})`).join(", ")
            : "nenhum"
        }. Afinidade: ${player.affinityKnown ? player.affinity.name : "oculta"}.`,
        ts: Date.now(),
        type: "info",
      });
      break;
    case "formation":
    case "formacao":
    case "linha":
      setFormation(player, arg, localEvents);
      break;
    case "reveal":
    case "despertar":
    case "afinidade":
      if (player.roomId === "caverna") {
        revealAffinity(player, localEvents, true);
      } else {
        localEvents.push({
          id: randomUUID(),
          text: "Nada acontece aqui. Procure um altar antigo.",
          ts: Date.now(),
          type: "info",
        });
      }
      break;
    default:
      localEvents.push({
        id: randomUUID(),
        text: "Comando desconhecido. Digite 'help' para ver as opcoes.",
        ts: Date.now(),
        type: "info",
      });
  }

  const snap = packSnapshot(store, player, localEvents);
  await persistStore(store);
  return snap;
};
