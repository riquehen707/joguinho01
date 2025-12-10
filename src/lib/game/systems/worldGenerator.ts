import { BIOMES } from "../data/biomes";
import { mobsByBiome } from "../state/mobCatalog";
import { Room, RoomConnection, RoomType, WorldState } from "../types";

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)];
}

function addConnection(a: Room, b: Room, label: string, secreta?: boolean) {
  const exists = a.conexoes.some((c) => c.target === b.id);
  if (exists) return;
  const connA: RoomConnection = { id: `${a.id}->${b.id}`, target: b.id, label, secreta };
  const connB: RoomConnection = { id: `${b.id}->${a.id}`, target: a.id, label, secreta };
  a.conexoes.push(connA);
  b.conexoes.push(connB);
}

function createRoom(id: string, biomeId: string, tipo: RoomType, dificuldade: number, rng: () => number): Room {
  const template = mobsByBiome(biomeId);
  const mobCount = tipo === "horda" ? 3 : tipo === "desafio" ? 2 : 1 + Math.floor(rng() * 2);
  const mobs = template.length
    ? Array.from({ length: mobCount }, () => pick(template, rng).id)
    : [];
  return {
    id,
    nome: `${biomeId}-${id}`,
    biome: biomeId,
    tipo,
    dificuldade,
    mobs,
    conexoes: [],
  };
}

const BIOME_LINKS: Record<string, string[]> = {
  cripta: ["biblioteca", "pantano"],
  pantano: ["cripta", "deserto_espectral"],
  biblioteca: ["cripta", "fissura_abissal"],
  fissura_abissal: ["biblioteca", "forja_tecnomantica"],
  deserto_espectral: ["pantano", "forja_tecnomantica"],
  forja_tecnomantica: ["fissura_abissal", "deserto_espectral"],
};

export function generateWorld(seed: string, versao = "v1"): WorldState {
  const baseSeed = hashSeed(seed || "mud-seed");
  const rng = mulberry32(baseSeed);

  const rooms: Room[] = [];
  const salaInicial: Room = {
    id: "sala_inicial",
    nome: "Vestibulo Ecoante",
    biome: "cripta",
    tipo: "santuario",
    dificuldade: 1,
    mobs: [],
    conexoes: [],
  };

  rooms.push(salaInicial);

  // clusters por bioma
  let roomId = 0;
  for (const biome of BIOMES) {
    const clusterRooms: Room[] = [];
    for (let i = 0; i < 2; i++) {
      const tipoPool: RoomType[] = ["hostil", "hostil", "horda", "desafio"];
      const roomTipo = pick(tipoPool, rng);
      clusterRooms.push(createRoom(`sala_${biome.id}_${roomId++}`, biome.id, roomTipo, biome.tier, rng));
    }
    // conectar cluster internamente
    for (let i = 0; i < clusterRooms.length - 1; i++) {
      addConnection(clusterRooms[i], clusterRooms[i + 1], `trilha_${biome.id}_${i}`);
    }
    rooms.push(...clusterRooms);
  }

  // conexoes dentro do mesmo bioma para 2-3 caminhos
  for (const room of rooms) {
    if (room.id === "sala_inicial") continue;
    const siblings = rooms.filter((r) => r.biome === room.biome && r.id !== room.id);
    while (room.conexoes.length < 2 && siblings.length) {
      const target = pick(siblings, rng);
      if (target.conexoes.length < 3) addConnection(room, target, `caminho_${room.id}_${target.id}`);
      else break;
    }
  }

  // conexoes entre biomas respeitando proximidade de tom/tier
  for (const room of rooms) {
    if (room.id === "sala_inicial") continue;
    const allowed = BIOME_LINKS[room.biome] ?? [];
    const candidates = rooms.filter((r) => allowed.includes(r.biome) && r.id !== room.id);
    if (candidates.length && rng() > 0.4) {
      const target = pick(candidates, rng);
      addConnection(room, target, `trilha_${room.id}_${target.id}`);
    }
  }

  // conectar sala inicial a cripta/pantano
  const starts = rooms.filter((r) => r.biome === "cripta" || r.biome === "pantano").slice(0, 2);
  for (const start of starts) {
    addConnection(salaInicial, start, `entrada_${start.id}`);
  }

  // marcar algumas conexoes como secretas
  const totalSecretas = Math.max(2, Math.floor(rooms.length * 0.25));
  let countSecretas = 0;
  for (const room of rooms) {
    for (const conn of room.conexoes) {
      if (countSecretas >= totalSecretas) break;
      if (conn.secreta) continue;
      if (rng() > 0.8 && conn.target !== "sala_inicial") {
        conn.secreta = true;
        // marcar reciprocidade
        const targetRoom = rooms.find((r) => r.id === conn.target);
        const back = targetRoom?.conexoes.find((c) => c.target === room.id);
        if (back) back.secreta = true;
        countSecretas++;
      }
    }
    if (countSecretas >= totalSecretas) break;
  }

  return {
    seed,
    criadoEm: Date.now(),
    salas: Object.fromEntries(rooms.map((r) => [r.id, r])),
    salaInicial: salaInicial.id,
    versao,
  };
}
