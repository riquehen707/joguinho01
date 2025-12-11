import crypto from "crypto";
import { BASE_CLASSES } from "../data/classes";
import { LINEAGES } from "../data/lineages";
import { PASSIVES } from "../data/passives";
import { RACES } from "../data/races";
import { Player, Stats, Attribute, SubAttribute, WorldState, InventoryItem, CatalogProgress, Item } from "../types";
import { getRedis } from "./redisClient";

const PLAYER_PREFIX = "mud:player:";

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function classSkillIds(classId: string): string[] {
  const cls = BASE_CLASSES.find((c) => c.id === classId);
  return cls?.habilidades ?? [];
}

export function createBaseStats(
  lineageBonus: Partial<Record<Attribute, number>>,
  classBonus: Partial<Record<Attribute, number>>,
  classMalus?: Partial<Record<Attribute, number>>,
  classSubBonus?: Partial<Record<SubAttribute, number>>,
  classSubMalus?: Partial<Record<SubAttribute, number>>
): Stats {
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
  if (classMalus) {
    for (const key of Object.keys(classMalus) as Attribute[]) {
      base[key] = (base[key] || 0) + (classMalus[key] || 0);
    }
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
  if (classSubBonus) {
    for (const key of Object.keys(classSubBonus) as SubAttribute[]) {
      sub[key] = (sub[key] || 0) + (classSubBonus[key] || 0);
    }
  }
  if (classSubMalus) {
    for (const key of Object.keys(classSubMalus) as SubAttribute[]) {
      sub[key] = (sub[key] || 0) + (classSubMalus[key] || 0);
    }
  }

  const maxHp = 40 + base.vigor * 4 + base.forca;
  const maxStamina = 30 + base.vigor * 2 + base.mente + base.foco;

  return { atributos: base, sub, maxHp, maxStamina };
}

export function applyIdentity(player: Player, lineageId: string, classId: string, raceId: string): Player {
  const lineage = LINEAGES.find((l) => l.id === lineageId);
  const classe = BASE_CLASSES.find((c) => c.id === classId);
  const race = RACES.find((r) => r.id === raceId);
  if (!lineage || !classe || !race) return player;
  const stats = createBaseStats(lineage.bonus, classe.bonus, classe.malus, classe.subBonus, classe.subMalus);
  const unlocked = new Set([...(player.skillsDesbloqueadas ?? []), ...classSkillIds(classe.id)]);
  return {
    ...player,
    lineage: lineage.id,
    classeBase: classe.id,
    race: race.id,
    stats,
    hp: stats.maxHp,
    stamina: stats.maxStamina,
    lockedIdentity: true,
    skillsDesbloqueadas: Array.from(unlocked),
  };
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

  const stats = createBaseStats(lineage.bonus, classeBase.bonus, classeBase.malus, classeBase.subBonus, classeBase.subMalus);
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
    skillsDesbloqueadas: Array.from(new Set([...classSkillIds(classeBase.id)])),
    lastActionAt: Date.now(),
    localizacao: world.salaInicial,
    stats,
    hp: stats.maxHp,
    stamina: stats.maxStamina,
    inventario: seedInventory(null),
    equipamento: {},
    passivas: [passive.id],
    essencias: [],
    slotsEssencia: 1,
    revelados: [],
    visitados: [world.salaInicial],
    starterEscolhido: false,
  };

  await savePlayer(player);
  return player;
}

function seedInventory(starterItem: Item | null): InventoryItem[] {
  const base: InventoryItem[] = [
    { itemId: "frasco_cura", qtd: 2 },
    { itemId: "pingente_oculto", qtd: 1 },
  ];
  // players agora escolhem item starter via comando/fluxo; se nao houver escolha, fica so o pingente + poções
  if (starterItem) {
    const existing = base.find((b) => b.itemId === starterItem.id);
    if (existing) existing.qtd += 1;
    else base.push({ itemId: starterItem.id, qtd: 1 });
  }
  return base;
}

function seedCatalog(): CatalogProgress {
  return { mobsVistos: [], mobsDerrotados: [], biomasVisitados: [] };
}

function ensureDefaults(player: Player): Player {
  const patched = { ...player };
  if (patched.hp === undefined || patched.hp === null) patched.hp = patched.stats.maxHp;
  if (patched.stamina === undefined || patched.stamina === null) patched.stamina = patched.stats.maxStamina;
  if (!patched.inventario) patched.inventario = seedInventory(null);
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
  if (!patched.skillsDesbloqueadas || patched.skillsDesbloqueadas.length === 0) {
    patched.skillsDesbloqueadas = classSkillIds(patched.classeBase);
  }
  if (patched.starterEscolhido === undefined) {
    patched.starterEscolhido = true;
  }
  if (!patched.lastActionAt) patched.lastActionAt = Date.now();
  if (!patched.skillCooldowns) patched.skillCooldowns = {};
  if (!patched.ultimaMorte) patched.ultimaMorte = null;
  return patched;
}
