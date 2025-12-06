import { randomUUID } from "crypto";
import { createClient, RedisClientType } from "redis";

export type EventKind = "system" | "combat" | "chat" | "loot" | "move" | "info";

export type GameEvent = {
  id: string;
  text: string;
  ts: number;
  type: EventKind;
  roomId?: string;
};

type Monster = {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  reward: number;
};

type Room = {
  id: string;
  name: string;
  description: string;
  exits: Record<string, string>;
  items: string[];
  monster?: Monster;
};

export type OriginId = "arcana" | "nocturna" | "forja" | "mitica";
export type Tendency = "precisao" | "agilidade" | "forca" | "vontade" | "defesa";

type AttributeSet = {
  precision: number;
  agility: number;
  might: number;
  will: number;
  defense: number;
  resistance: number;
  recovery: number;
  crit: number;
};

type Affinity = {
  id: string;
  name: string;
  originId: OriginId;
};

type OriginDef = {
  id: OriginId;
  name: string;
  description: string;
  affinities: Affinity[];
  ranges: Record<keyof AttributeSet, [number, number]>;
};

type PlayerRecord = {
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
};

export type RoomView = {
  id: string;
  name: string;
  description: string;
  exits: { direction: string; to: string }[];
  items: string[];
  monster?: { name: string; hp: number; maxHp: number };
  occupants: { id: string; name: string }[];
};

export type ScoreEntry = { id: string; name: string; score: number };

export type GameSnapshot = {
  player: PlayerView;
  room: RoomView;
  scoreboard: ScoreEntry[];
  events: GameEvent[];
  now: number;
};

type GameStore = {
  rooms: Record<string, Room>;
  players: Record<string, PlayerRecord>;
  accounts: Record<string, { email: string; passwordHash: string; playerId: string }>;
  log: GameEvent[];
};

export const INVENTORY_LIMIT = 12;
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY = "mud:store:v1";
let redisClient: RedisClientType | null = null;
let redisLoaded = false;

const MONSTER_AFFINITY: Record<string, Affinity> = {
  "Lobo Sombrio": { id: "feral", name: "Feral", originId: "nocturna" },
  "Arquivista Rúnico": { id: "sombra", name: "Sombra", originId: "arcana" },
  "Capataz de Ferro": { id: "engrenagem", name: "Engrenagem", originId: "forja" },
  "Corsário das Profundezas": { id: "mar", name: "Mar/Mares", originId: "mitica" },
  "Golem de Estilhaços": { id: "pressao", name: "Pressao/Calor", originId: "forja" },
  "Eco Primordial": { id: "destino", name: "Destino/Marca", originId: "mitica" },
};

const COMMON_LOOT: Record<string, string[]> = {
  "Lobo Sombrio": ["pelagem rija", "presa trincada"],
  "Arquivista Rúnico": ["tomo partido", "tinta esmaecida"],
  "Capataz de Ferro": ["placa enferrujada", "rebite pesado"],
  "Corsário das Profundezas": ["arpão curto", "gabarito de corda"],
  "Golem de Estilhaços": ["estilhaço cintilante", "areia cristalizada"],
  "Eco Primordial": ["fragmento de eco", "lente rachada"],
};

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

const INACTIVITY_TIMEOUT = 1000 * 60 * 15;
const LOG_LIMIT = 200;

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

const baseRooms: Room[] = [
  {
    id: "praca",
    name: "Praça Central",
    description:
      "Fogos azuis pairam sobre um círculo de pedra. A praça conecta todas as outras zonas da arena.",
    exits: { norte: "floresta", leste: "torre", sul: "mina", oeste: "porto" },
    items: ["moeda de bronze", "pequena runa"],
  },
  {
    id: "floresta",
    name: "Floresta Nebulosa",
    description:
      "Troncos retorcidos escondem olhos atentos. As trilhas levam aventureiros a caçadas rápidas.",
    exits: { sul: "praca", leste: "cratera" },
    items: ["erva curativa", "flecha envenenada"],
    monster: {
      name: "Lobo Sombrio",
      hp: 35,
      maxHp: 35,
      attack: 8,
      reward: 20,
    },
  },
  {
    id: "torre",
    name: "Torre Prismática",
    description:
      "Espelhos quebrados refletem ecos de magia antiga. Os corredores brilham em cores frias.",
    exits: { oeste: "praca", sul: "cratera" },
    items: ["pergaminho de faísca", "fragmento de vidro"],
    monster: {
      name: "Arquivista Rúnico",
      hp: 42,
      maxHp: 42,
      attack: 9,
      reward: 24,
    },
  },
  {
    id: "mina",
    name: "Mina Abandonada",
    description: "Ar cheira a ferrugem e ozônio. Trilhos quebrados levam a recantos instáveis.",
    exits: { norte: "praca", leste: "caverna" },
    items: ["barril de pólvora", "tocha curta"],
    monster: {
      name: "Capataz de Ferro",
      hp: 40,
      maxHp: 40,
      attack: 10,
      reward: 26,
    },
  },
  {
    id: "porto",
    name: "Porto Enguiçado",
    description:
      "Navios fantasmas flutuam presos a correntes douradas. As tábuas rangem denunciando presenças.",
    exits: { leste: "praca", norte: "caverna" },
    items: ["anzol amaldiçoado", "corda reforçada"],
    monster: {
      name: "Corsário das Profundezas",
      hp: 45,
      maxHp: 45,
      attack: 10,
      reward: 28,
    },
  },
  {
    id: "cratera",
    name: "Cratera de Estilhaços",
    description:
      "Cristais quebrados pairam no ar. A gravidade falha e faz passos leves virarem saltos longos.",
    exits: { oeste: "floresta", norte: "torre", sul: "caverna" },
    items: ["núcleo instável", "pedaço de meteoro"],
    monster: {
      name: "Golem de Estilhaços",
      hp: 55,
      maxHp: 55,
      attack: 11,
      reward: 32,
    },
  },
  {
    id: "caverna",
    name: "Caverna de Ecos",
    description: "Sussurros repetem falas que você ainda não disse. Ecos guiam (ou enganam).",
    exits: { norte: "cratera", leste: "praca", sul: "porto", oeste: "mina" },
    items: ["poção de vigor", "talismã rachado"],
    monster: {
      name: "Eco Primordial",
      hp: 60,
      maxHp: 60,
      attack: 12,
      reward: 35,
    },
  },
];

const connectRedis = async () => {
  if (!REDIS_URL) return null;
  if (redisClient) return redisClient;
  const client = createClient({ url: REDIS_URL });
  await client.connect();
  redisClient = client;
  return client;
};

const bootstrapMemoryStore = (): GameStore => {
  const rooms: Record<string, Room> = {};
  for (const room of baseRooms) {
    rooms[room.id] = { ...room, exits: { ...room.exits }, items: [...room.items] };
  }
  return {
    rooms,
    players: {},
    accounts: {},
    log: [],
  };
};

const deserializeStore = (data: string | null): GameStore => {
  if (!data) return bootstrapMemoryStore();
  try {
    const parsed = JSON.parse(data) as GameStore;
    // rebuild rooms items/monsters if needed
    const rooms: Record<string, Room> = {};
    for (const room of baseRooms) {
      const saved = parsed.rooms?.[room.id];
      rooms[room.id] = {
        ...room,
        ...(saved ?? {}),
        exits: { ...(saved?.exits ?? room.exits) },
        items: [...(saved?.items ?? room.items)],
        monster: saved?.monster ? { ...saved.monster } : room.monster ? { ...room.monster } : undefined,
      };
    }
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
});

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

  return {
    id: room.id,
    name: room.name,
    description: room.description,
    exits,
    items: [...room.items],
    monster: room.monster
      ? { name: room.monster.name, hp: room.monster.hp, maxHp: room.monster.maxHp }
      : undefined,
    occupants,
  };
};

const packSnapshot = (
  store: GameStore,
  player: PlayerRecord,
  events: GameEvent[],
): GameSnapshot => ({
  player: toPlayerView(player),
  room: buildRoomView(store, player),
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

const attack = (
  store: GameStore,
  player: PlayerRecord,
  localEvents: GameEvent[],
) => {
  const room = store.rooms[player.roomId];
  if (!room.monster) {
    localEvents.push({
      id: randomUUID(),
      text: "Nenhum inimigo a vista.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  if (player.energy <= 0) {
    localEvents.push({
      id: randomUUID(),
      text: "Você está exausto. Use 'rest' ou 'descansar'.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const energyCost = Math.max(2, 5 - Math.floor(player.attributes.agility / 6));
  if (player.energy < energyCost) {
    localEvents.push({
      id: randomUUID(),
      text: "Energia insuficiente para atacar. Descanse.",
      ts: Date.now(),
      type: "info",
    });
    return;
  }

  const hitChance = Math.max(
    35,
    Math.min(
      95,
      65 +
        (player.attributes.precision + buffPrecision) * 2 -
        Math.floor(player.attributes.agility / 5) +
        awakened.crit,
    ),
  );
  const rollHit = Math.random() * 100;
  if (rollHit > hitChance) {
    player.energy = Math.max(0, player.energy - Math.max(1, Math.floor(energyCost / 2)));
    localEvents.push({
      id: randomUUID(),
      text: `${player.name} erra ${room.monster.name}.`,
      ts: Date.now(),
      type: "combat",
    });
    return;
  }

  const critChance = Math.min(
    40,
    player.attributes.crit + (player.attributes.precision + buffPrecision) * 0.6 + awakened.crit,
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
  const playerHit = Math.max(3, Math.round(baseDamage * (isCrit ? 1.4 : 1)));

  room.monster.hp -= playerHit;
  player.energy = Math.max(0, player.energy - energyCost);

  const attackEvent = pushEvent(
    store,
    `${player.name} ${isCrit ? "crita" : "atinge"} ${room.monster.name} (-${playerHit} HP).`,
    "combat",
    room.id,
  );
  localEvents.push(attackEvent);
  if (awakened.text) {
    localEvents.push({
      id: randomUUID(),
      text: awakened.text,
      ts: Date.now(),
      type: "info",
    });
  }

  if (room.monster.hp <= 0) {
    const reward = room.monster.reward;
    player.score += reward;
    player.hp = Math.min(player.maxHp, player.hp + 6);
    const monsterAffinity = MONSTER_AFFINITY[room.monster.name] ?? player.affinity;
    const essence = createEssenceItem(monsterAffinity);
    room.items.push(essence);
    const lootTable = COMMON_LOOT[room.monster.name];
    if (lootTable && Math.random() < 0.65) {
      const loot = lootTable[roll(0, lootTable.length - 1)];
      room.items.push(loot);
    }
    const defeatEvent = pushEvent(
      store,
      `${player.name} derrotou ${room.monster.name}! (+${reward} pontos)`,
      "combat",
      room.id,
    );
    localEvents.push(defeatEvent);
    localEvents.push(
      pushEvent(
        store,
        `${room.monster.name} deixou cair ${essence}.`,
        "loot",
        room.id,
      ),
    );
    room.monster = undefined;
    return;
  }

  const mitigation = Math.round(player.attributes.defense * 0.6 + player.attributes.resistance * 0.3);
  const retaliation = Math.max(
    2,
    room.monster.attack + roll(-2, 3) - Math.round(mitigation * 0.2),
  );
  player.hp -= retaliation;

  const retaliationEvent = pushEvent(
    store,
    `${room.monster.name} contra-ataca ${player.name} (-${retaliation} HP).`,
    "combat",
    room.id,
  );
  localEvents.push(retaliationEvent);

  const debuff = MONSTER_DEBUFFS[room.monster.name];
  if (debuff) {
    addStatus(
      player,
      { name: debuff.name, kind: "debuff", stat: debuff.stat, magnitude: debuff.magnitude, duration: debuff.duration },
      localEvents,
    );
  }

  if (player.hp <= 0) {
    player.isAlive = false;
    player.hp = 0;
    pushEvent(store, `${player.name} foi nocauteado!`, "combat", room.id);
  }
};

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
  text: "Comandos: north/sul/leste/oeste (ou n/s/l/o), look, attack, rest, say <texto>, take <item>, drop <item>, sell <item>, use <item>, fuse <a> <b>, reveal/altar (afinidade na caverna), respawn.",
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
): GameSnapshot => {
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
    if (!player.statusEffects) {
      player.statusEffects = [];
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
      } as unknown as PlayerView,
      room: {
        id: "",
        name: "Nenhum",
        description: "Jogador não encontrado.",
        exits: [],
        items: [],
        occupants: [],
      },
      scoreboard: [],
      events: [],
      now: Date.now(),
      error: "Jogador não encontrado. Reentre na partida.",
    };
  }

  player.lastActive = Date.now();

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
      attack(store, player, localEvents);
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
