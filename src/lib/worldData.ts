export type MonsterTemplate = {
  name: string;
  hp: number;
  attack: number;
  reward: number;
  tags?: string[];
};

export type RoomTemplate = {
  id: string;
  name: string;
  description: string;
  exits: Record<string, string>;
  items: string[];
  monsters: MonsterTemplate[];
  biome?: string;
  danger?: number;
  claimable?: boolean;
  vaultSize?: number;
  siteType?: string;
};

export type OriginId = "arcana" | "nocturna" | "forja" | "mitica";
export type Tendency = "precisao" | "agilidade" | "forca" | "vontade" | "defesa";
export type Formation = "vanguarda" | "retaguarda" | "furtivo" | "sentinela" | "artilharia";

// --- Skills e drops ------------------------------------------------------
export type SkillTarget = "single" | "aoe" | "self";
export type SkillKind = "active" | "passive";

export type SkillDef = {
  id: string;
  name: string;
  kind: SkillKind;
  target: SkillTarget;
  tags: string[];
  cost?: { energy?: number; hp?: number };
  scaling?: { precision?: number; might?: number; will?: number };
  base?: number;
  status?: { stat: "bleed" | "burn" | "regen" | "energy" | "precision" | "might"; magnitude: number; duration: number };
  cooldown?: number;
  description: string;
};

export const SKILLS: SkillDef[] = [
  {
    id: "basic-strike",
    name: "Golpe Básico",
    kind: "active",
    target: "single",
    tags: ["core", "melee"],
    cost: { energy: 0 },
    base: 8,
    scaling: { might: 0.6, precision: 0.4 },
    description: "Ataque simples corpo a corpo.",
  },
  {
    id: "quick-shot",
    name: "Disparo Rápido",
    kind: "active",
    target: "single",
    tags: ["core", "ranged"],
    cost: { energy: 2 },
    base: 7,
    scaling: { precision: 0.8, might: 0.2 },
    description: "Projétil leve, consome pouca energia.",
  },
  {
    id: "spark-chain",
    name: "Faísca em Cadeia",
    kind: "active",
    target: "aoe",
    tags: ["arcane", "lightning"],
    cost: { energy: 6 },
    base: 10,
    scaling: { precision: 0.6, will: 0.6 },
    status: { stat: "burn", magnitude: 2, duration: 2 },
    cooldown: 2,
    description: "Relâmpago que atinge todos os inimigos na sala, aplicando queimadura leve.",
  },
  {
    id: "feral-bite",
    name: "Mordida Feral",
    kind: "active",
    target: "single",
    tags: ["feral", "melee"],
    cost: { energy: 4 },
    base: 12,
    scaling: { might: 0.9, precision: 0.2 },
    status: { stat: "bleed", magnitude: 3, duration: 2 },
    cooldown: 1,
    description: "Golpe corpo a corpo que sangra o alvo.",
  },
  {
    id: "echo-veil",
    name: "Véu de Eco",
    kind: "passive",
    target: "self",
    tags: ["arcane", "echo"],
    status: { stat: "precision", magnitude: 2, duration: 0 },
    description: "Passiva: +2 precisão permanente e chance de ecoar críticas (implementado no cálculo).",
  },
];

// Itens que desbloqueiam skills
export const SKILL_DROPS: Record<string, string> = {
  "pergaminho de faísca": "spark-chain",
  "essencia-feral": "feral-bite",
  "essencia-eco": "echo-veil",
};

export const baseRooms: RoomTemplate[] = [
  {
    id: "praca",
    name: "Praça Central",
    description: "Fogos azuis pairam sobre um círculo de pedra. A praça conecta todas as outras zonas da arena.",
    exits: { norte: "floresta", leste: "torre", sul: "mina", oeste: "porto" },
    items: ["moeda de bronze", "pequena runa"],
    monsters: [],
    claimable: false,
    danger: 1,
    siteType: "hub",
  },
  {
    id: "floresta",
    name: "Floresta Nebulosa",
    description: "Troncos retorcidos escondem olhos atentos. As trilhas levam aventureiros a caçadas rápidas.",
    exits: { sul: "praca", leste: "cratera" },
    items: ["erva curativa", "flecha envenenada"],
    monsters: [{ name: "Lobo Sombrio", hp: 35, attack: 8, reward: 20, tags: ["feral", "agile"] }],
    claimable: true,
    vaultSize: 4,
    danger: 2,
    siteType: "selvagem",
  },
  {
    id: "torre",
    name: "Torre Prismática",
    description: "Espelhos quebrados refletem ecos de magia antiga. Os corredores brilham em cores frias.",
    exits: { oeste: "praca", sul: "cratera" },
    items: ["pergaminho de faísca", "fragmento de vidro"],
    monsters: [{ name: "Arquivista Rúnico", hp: 42, attack: 9, reward: 24, tags: ["arcane", "caster"] }],
    claimable: true,
    vaultSize: 4,
    danger: 3,
    siteType: "ruina",
  },
  {
    id: "mina",
    name: "Mina Abandonada",
    description: "Ar cheira a ferrugem e ozônio. Trilhos quebrados levam a recantos instáveis.",
    exits: { norte: "praca", leste: "caverna" },
    items: ["barril de pólvora", "tocha curta"],
    monsters: [{ name: "Capataz de Ferro", hp: 40, attack: 10, reward: 26, tags: ["steel", "brute"] }],
    claimable: true,
    vaultSize: 4,
    danger: 3,
    siteType: "escavacao",
  },
  {
    id: "porto",
    name: "Porto Enguiçado",
    description: "Navios fantasmas flutuam presos a correntes douradas. As tábuas rangem denunciando presenças.",
    exits: { leste: "praca", norte: "caverna" },
    items: ["anzol amaldiçoado", "corda reforçada"],
    monsters: [{ name: "Corsário das Profundezas", hp: 45, attack: 10, reward: 28, tags: ["water", "feral"] }],
    claimable: true,
    vaultSize: 4,
    danger: 2,
    siteType: "anexo",
  },
  {
    id: "cratera",
    name: "Cratera de Estilhaços",
    description: "Cristais quebrados pairam no ar. A gravidade falha e faz passos leves virarem saltos longos.",
    exits: { oeste: "floresta", norte: "torre", sul: "caverna" },
    items: ["núcleo instável", "pedaço de meteoro"],
    monsters: [{ name: "Golem de Estilhaços", hp: 55, attack: 11, reward: 32, tags: ["construct", "earth"] }],
    claimable: true,
    vaultSize: 5,
    danger: 4,
    siteType: "fenda",
  },
  {
    id: "caverna",
    name: "Caverna de Ecos",
    description: "Sussurros repetem falas que você ainda não disse. Ecos guiam (ou enganam).",
    exits: { norte: "cratera", leste: "praca", sul: "porto", oeste: "mina" },
    items: ["poção de vigor", "talismã rachado"],
    monsters: [{ name: "Eco Primordial", hp: 60, attack: 12, reward: 35, tags: ["arcane", "echo"] }],
    claimable: false,
    vaultSize: 0,
    danger: 5,
    siteType: "reliquia",
  },
];

export const MONSTER_AFFINITY: Record<string, { id: string; name: string; originId: string }> = {
  "Lobo Sombrio": { id: "feral", name: "Feral", originId: "nocturna" },
  "Arquivista Rúnico": { id: "sombra", name: "Sombra", originId: "arcana" },
  "Capataz de Ferro": { id: "engrenagem", name: "Engrenagem", originId: "forja" },
  "Corsário das Profundezas": { id: "mar", name: "Mar/Mares", originId: "mitica" },
  "Golem de Estilhaços": { id: "pressao", name: "Pressao/Calor", originId: "forja" },
  "Eco Primordial": { id: "destino", name: "Destino/Marca", originId: "mitica" },
};

export const COMMON_LOOT: Record<string, string[]> = {
  "Lobo Sombrio": ["pelagem rija", "presa trincada"],
  "Arquivista Rúnico": ["tomo partido", "tinta esmaecida"],
  "Capataz de Ferro": ["placa enferrujada", "rebite pesado"],
  "Corsário das Profundezas": ["arpão curto", "gabarito de corda"],
  "Golem de Estilhaços": ["estilhaço cintilante", "areia cristalizada"],
  "Eco Primordial": ["fragmento de eco", "lente rachada"],
};

// Tags por monstro (para desbloqueios de afinidade/skills)
export const MONSTER_TAGS: Record<string, string[]> = {
  "Lobo Sombrio": ["feral", "nocturna"],
  "Escriba Fantasma": ["arcane", "echo"],
  "Arquivista Rúnico": ["arcane", "rune"],
  "Capataz de Ferro": ["steel", "brute", "forja"],
  "Corsário das Profundezas": ["water", "feral", "pirate"],
  "Golem de Estilhaços": ["earth", "construct"],
  "Eco Primordial": ["arcane", "echo", "mythic"],
  "Sentinela Enferrujada": ["steel", "brute", "forja"],
  "Engenho Trêmulo": ["steel", "unstable", "forja"],
  "Corsário Errante": ["water", "pirate"],
  "Sereia Estilhaçada": ["water", "song"],
  "Golem Fragmentado": ["earth", "construct"],
  "Fragmento Vivo": ["earth", "construct"],
  "Lobo Nebuloso": ["feral", "nocturna"],
  "Caçador Sombrio": ["feral", "nocturna"],
  "Vigia Rúnico": ["arcane", "ward"],
};

// Desbloqueios de skills por tag (ao atingir certa contagem de kills dessa tag)
export const SKILL_TAG_UNLOCKS: Record<string, { threshold: number; skillId: string }[]> = {
  water: [
    { threshold: 3, skillId: "quick-shot" },
    { threshold: 6, skillId: "spark-chain" },
  ],
  feral: [
    { threshold: 3, skillId: "feral-bite" },
  ],
  steel: [
    { threshold: 4, skillId: "quick-shot" },
  ],
  arcane: [
    { threshold: 3, skillId: "spark-chain" },
    { threshold: 6, skillId: "echo-veil" },
  ],
  earth: [
    { threshold: 4, skillId: "spark-chain" },
  ],
  echo: [
    { threshold: 5, skillId: "echo-veil" },
  ],
};

