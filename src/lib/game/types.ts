export type Attribute =
  | "forca"
  | "agilidade"
  | "vigor"
  | "mente"
  | "sorte"
  | "sangue"
  | "foco";

export type SubAttribute =
  | "pesoSuportado"
  | "resFisica"
  | "resEterea"
  | "velocAtaque"
  | "regenStamina"
  | "afinidadeEssencia"
  | "percepcao";

export type Rarity = "comum" | "incomum" | "raro" | "epico" | "lendario" | "mitico";

export interface Stats {
  atributos: Record<Attribute, number>;
  sub: Record<SubAttribute, number>;
  maxHp: number;
  maxStamina: number;
}

export type ItemSlot = "arma" | "armadura" | "trinket";
export type ItemType = ItemSlot | "consumivel" | "material";

export interface Item {
  id: string;
  nome: string;
  tipo: ItemType;
  raridade: Rarity;
  peso: number;
  starter?: boolean;
  afinidades?: Attribute[];
  sockets?: number;
  efeitos: string[];
  requisitos?: Partial<Record<Attribute, number>>;
  staminaCostBase?: number;
}

export interface InventoryItem {
  itemId: string;
  qtd: number;
  ownerId?: string; // quem dropou, para log de recuperar/roubo
}

export interface CatalogProgress {
  mobsVistos: string[];
  mobsDerrotados: string[];
  biomasVisitados: string[];
}

export interface Lineage {
  id: LineageId;
  nome: string;
  descricao: string;
  afinidades: Attribute[];
  bonus: Partial<Record<Attribute, number>>;
  efeitos: string[];
}

export type LineageId = "magica" | "cosmica" | "tecnologica" | "sobrenatural";

export interface Passive {
  id: string;
  nome: string;
  descricao: string;
  raridade: Rarity;
  afinidades?: Attribute[];
  tags?: string[];
}

export interface BaseClass {
  id: string;
  nome: string;
  descricao: string;
  foco: Attribute[];
  bonus: Partial<Record<Attribute, number>>;
  malus?: Partial<Record<Attribute, number>>;
  subBonus?: Partial<Record<SubAttribute, number>>;
  subMalus?: Partial<Record<SubAttribute, number>>;
  perks: string[];
  habilidades: string[]; // ids de habilidades base
}

export interface Race {
  id: string;
  nome: string;
  descricao: string;
  perks: string[];
}

export interface Biome {
  id: string;
  nome: string;
  tom: string;
  tier: number;
  efeitos: string[];
}

export type MobRole = "brute" | "caster" | "skirmisher" | "support" | "elite";

export interface DropEntry {
  id: string;
  tipo: "item" | "essencia" | "material";
  chance: number; // 0 to 1
  raridade?: Rarity;
}

export interface Essence {
  id: string;
  nome: string;
  origem: string;
  afinidade: Attribute[];
  raridade: Rarity;
  efeito: string;
  risco?: string;
}

export interface Mob {
  id: string;
  nome: string;
  biome: string;
  role: MobRole;
  nivel: number;
  hp: number;
  stamina: number;
  dano: [number, number];
  velocidade: number;
  afinidades: Attribute[];
  efeitos: string[];
  dropTable: DropEntry[];
  furtivo?: boolean;
}

export type RoomType = "hostil" | "horda" | "desafio" | "secreta" | "santuario";

export interface RoomConnection {
  id: string;
  target: string;
  label: string;
  secreta?: boolean;
}

export interface Room {
  id: string;
  nome: string;
  biome: string;
  tipo: RoomType;
  dificuldade: number;
  mobs: string[];
  conexoes: RoomConnection[];
}

export interface WorldState {
  seed: string;
  criadoEm: number;
  salas: Record<string, Room>;
  salaInicial: string;
  versao: string;
}

export interface Player {
  id: string;
  nome: string;
  lineage: LineageId;
  race: string;
  classeBase: string;
  nivel: number;
  xp: number;
  catalogo: CatalogProgress;
  pontosDisponiveis?: number;
  ouro: number;
  corrupcao: number; // 0-100 escala simples
  status?: {
    shield: number;
    droneCharges: number;
  };
  selectedTarget?: string | null;
  lockedIdentity?: boolean;
  skillsDesbloqueadas?: string[];
  lastActionAt?: number;
  skillCooldowns?: Record<string, number>;
  localizacao: string;
  stats: Stats;
  hp: number;
  stamina: number;
  inventario: InventoryItem[];
  equipamento: Partial<Record<ItemSlot, string>>; // itemId
  passivas: string[];
  essencias: string[];
  slotsEssencia: number;
  revelados: string[]; // ids de salas secretas ja percebidas
  visitados?: string[]; // ids de salas visitadas
  ultimaMorte?: string | null;
  starterEscolhido?: boolean;
  conditions?: Record<StatusId, number>;
  masterRoom?: string | null; // sala da qual é mestre (essencia de dungeon)
  pendingTomes?: TomeOption[]; // escolhas de tomo ao upar
  recipesDescobertas?: string[]; // ids de receitas de craft que o jogador já conhece
  arquetipos?: string[]; // arquétipos dinâmicos ativos
  mutacao?: string | null; // mutação ativa
}

export interface MobInstance {
  id: string;
  mobId: string;
  hp: number;
  alive: boolean;
  power?: number; // bonus por equipar loot de jogador
  conditions?: Record<StatusId, number>;
  invocadorId?: string; // se for uma invocacao do jogador
  tags?: string[]; // ex: "voador", "furtivo"
}

export interface RoomState {
  roomId: string;
  mobs: MobInstance[];
  lastUpdated: number;
  loot?: InventoryItem[];
  deathCount?: number;
  masterId?: string | null; // jogador que reivindicou a sala
  anomalies?: Anomaly[];
}

export interface Skill {
  id: string;
  nome: string;
  descricao: string;
  custoStamina: number;
  baseDano: [number, number];
  escala: Partial<Record<Attribute, number>>; // multiplicador por atributo
  alcance?: "corpo" | "distancia";
  tags?: string[];
  requerAlvo?: boolean;
  cooldownMs?: number;
  categoria?: "ataque" | "defesa" | "suporte" | "invocacao" | "controle";
  raridade?: Rarity;
  starterPool?: boolean; // elegivel para escolha inicial
  variantes?: Array<{
    lineage?: LineageId;
    race?: string;
    mutateTo: string; // skillId de destino
    descricaoExtra?: string;
  }>;
  aplica?: Array<{
    efeito: StatusId;
    duracao: number;
    chance?: number; // 0-1
    alvo?: "alvo" | "self";
  }>; 
}

export interface TomeOption {
  id: string;
  bonus: Partial<Record<Attribute, number>>;
  malus?: Partial<Record<Attribute, number>>;
  desc: string;
}

export interface RecipeInput {
  itemId: string;
  qtd: number;
}

export interface Recipe {
  id: string;
  nome: string;
  descricao: string;
  inputs: RecipeInput[];
  outputs: RecipeInput[];
  requisitoPassiva?: string; // opcional
  requisitoLinhagem?: LineageId; // opcional
}

export type AnomalyType = "estatua_deusa" | "parasita_abissal" | "rio_misterioso";

export interface Anomaly {
  id: string;
  tipo: AnomalyType;
  resolvida?: boolean;
  pistas?: string[];
}

export interface Archetype {
  id: string;
  nome: string;
  tagsNecessarias?: string[]; // tags de skill
  equipObrigatorio?: string[]; // itemIds
  essencias?: string[];
  linhagem?: LineageId;
  attrsMin?: Partial<Record<Attribute, number>>;
  skillsDesbloqueadas?: string[];
  passivas?: string[];
  bonus?: Partial<Record<Attribute, number>>;
  malus?: Partial<Record<Attribute, number>>;
}

export interface Mutation {
  id: string;
  nome: string;
  descricao: string;
  gatilhoEssencias?: string[];
  skills?: string[];
  passivas?: string[];
  bonus?: Partial<Record<Attribute, number>>;
  malus?: Partial<Record<Attribute, number>>;
}

export type StatusId =
  | "veneno"
  | "sangramento"
  | "medo"
  | "atordoado"
  | "congelado"
  | "enfraquecido"
  | "silenciado"
  | "lento";

export interface CommandResult {
  log: string[];
  player: Player;
  room?: Room;
  roomState?: RoomState;
  world?: Pick<WorldState, "salaInicial" | "seed" | "versao">;
  chatMessages?: string[];
  presence?: { id: string; nome: string }[];
}
