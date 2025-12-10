import crypto from "crypto";
import { BASE_CLASSES } from "../data/classes";
import { LINEAGES } from "../data/lineages";
import { PASSIVES } from "../data/passives";
import { RACES } from "../data/races";
import { Player, Stats, Attribute, SubAttribute, WorldState, InventoryItem, CatalogProgress } from "../types";
import { getRedis } from "./redisClient";

const PLAYER_PREFIX = "mud:player:";

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function createBaseStats(lineageBonus: Partial<Record<Attribute, number>>, classBonus: Partial<Record<Attribute, number>>): Stats {
  const base: Record<Attribute, number> = {
    forca: 5,
    agilidade: 5,
    vigor: 5,
    mente: 5,
    sorte: 5,
    sangue: 5,
    foco: 5,
  };
  for (const key of Object.keys(lineageBonus) as Attribute[]) {
    base[key] = (base[key] || 0) + (lineageBonus[key] || 0);
  }
  for (const key of Object.keys(classBonus) as Attribute[]) {
    base[key] = (base[key] || 0) + (classBonus[key] || 0);
  }

  const sub: Record<SubAttribute, number> = {
    pesoSuportado: 10 + Math.floor(Math.random() * 6),
    resFisica: 2 + Math.floor(Math.random() * 3),
    resEterea: 1 + Math.floor(Math.random() * 3),
    velocAtaque: 1 + Math.floor(Math.random() * 2),
    regenStamina: 2 + Math.floor(Math.random() * 3),
    afinidadeEssencia: 1 + Math.floor(Math.random() * 2),
    percepcao: 1 + Math.floor(Math.random() * 3),
  };

  const maxHp = 40 + base.vigor * 4 + base.forca;
  const maxStamina = 30 + base.vigor * 2 + base.mente + base.foco;

  return { atributos: base, sub, maxHp, maxStamina };
}

export async function loadPlayer(playerId: string): Promise<Player | null> {
  const redis = await getRedis();
  const raw = await redis.get(PLAYER_PREFIX + playerId);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Player;
  return ensureDefaults(parsed);
}

export async function savePlayer(player: Player): Promise<void> {
  const redis = await getRedis();
  await redis.set(PLAYER_PREFIX + player.id, JSON.stringify(player));
}

export async function getOrCreatePlayer(playerId: string | null, world: WorldState, nome?: string): Promise<Player> {
  if (playerId) {
    const existing = await loadPlayer(playerId);
    if (existing) return existing;
  }

  const lineage = pickRandom(LINEAGES);
  const classeBase = pickRandom(BASE_CLASSES);
  const race = pickRandom(RACES);
  const passive = pickRandom(PASSIVES);

  const stats = createBaseStats(lineage.bonus, classeBase.bonus);

  const id = playerId ?? crypto.randomUUID();
  const player: Player = {
    id,
    nome: nome || `Viajante-${id.slice(0, 4)}`,
    lineage: lineage.id,
    race: race.id,
    classeBase: classeBase.id,
    nivel: 1,
    xp: 0,
    pontosDisponiveis: 0,
    catalogo: seedCatalog(),
    ouro: 50,
    corrupcao: 0,
    status: { shield: 0, droneCharges: 0 },
    selectedTarget: null,
    lockedIdentity: false,
    skillsDesbloqueadas: [],
    lastActionAt: Date.now(),
    localizacao: world.salaInicial,
    stats,
    hp: stats.maxHp,
    stamina: stats.maxStamina,
    inventario: seedInventory(),
    equipamento: {
      arma: "espada_enferrujada",
      armadura: "armadura_de_couro",
    },
    passivas: [passive.id],
    essencias: [],
    slotsEssencia: 1,
    revelados: [],
    visitados: [world.salaInicial],
  };

  await savePlayer(player);
  return player;
}

function seedInventory(): InventoryItem[] {
  return [
    { itemId: "frasco_cura", qtd: 2 },
    { itemId: "espada_enferrujada", qtd: 1 },
    { itemId: "armadura_de_couro", qtd: 1 },
    { itemId: "pingente_oculto", qtd: 1 },
  ];
}

function seedCatalog(): CatalogProgress {
  return { mobsVistos: [], mobsDerrotados: [], biomasVisitados: [] };
}

function ensureDefaults(player: Player): Player {
  const patched = { ...player };
  if (patched.hp === undefined || patched.hp === null) patched.hp = patched.stats.maxHp;
  if (patched.stamina === undefined || patched.stamina === null) patched.stamina = patched.stats.maxStamina;
  if (!patched.inventario) patched.inventario = seedInventory();
  if (!patched.equipamento) patched.equipamento = {};
  if (!patched.passivas) patched.passivas = [];
  if (!patched.essencias) patched.essencias = [];
  if (!patched.revelados) patched.revelados = [];
  if (!patched.slotsEssencia) patched.slotsEssencia = 1;
  if (!patched.catalogo) patched.catalogo = seedCatalog();
  if (patched.pontosDisponiveis === undefined || patched.pontosDisponiveis === null) patched.pontosDisponiveis = 0;
  if (patched.ouro === undefined || patched.ouro === null) patched.ouro = 0;
  if (patched.corrupcao === undefined || patched.corrupcao === null) patched.corrupcao = 0;
  if (!patched.visitados) patched.visitados = [patched.localizacao];
  if (!patched.status) patched.status = { shield: 0, droneCharges: 0 };
  if (patched.selectedTarget === undefined) patched.selectedTarget = null;
  if (patched.lockedIdentity === undefined) patched.lockedIdentity = false;
  if (!patched.skillsDesbloqueadas) patched.skillsDesbloqueadas = [];
  if (!patched.lastActionAt) patched.lastActionAt = Date.now();
  return patched;
}
