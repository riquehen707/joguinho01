import { RoomTemplate, MonsterTemplate } from "./worldData";

type BiomeDef = {
  id: string;
  name: string;
  tag: string;
  description: string;
  baseItems: string[];
  monsters: MonsterTemplate[];
  danger: [number, number];
  claimable?: boolean;
  vaultSize?: number;
  siteType?: string;
};

const BIOMES: BiomeDef[] = [
  {
    id: "bruma",
    name: "Bosque de Bruma",
    tag: "feral",
    description: "Nevoeiro espesso esconde pegadas e olhos brilhantes.",
    baseItems: ["erva curativa", "flecha envenenada"],
    monsters: [
      { name: "Lobo Nebuloso", hp: 32, attack: 8, reward: 18, tags: ["feral", "agile"] },
      { name: "Caçador Sombrio", hp: 36, attack: 9, reward: 20, tags: ["feral", "furtivo"] },
    ],
    danger: [1, 2],
    claimable: true,
    vaultSize: 4,
  },
  {
    id: "ruina",
    name: "Ruína Arcana",
    tag: "arcane",
    description: "Totens quebrados liberam faíscas e sussurros antigos.",
    baseItems: ["tomo partido", "tinta esmaecida"],
    monsters: [
      { name: "Escriba Fantasma", hp: 38, attack: 9, reward: 22, tags: ["arcane", "caster"] },
      { name: "Vigia Rúnico", hp: 44, attack: 10, reward: 26, tags: ["arcane", "ward"] },
    ],
    danger: [2, 3],
    claimable: true,
    vaultSize: 4,
  },
  {
    id: "forja",
    name: "Sucata Enferrujada",
    tag: "steel",
    description: "Vigas caídas e vapor quente bloqueiam passagens.",
    baseItems: ["placa enferrujada", "rebite pesado"],
    monsters: [
      { name: "Sentinela Enferrujada", hp: 46, attack: 11, reward: 28, tags: ["steel", "brute"] },
      { name: "Engenho Trêmulo", hp: 40, attack: 10, reward: 24, tags: ["steel", "unstable"] },
    ],
    danger: [3, 4],
    claimable: true,
    vaultSize: 5,
  },
  {
    id: "costas",
    name: "Costas Salgadas",
    tag: "water",
    description: "Barris flutuantes e correntes puxam tudo ao mar.",
    baseItems: ["arpão curto", "gabarito de corda"],
    monsters: [
      { name: "Corsário Errante", hp: 42, attack: 10, reward: 25, tags: ["water", "feral"] },
      { name: "Sereia Estilhaçada", hp: 38, attack: 11, reward: 26, tags: ["water", "song"] },
    ],
    danger: [2, 3],
    claimable: true,
    vaultSize: 4,
  },
  {
    id: "catalise",
    name: "Câmara de Cristais",
    tag: "earth",
    description: "Cristais flutuam, distorcendo a gravidade local.",
    baseItems: ["núcleo instável", "pedaço de meteoro"],
    monsters: [
      { name: "Golem Fragmentado", hp: 60, attack: 12, reward: 32, tags: ["construct", "earth"] },
      { name: "Fragmento Vivo", hp: 48, attack: 11, reward: 29, tags: ["construct", "earth"] },
    ],
    danger: [3, 5],
    claimable: true,
    vaultSize: 6,
  },
];

const dirs = ["norte", "sul", "leste", "oeste"] as const;
const opposite: Record<(typeof dirs)[number], (typeof dirs)[number]> = {
  norte: "sul",
  sul: "norte",
  leste: "oeste",
  oeste: "leste",
};

const makeSeed = (seed?: string | number) => {
  if (typeof seed === "number") return seed >>> 0;
  if (typeof seed === "string") {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h >>> 0) || 1;
  }
  return 123456789;
};

const mulberry32 = (a: number) => {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T,>(rng: () => number, arr: T[] | readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)];
const randint = (rng: () => number, min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;

const createRoomFromBiome = (rng: () => number, biome: BiomeDef, id: string): RoomTemplate => {
  const mobCount = randint(rng, 1, 3);
  const monsters: MonsterTemplate[] = Array.from({ length: mobCount }).map(() =>
    pick(rng, biome.monsters),
  );
  const items = [...biome.baseItems];
  if (rng() < 0.4) {
    items.push(pick(rng, biome.baseItems));
  }
  const danger = randint(rng, biome.danger[0], biome.danger[1]);
  const claimable = danger <= 3;
  const siteType = biome.siteType ?? (danger >= 4 ? "dungeon" : "selvagem");
  return {
    id,
    name: `${biome.name} ${id.split("-").pop()}`,
    description: biome.description,
    exits: {},
    items,
    monsters,
    biome: biome.id,
    danger,
    claimable: biome.claimable ?? claimable,
    vaultSize: biome.vaultSize ?? Math.max(3, danger),
    siteType,
  };
};

/**
 * Gera salas procedurais ligadas às bordas do mapa base.
 * Anchors: floresta (norte), torre (leste), cratera (sul), mina (sul), porto (oeste), caverna (oeste).
 * Usa RNG determinístico via seed para manter o mesmo mundo para todos.
 */
export const generateProceduralRooms = (count = 30, seed = "frag-world"): RoomTemplate[] => {
  const rng = mulberry32(makeSeed(seed));
  const anchors: { from: string; dir: (typeof dirs)[number] }[] = [
    { from: "floresta", dir: "norte" },
    { from: "torre", dir: "leste" },
    { from: "cratera", dir: "sul" },
    { from: "mina", dir: "sul" },
    { from: "porto", dir: "oeste" },
    { from: "caverna", dir: "oeste" },
  ];
  const rooms: RoomTemplate[] = [];
  const total = count;
  for (let i = 0; i < total; i++) {
    const anchor = anchors[i % anchors.length];
    const biome = BIOMES[i % BIOMES.length];
    const id = `${biome.id}-${i + 1}`;
    const room = createRoomFromBiome(rng, biome, id);
    room.exits[opposite[anchor.dir]] = anchor.from;
    rooms.push(room);
  }
  // cria conexões extras entre procedurais para evitar caminhos lineares
  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i];
    const b = rooms[(i + 1) % rooms.length];
    const dir = pick(rng, dirs);
    a.exits[dir] = b.id;
    b.exits[opposite[dir]] = a.id;

    if (rng() < 0.65) {
      const c = rooms[(i + 2) % rooms.length];
      const dir2 = pick(rng, dirs);
      a.exits[dir2] = c.id;
      c.exits[opposite[dir2]] = a.id;
    }
  }
  return rooms;
};

/**
 * Une base fixa + procedurais e injeta as saídas de volta nos anchors.
 * O número de procedurais pode ser ajustado pelo parâmetro `count`.
 */
export const buildWorldTemplates = (
  base: RoomTemplate[],
  seed = "frag-world",
  count = 30,
): RoomTemplate[] => {
  const procedurals = generateProceduralRooms(count, seed);
  const map = new Map<string, RoomTemplate>();
  for (const tpl of base) {
    map.set(tpl.id, {
      ...tpl,
      exits: { ...tpl.exits },
      items: [...tpl.items],
      monsters: tpl.monsters.map((m) => ({ ...m })),
    });
  }
  for (let i = 0; i < procedurals.length; i++) {
    const proc = procedurals[i];
    const anchor = proc.exits[Object.keys(proc.exits)[0]];
    const anchorDir = Object.entries(proc.exits).find(([, target]) => target === anchor)?.[0] as
      | (typeof dirs)[number]
      | undefined;
    if (anchor && anchorDir) {
      const anchorRoom = map.get(anchor);
      if (anchorRoom) {
        anchorRoom.exits[opposite[anchorDir]] = proc.id;
      }
    }
    map.set(proc.id, proc);
  }
  return Array.from(map.values());
};
