import { BIOMES, PASSIVES, BASE_CLASSES, ESSENCES } from "../data";
import { getItem as fetchItem } from "../state/itemCatalog";
import {
  Player,
  CommandResult,
  Room,
  RoomState,
  WorldState,
  ItemSlot,
  InventoryItem,
  DropEntry,
  Skill,
  TomeOption,
  Attribute,
  AnomalyType,
  Anomaly,
  StatusId,
} from "../types";
import { attemptFlee, performSkill, mobActionTick } from "../systems/combat";
import { MOBS } from "../data/mobs";
import { LINEAGES } from "../data/lineages";
import { RACES } from "../data/races";
import { applyIdentity } from "../state/playerState";
import { EQUIP_SKILLS } from "../data/equipSkills";
import { fetchGlobalChat, listPresence, publishGlobalChat } from "../state/presence";
import { getSkill, SKILLS } from "../data/skills";
import { ITEMS as ITEM_CATALOG } from "../data/items";
import { parseUseSkill } from "../systems/parser";
import { RECIPES } from "../data/recipes";
import { ARCHETYPES } from "../data/archetypes";
import { MUTATIONS } from "../data/mutations";
import crypto from "crypto";

function classSkillIds(classId: string): string[] {
  const cls = BASE_CLASSES.find((c) => c.id === classId);
  return cls?.habilidades ?? [];
}

type HandleInput = {
  command: string;
  player: Player;
  world: WorldState;
  room: Room;
  roomState: RoomState;
};

function findBiomeName(id: string) {
  return BIOMES.find((b) => b.id === id)?.nome ?? id;
}

function describeRoom(room: Room, player: Player, roomState: RoomState): string[] {
  const visible: string[] = [];
  visible.push(`Sala: ${room.nome} (${findBiomeName(room.biome)}) tipo=${room.tipo}`);
  const risk = Math.max(room.dificuldade, (roomState.deathCount ?? 0) > 0 ? room.dificuldade + 1 : room.dificuldade);
  if (roomState.deathCount && roomState.deathCount > 0) {
    visible.push(`Perigo elevado: mortes aqui (${roomState.deathCount}), risco aprox ${risk}.`);
  } else {
    visible.push(`Risco estimado: ${risk}`);
  }
  const mobsInfo = formatMobs(roomState, player);
  visible.push(mobsInfo);
  if (roomState.loot && roomState.loot.length) {
    visible.push(`Loot no chao (livre para qualquer jogador): ${roomState.loot.map((l) => `${l.itemId} x${l.qtd}`).join(", ")}`);
  }
  const deadMobs = roomState.mobs.filter((m) => !m.alive);
  if (deadMobs.length) {
    const corpses = deadMobs
      .map((m) => MOBS.find((mm) => mm.id === m.mobId)?.nome ?? m.mobId)
      .slice(0, 3)
      .join(", ");
    visible.push(`Voce ve corpos: ${corpses}${deadMobs.length > 3 ? "..." : ""}`);
  }
  if (player.ultimaMorte && player.ultimaMorte === room.id) {
    visible.push("Marcas da sua morte anterior ainda estao aqui.");
  }

  const conexoesVisiveis = room.conexoes.filter((c) => !c.secreta || player.revelados.includes(c.id));
  visible.push(
    `Caminhos: ${conexoesVisiveis
      .map((c, idx) => `[${idx + 1}] ${c.label} -> ${c.target}${c.secreta ? " (secreto)" : ""}`)
      .join(" | ") || "nenhum"}`
  );
  return visible;
}

function ensureAnomaly(room: Room, roomState: RoomState) {
  if (roomState.anomalies && roomState.anomalies.length) return;
  // chance pequena
  const chance = room.tipo === "desafio" ? 0.2 : 0.1;
  if (Math.random() > chance) return;
  const possible: AnomalyType[] = ["estatua_deusa", "parasita_abissal", "rio_misterioso"];
  const tipo = possible[Math.floor(Math.random() * possible.length)];
  const anom: Anomaly = { id: crypto.randomUUID(), tipo, resolvida: false };
  roomState.anomalies = [anom];
}

function formatMobs(roomState: RoomState, player: Player): string {
  if (!roomState.mobs.length) return "Sem inimigos visiveis.";
  const lines = roomState.mobs.map((m, idx) => {
    const mob = MOBS.find((mm) => mm.id === m.mobId);
    const furtivo = mob?.furtivo;
    const detect = player.stats.sub.percepcao >= 3 || player.essencias.includes("areia_sussurrante");
    if (furtivo && !detect) return `?${idx + 1}: algo se move nas sombras...`;
    const mark = player.selectedTarget === m.id ? "*" : "";
    const saque = m.power && m.power > 0 ? " (saqueado)" : "";
    return `${mark}${idx + 1}:${mob?.nome ?? m.mobId} HP:${Math.max(0, m.hp)}${saque}`;
  });
  return `Inimigos: ${lines.join(" | ")}`;
}

function resolveTarget(roomState: RoomState, arg?: string): string | null {
  const alive = roomState.mobs.filter((m) => m.alive);
  if (!alive.length) return null;
  if (!arg) return alive.length === 1 ? alive[0].id : null;

  // por id direto
  const direct = alive.find((m) => m.id === arg);
  if (direct) return direct.id;

  // por indice
  const idx = parseInt(arg, 10);
  if (!Number.isNaN(idx) && idx > 0 && idx <= alive.length) {
    return alive[idx - 1].id;
  }

  // por nome parcial do mob
  const matches = alive.filter((m) => {
    const meta = MOBS.find((mm) => mm.id === m.mobId);
    const name = meta?.nome?.toLowerCase() ?? "";
    return name.includes(arg.toLowerCase()) || m.mobId.toLowerCase().includes(arg.toLowerCase());
  });
  if (matches.length === 1) return matches[0].id;

  return null;
}

function availableSkills(player: Player): Skill[] {
  const classe = BASE_CLASSES.find((c) => c.id === player.classeBase);
  const classSkills = (classe?.habilidades ?? []).map((id) => getSkill(id)).filter(Boolean) as Skill[];
  const equipSkills: Skill[] = [];
  for (const slot of Object.keys(player.equipamento) as ItemSlot[]) {
    const id = player.equipamento[slot];
    if (id && EQUIP_SKILLS[id]) equipSkills.push(EQUIP_SKILLS[id]);
  }
  const unlocked = new Set(player.skillsDesbloqueadas ?? []);
  const classUnlocked = classSkills.filter((s) => unlocked.has(s.id));
  const equipUnlocked = equipSkills; // sempre disponiveis se equipados
  return transformSkillsForPlayer(player, [...classUnlocked, ...equipUnlocked]);
}

function starterSkillPoolIds() {
  const equipSkillIds = new Set(Object.values(EQUIP_SKILLS).map((s) => s.id));
  return (
    [
      "cutilada",
      "bloqueio",
      "investida",
      "finta",
      "golpe_duplo",
      "arremesso_faca",
      "chute_baixo",
      "golpe_circular",
      "tiro_pedra",
      "tiro_rapido",
      "bash_escudo",
      "cajado_golpe",
    ] as string[]
  )
    .filter((id) => !!getSkill(id))
    .filter((id) => !equipSkillIds.has(id)); // evita skills vindas de item no starter
}

function starterItemPoolIds() {
  return ITEM_CATALOG.filter((i) => i.starter && i.tipo !== "material" && i.tipo !== "consumivel").map((i) => i.id);
}

function transformSkillsForPlayer(player: Player, skills: Skill[]): Skill[] {
  const transformed: Skill[] = [];
  for (const skill of skills) {
    let current: Skill | undefined = skill;
    if (skill.variantes && skill.variantes.length) {
      const v = skill.variantes.find(
        (va) => (va.lineage && va.lineage === player.lineage) || (va.race && va.race === player.race)
      );
      if (v) {
        const mutated = getSkill(v.mutateTo);
        if (mutated) current = mutated;
      }
    }
    if (current) transformed.push(current);
  }
  // remove duplicados mantendo o primeiro
  const seen = new Set<string>();
  const uniq = transformed.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  return uniq;
}

function deriveArquetipo(player: Player): string {
  const skills = availableSkills(player);
  const hasTag = (tag: string) => skills.some((s) => s.tags?.includes(tag));
  const arma = player.equipamento?.arma;
  const armadura = player.equipamento?.armadura;
  const lineage = player.lineage;
  const ess = new Set(player.essencias);
  const tags: string[] = [];
  if (arma === "arco_rudimentar" || arma === "funda_singela" || hasTag("distancia")) tags.push("arqueiro");
  if (arma === "cajado_simples" || hasTag("arcano")) tags.push("conjurador");
  if (arma === "martelo_pesado" || arma === "clava_crua" || arma === "espada_enferrujada" || hasTag("fisico")) tags.push("brutamonte");
  if (armadura === "escudo_improvisado" || hasTag("defesa") || hasTag("controle")) tags.push("guardiao");
  if (lineage === "tecnologica" || hasTag("choque") || hasTag("drone")) tags.push("tecno");
  if (lineage === "cosmica" || hasTag("arcano")) tags.push("runico");
  if (hasTag("veneno")) tags.push("venenista");
  if (ess.has("fenda_latente") || hasTag("sombrio")) tags.push("corrompido");
  // arquétipos desbloqueados
  if (player.arquetipos?.length) tags.push(...player.arquetipos);
  if (!tags.length) return "errante";
  return tags.join(" ");
}

function applyIdleThreat(player: Player, room: Room, roomState: RoomState, log: string[]) {
  const now = Date.now();
  const delta = now - (player.lastActionAt ?? now);
  if (delta < 12000) return;
  const mobsAlive = roomState.mobs.filter((m) => m.alive);
  if (!mobsAlive.length) return;
  const target = mobsAlive[Math.floor(Math.random() * mobsAlive.length)];
  const mobData = MOBS.find((m) => m.id === target.mobId);
  if (!mobData) return;
  let dmg = Math.floor((mobData.dano[0] + mobData.dano[1]) / 2);
  const shield = player.status?.shield ?? 0;
  let absorb = 0;
  if (shield > 0) {
    absorb = Math.min(shield, dmg);
    dmg -= absorb;
    player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), shield: shield - absorb };
  }
  player.hp = Math.max(0, player.hp - dmg);
  log.push(`Inimigo ${mobData.nome} te atinge enquanto voce hesita. Dano ${dmg}${absorb ? ` (escudo absorveu ${absorb})` : ""}.`);
}

function checkStealthAmbush(player: Player, roomState: RoomState, log: string[]) {
  const percepcao = player.stats.sub.percepcao;
  for (const m of roomState.mobs) {
    const mobData = MOBS.find((mm) => mm.id === m.mobId);
    if (!mobData?.furtivo || !m.alive) continue;
    const detect = percepcao >= 3 || player.essencias.includes("areia_sussurrante");
    if (detect) continue;
    if (Math.random() < 0.25) {
      const avg = Math.floor((mobData.dano[0] + mobData.dano[1]) / 2);
      player.hp = Math.max(0, player.hp - avg);
      log.push(`${mobData.nome} embosca voce das sombras! Dano ${avg}.`);
    }
  }
}

function handleDeath(player: Player, roomState: RoomState, world: WorldState, log: string[]) {
  const loot: InventoryItem[] = roomState.loot ?? [];
  const dropCount = Math.ceil(player.inventario.length / 2);
  const dropped = player.inventario.slice(0, dropCount);
  for (const item of dropped) {
    const existing = loot.find((l) => l.itemId === item.itemId && l.ownerId === player.id);
    if (existing) existing.qtd += item.qtd;
    else loot.push({ ...item, ownerId: player.id });
  }
  roomState.loot = loot;
  roomState.deathCount = (roomState.deathCount ?? 0) + 1;
  player.inventario = player.inventario.slice(dropCount);
  player.hp = player.stats.maxHp;
  player.stamina = player.stats.maxStamina;
  player.localizacao = world.salaInicial;
  player.selectedTarget = null;
  player.ultimaMorte = roomState.roomId;
  log.push("Voce caiu e desperta no vestibulo. Parte do seu inventario ficou na sala anterior e pode ser saqueada por outros jogadores.");
}

function trackDiscovery(player: Player, room: Room, roomState: RoomState | null, log: string[]) {
  if (!player.catalogo.biomasVisitados.includes(room.biome)) {
    player.catalogo.biomasVisitados.push(room.biome);
    log.push(`Novo bioma registrado: ${room.biome}`);
  }
  if (!player.visitados?.includes(room.id)) {
    player.visitados = [...(player.visitados ?? []), room.id];
  }
  const mobIds = (roomState?.mobs ?? []).map((m) => m.mobId).concat(room.mobs);
  for (const id of mobIds) {
    if (id && !player.catalogo.mobsVistos.includes(id)) {
      player.catalogo.mobsVistos.push(id);
    }
  }
}

function xpNeededFor(_level: number) {
  // preferimos um ritmo fixo de 5 XP por nível
  return 5;
}

function levelUpIfNeeded(player: Player, log: string[]) {
  while (player.xp >= xpNeededFor(player.nivel)) {
    player.xp -= xpNeededFor(player.nivel);
    player.nivel += 1;
    player.slotsEssencia = Math.min(6, player.slotsEssencia + 1);
    player.pontosDisponiveis = (player.pontosDisponiveis ?? 0) + 1;
    player.stats.maxHp += 4;
    player.stats.maxStamina += 3;
    if (player.essencias.includes("nucleo_tecnomantico")) {
      player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), droneCharges: 1 };
      log.push("Seu nucleo reativa um drone ao subir de nivel.");
    }
    log.push(`Level up! Nivel ${player.nivel}. Slot de essencia +1, pontos disponiveis +1.`);
    // gerar escolhas de tomos (3 opções) com +1/-1 atributos
    const tomos: TomeOption[] = [];
    const attrs: Attribute[] = ["forca", "agilidade", "vigor", "mente", "sorte", "sangue", "foco"];
    for (let i = 0; i < 3; i++) {
      const bonusAttr = attrs[Math.floor(Math.random() * attrs.length)];
      let malusAttr = attrs[Math.floor(Math.random() * attrs.length)];
      if (malusAttr === bonusAttr) {
        malusAttr = attrs[(attrs.indexOf(bonusAttr) + 1) % attrs.length];
      }
      tomos.push({
        id: `tomo_${player.nivel}_${i}_${Date.now()}`,
        bonus: { [bonusAttr]: 1 } as Partial<Record<Attribute, number>>,
        malus: { [malusAttr]: -1 } as Partial<Record<Attribute, number>>,
        desc: `+1 ${bonusAttr}, -1 ${malusAttr}`,
      });
    }
    player.pendingTomes = tomos;
    log.push("Voce ganhou um Tomo de Caracteristicas. Escolha um com 'tomo <id>':");
    tomos.forEach((t) => log.push(`${t.id}: ${t.desc}`));
  }
}

function maybeRevealSecrets(room: Room, player: Player): string[] {
  const log: string[] = [];
  for (const conn of room.conexoes) {
    if (!conn.secreta) continue;
    const already = player.revelados.includes(conn.id);
    if (already) continue;
    const chance = player.stats.sub.percepcao + player.stats.atributos.sorte * 0.1;
    if (chance > 2.5 || Math.random() < chance / 10) {
      player.revelados.push(conn.id);
      log.push(`Voce pressente um caminho oculto: ${conn.label}`);
    }
  }
  return log;
}

function handleStats(player: Player): string[] {
  const lines: string[] = [];
  const arqu = deriveArquetipo(player);
  lines.push(`Lv ${player.nivel} ${arqu} (${player.race}) | Linhagem ${player.lineage} | XP ${player.xp}`);
  const a = player.stats.atributos;
  lines.push(`Atributos -> FOR:${a.forca} AGI:${a.agilidade} VIG:${a.vigor} MEN:${a.mente} SOR:${a.sorte} SAN:${a.sangue} FOC:${a.foco}`);
  const s = player.stats.sub;
  lines.push(
    `Sub -> Peso:${s.pesoSuportado} ResFis:${s.resFisica} ResEt:${s.resEterea} Vel:${s.velocAtaque} RegenSta:${s.regenStamina} AfinEss:${s.afinidadeEssencia} Perc:${s.percepcao}`
  );
  lines.push(
    `Recursos -> HP:${player.hp}/${player.stats.maxHp} STA:${player.stamina}/${player.stats.maxStamina} SlotsEss:${player.slotsEssencia} Ouro:${player.ouro} Corrupcao:${player.corrupcao}% Escudo:${player.status?.shield ?? 0} Drone:${player.status?.droneCharges ?? 0}`
  );
  lines.push(`Passivas: ${player.passivas.join(", ") || "nenhuma"}`);
  lines.push(`Essencias: ${player.essencias.join(", ") || "nenhuma"}`);
  return lines;
}

function handlePassives(player: Player): string[] {
  return player.passivas.map((id) => {
    const p = PASSIVES.find((pp) => pp.id === id);
    if (!p) return id;
    return `${p.nome} [${p.raridade}] - ${p.descricao}`;
  });
}

function handleEssences(player: Player): string[] {
  if (!player.essencias.length) return ["Nenhuma essencia ativa."];
  return player.essencias.map((id) => {
    const e = ESSENCES.find((ee) => ee.id === id);
    return e ? `${e.nome} (${e.raridade}) - ${e.efeito}` : id;
  });
}

function handleBestiary(player: Player): string[] {
  const lines: string[] = [];
  lines.push(`Mobs vistos (${player.catalogo.mobsVistos.length}): ${player.catalogo.mobsVistos.join(", ") || "nenhum"}`);
  lines.push(`Mobs derrotados (${player.catalogo.mobsDerrotados.length}): ${player.catalogo.mobsDerrotados.join(", ") || "nenhum"}`);
  if (!player.catalogo.mobsVistos.length && !player.catalogo.mobsDerrotados.length) {
    lines.push("Explore biomas para registrar criaturas.");
  }
  return lines;
}

function handleCatalogo(kind: string): string[] {
  switch (kind) {
    case "classes":
      return BASE_CLASSES.map((c) => `${c.id}: ${c.nome} -> ${c.habilidades.join(", ")}`);
    case "skills":
      return SKILLS.map((s) => `${s.id}: ${s.nome} (${s.categoria ?? "geral"}/${s.raridade ?? "comum"})`);
    case "itens":
      return ITEM_CATALOG.map((i) => `${i.id}: ${i.nome} (${i.tipo}/${i.raridade})`);
    case "essencias":
      return ESSENCES.map((e) => `${e.id}: ${e.nome} (${e.raridade})`);
    default:
      return ["Use catalogo classes|skills|itens|essencias"];
  }
}

function handleAnomalyAction(player: Player, room: Room, roomState: RoomState, log: string[], anomalyId: string, opcao: string) {
  const anomaly = roomState.anomalies?.find((a) => a.id === anomalyId && !a.resolvida);
  if (!anomaly) {
    log.push("Nenhuma anomalia correspondente ou ja resolvida.");
    return;
  }
  switch (anomaly.tipo) {
    case "estatua_deusa": {
      if (opcao === "orar") {
        const bless = Math.random() < 0.6;
        if (bless) {
          player.stats.atributos.sorte += 1;
          player.passivas.push("manto_espectral");
          log.push("Uma luz envolve voce. Sorte +1 e uma bençao espectral emerge.");
        } else {
          player.corrupcao = Math.min(100, player.corrupcao + 5);
          log.push("A deusa silencia. Voce sente um arrepio (corrupcao +5).");
        }
      } else if (opcao === "quebrar") {
        const drop = Math.random() < 0.5 ? "essencia_dungeon" : "parasita_abissal";
        addToInventory(player, { itemId: drop, qtd: 1 });
        log.push(`A estatua se despedaça. Dentro havia ${drop}.`);
        player.corrupcao = Math.min(100, player.corrupcao + 3);
      } else {
        log.push("Voce ignora a estatua. Nada acontece.");
      }
      anomaly.resolvida = true;
      break;
    }
    case "parasita_abissal": {
      if (opcao === "guardar") {
        addToInventory(player, { itemId: "parasita_abissal", qtd: 1 });
        log.push("Voce guarda o parasita em um frasco.");
      } else if (opcao === "inserir") {
        player.essencias.push("fenda_latente");
        player.corrupcao = Math.min(100, player.corrupcao + 10);
        log.push("O parasita se funde ao seu corpo... Corrupcao aumenta, mas algo desperta (essencia fenda_latente).");
      } else if (opcao === "destruir") {
        player.ouro += 10;
        log.push("Parasita destruido. Voce coleta partes vendaveis (ouro +10).");
      }
      anomaly.resolvida = true;
      break;
    }
    case "rio_misterioso": {
      if (opcao === "beber") {
        const good = Math.random() < 0.5;
        if (good) {
          player.stats.atributos.vigor += 1;
          log.push("A agua renova suas forcas (vigor +1).");
        } else {
          const cond = player.conditions ?? ({} as Record<StatusId, number>);
          cond.veneno = Math.max(cond.veneno ?? 0, 2);
          player.conditions = cond;
          log.push("A agua estava contaminada. Voce se sente envenenado.");
        }
      } else if (opcao === "pescar") {
        const found = Math.random() < 0.4;
        if (found) {
          addToInventory(player, { itemId: "fragmento_miragem", qtd: 1 });
          log.push("Algo brilha na agua: fragmento de miragem encontrado.");
        } else {
          log.push("Nada fisgado, apenas silencio das aguas.");
        }
      } else {
        log.push("Voce observa o rio e segue adiante.");
      }
      anomaly.resolvida = true;
      break;
    }
    default:
      log.push("Nada acontece.");
  }
}

function listSkills(player: Player): string[] {
  const skills = availableSkills(player);
  if (!skills.length) return ["Nenhuma habilidade disponivel."];
  const now = Date.now();
  return skills.map((h) => {
    const last = player.skillCooldowns?.[h.id] ?? 0;
    const cdLeft = h.cooldownMs ? Math.max(0, h.cooldownMs - (now - last)) : 0;
    const cdStr = h.cooldownMs ? `CD ${Math.ceil(cdLeft / 1000)}s` : "sem CD";
    const cat = h.categoria ?? "geral";
    const rar = h.raridade ?? "comum";
    return `${h.id}: ${h.nome} [${cat}/${rar}] (STA ${h.custoStamina}, ${cdStr}) - ${h.descricao}`;
  });
}

function handleInventory(player: Player): string[] {
  if (!player.inventario.length) return ["Inventario vazio."];
  return player.inventario.map((slot) => {
    const item = fetchItem(slot.itemId);
    const efeitos = item?.efeitos?.join("; ") ?? "efeitos desconhecidos";
    return `${item?.nome ?? slot.itemId} x${slot.qtd} (${item?.tipo ?? "?"}, peso ${item?.peso ?? "?"}) -> ${efeitos}`;
  });
}

function handleEquipment(player: Player): string[] {
  const lines: string[] = [];
  for (const slot of ["arma", "armadura", "trinket"] as ItemSlot[]) {
    const id = player.equipamento[slot];
    const item = id ? fetchItem(id) : null;
    lines.push(`${slot.toUpperCase()}: ${item ? item.nome : "nenhum"}`);
  }
  return lines;
}

function rollDrops(dropTable: DropEntry[]): InventoryItem[] {
  const loot: InventoryItem[] = [];
  for (const entry of dropTable) {
    if (Math.random() < entry.chance) {
      loot.push({ itemId: entry.id, qtd: 1 });
    }
  }
  return loot;
}

function addToInventory(player: Player, drop: InventoryItem) {
  const existing = player.inventario.find((i) => i.itemId === drop.itemId);
  if (existing) {
    existing.qtd += drop.qtd;
  } else {
    player.inventario.push({ itemId: drop.itemId, qtd: drop.qtd });
  }
}

const SKILL_AMMO: Record<string, { ammoId: string; qtd: number }> = {
  tiro_arco: { ammoId: "flecha_bruta", qtd: 1 },
  tiro_rapido: { ammoId: "flecha_bruta", qtd: 1 },
  tiro_runico: { ammoId: "flecha_bruta", qtd: 1 },
  flecha_envenenada: { ammoId: "flecha_bruta", qtd: 1 },
  chuva_flechas: { ammoId: "flecha_bruta", qtd: 3 },
  arremesso_faca: { ammoId: "faca_lancavel", qtd: 1 },
};

function consumeAmmo(player: Player, skillId: string): { ok: boolean; ammoId?: string; need?: number } {
  const entry = SKILL_AMMO[skillId];
  if (!entry) return { ok: true };
  const { ammoId, qtd } = entry;
  const stack = player.inventario.find((i) => i.itemId === ammoId && i.qtd >= qtd);
  if (!stack) return { ok: false, ammoId, need: qtd };
  stack.qtd -= qtd;
  if (stack.qtd <= 0) {
    player.inventario = player.inventario.filter((i) => i.qtd > 0);
  }
  return { ok: true, ammoId };
}

function spendMaterial(player: Player, options: string[], qtd = 1): { ok: boolean; used?: string } {
  for (const opt of options) {
    const stack = player.inventario.find((i) => i.itemId === opt && i.qtd >= qtd);
    if (stack) {
      stack.qtd -= qtd;
      if (stack.qtd <= 0) {
        player.inventario = player.inventario.filter((i) => i.qtd > 0);
      }
      return { ok: true, used: opt };
    }
  }
  return { ok: false };
}

function craftItem(player: Player, target: string, log: string[]): boolean {
  const recipe = RECIPES.find((r) => r.id === target);
  if (!recipe) {
    log.push("Receita desconhecida. Use 'craft help' ou 'pesquisar <item>'.");
    return false;
  }
  if (recipe.requisitoPassiva && !player.passivas.includes(recipe.requisitoPassiva)) {
    log.push("Voce nao possui a passiva necessaria para esta receita.");
    return false;
  }
  if (recipe.requisitoLinhagem && player.lineage !== recipe.requisitoLinhagem) {
    log.push("Sua linhagem nao permite esta receita.");
    return false;
  }
  // checa materiais
  for (const inp of recipe.inputs) {
    const stack = player.inventario.find((i) => i.itemId === inp.itemId && i.qtd >= inp.qtd);
    if (!stack) {
      log.push(`Falta ${inp.itemId} x${inp.qtd}.`);
      return false;
    }
  }
  // consome
  for (const inp of recipe.inputs) {
    const stack = player.inventario.find((i) => i.itemId === inp.itemId);
    if (stack) {
      stack.qtd -= inp.qtd;
    }
  }
  player.inventario = player.inventario.filter((i) => i.qtd > 0);
  // produz
  for (const out of recipe.outputs) {
    addToInventory(player, { itemId: out.itemId, qtd: out.qtd });
    log.push(`Craft: ${out.itemId} x${out.qtd}`);
  }
  // marca descoberta
  if (!player.recipesDescobertas?.includes(recipe.id)) {
    player.recipesDescobertas = [...(player.recipesDescobertas ?? []), recipe.id];
    log.push(`Receita registrada: ${recipe.nome}.`);
  }
  return true;
}

function applyConsumable(player: Player, item: ReturnType<typeof fetchItem>, log: string[]) {
  if (!item) return;
  switch (item.id) {
    case "frasco_cura": {
      const heal = 20;
      const before = player.hp;
      player.hp = Math.min(player.stats.maxHp, player.hp + heal);
      log.push(`Voce usa ${item.nome} e recupera ${player.hp - before} HP.`);
      break;
    }
    case "tonico_foco": {
      const rec = 15;
      const before = player.stamina;
      player.stamina = Math.min(player.stats.maxStamina, player.stamina + rec);
      log.push(`Voce bebe ${item.nome} e recupera ${player.stamina - before} Estamina. Casts custam menos temporariamente.`);
      break;
    }
    default: {
      log.push(`${item.nome} ainda nao tem efeito implementado.`);
      break;
    }
  }
}

function handleHelp(): string[] {
  return [
    "Comandos: olhar/look | ir/go <numero/rota> | settarget <id> | inspecionar/inspect <id> | skills | useskill <id> | fugir/flee | status | inventario | loot | equipar <itemId> | usar/use <itemId> | craft <id|help> | pesquisar <item|ambiente> | acao <anomaliaId> <opcao> | catalogo <classes|skills|itens|essencias> | absorver/absorb <essenciaId> | purificar/purge <essenciaId> | mapa/map | passivas | essencias | bestiario | tomo <id> (escolha de level up) | descanso/rest | starter <skill1> <skill2> <item> | ajuda/help",
    "Look revela caminhos, percepcao pode expor rotas secretas.",
    "Attack usa estamina e considera peso. Flee tenta sair rapido.",
    "Use para consumiveis; absorb/purge gerenciam essencias (limitado por slots). Map lista salas visitadas.",
    "settarget <idx|id> escolhe alvo. skills lista habilidades da classe/arma. useskill <id> usa habilidade no alvo.",
    "Dica: use loot para pegar itens no chao; se morrer, parte do inventario fica na sala (mais mobs se acumulam).",
  ];
}

function maybeAutoUnlockReflex(player: Player, log: string[]) {
  const agil = player.stats.atributos.agilidade;
  const perc = player.stats.sub.percepcao;
  if (player.passivas.includes("reflexo_instintivo")) return;
  if (agil >= 7 && perc >= 3) {
    player.passivas.push("reflexo_instintivo");
    log.push("Seus reflexos se aguçam: nova passiva 'Reflexo Instintivo' adquirida.");
  }
}

function ensureDynamicArchetypes(player: Player, log: string[]) {
  const hasTagSkill = (tag: string) => availableSkills(player).some((s) => s.tags?.includes(tag));
  const unlockSkills = (ids: string[], label: string) => {
    const newly: string[] = [];
    ids.forEach((id) => {
      if (!player.skillsDesbloqueadas?.includes(id)) {
        player.skillsDesbloqueadas = [...(player.skillsDesbloqueadas ?? []), id];
        newly.push(id);
      }
    });
    if (newly.length) log.push(`${label}: novas skills ${newly.join(", ")}`);
  };

  for (const arc of ARCHETYPES) {
    if (player.arquetipos?.includes(arc.id)) continue;
    if (arc.linhagem && arc.linhagem !== player.lineage) continue;
    if (arc.attrsMin) {
      const okAttr = Object.entries(arc.attrsMin).every(([k, v]) => {
        // @ts-ignore
        const val = player.stats.atributos[k] ?? player.stats.sub?.[k];
        return val !== undefined && val >= (v as number);
      });
      if (!okAttr) continue;
    }
    if (arc.tagsNecessarias && !arc.tagsNecessarias.every((t) => hasTagSkill(t))) continue;
    if (arc.equipObrigatorio && !arc.equipObrigatorio.every((eq) => Object.values(player.equipamento).includes(eq))) continue;
    if (arc.essencias && !arc.essencias.every((e) => player.essencias.includes(e))) continue;

    player.arquetipos = [...(player.arquetipos ?? []), arc.id];
    if (arc.skillsDesbloqueadas?.length) unlockSkills(arc.skillsDesbloqueadas, `Arquétipo ${arc.nome}`);
    if (arc.passivas?.length) {
      arc.passivas.forEach((p) => {
        if (!player.passivas.includes(p)) player.passivas.push(p);
      });
      log.push(`Arquétipo ${arc.nome}: novas passivas ${arc.passivas.join(", ")}`);
    }
    if (arc.bonus) {
      for (const [k, v] of Object.entries(arc.bonus)) {
        // @ts-ignore
        player.stats.atributos[k] = (player.stats.atributos[k] || 0) + (v ?? 0);
      }
    }
    if (arc.malus) {
      for (const [k, v] of Object.entries(arc.malus)) {
        // @ts-ignore
        player.stats.atributos[k] = (player.stats.atributos[k] || 0) + (v ?? 0);
      }
    }
    log.push(`Arquétipo desbloqueado: ${arc.nome}.`);
  }

  // mutações: se encontrar essências gatilho e ainda não tem mutação
  if (!player.mutacao) {
    for (const mut of MUTATIONS) {
      if (mut.gatilhoEssencias && !mut.gatilhoEssencias.every((e) => player.essencias.includes(e))) continue;
      player.mutacao = mut.id;
      if (mut.skills) unlockSkills(mut.skills, `Mutacao ${mut.nome}`);
      if (mut.passivas) {
        mut.passivas.forEach((p) => {
          if (!player.passivas.includes(p)) player.passivas.push(p);
        });
        log.push(`Mutacao ${mut.nome}: novas passivas ${mut.passivas.join(", ")}`);
      }
      if (mut.bonus) {
        for (const [k, v] of Object.entries(mut.bonus)) {
          // @ts-ignore
          player.stats.atributos[k] = (player.stats.atributos[k] || 0) + (v ?? 0);
        }
      }
      if (mut.malus) {
        for (const [k, v] of Object.entries(mut.malus)) {
          // @ts-ignore
          player.stats.atributos[k] = (player.stats.atributos[k] || 0) + (v ?? 0);
        }
      }
      log.push(`Mutacao adquirida: ${mut.nome}.`);
      break;
    }
  }
}

function dropDungeonEssence(room: Room, roomState: RoomState) {
  if (room.tipo !== "desafio") return;
  const already = roomState.loot?.some((l) => l.itemId === "essencia_dungeon");
  if (already) return;
  const drop = { itemId: "essencia_dungeon", qtd: 1 } as InventoryItem;
  roomState.loot = [...(roomState.loot ?? []), drop];
}

function processMobDeaths(prevAlive: Set<string>, roomState: RoomState, player: Player, log: string[], room: Room) {
  const newlyDead = roomState.mobs.filter((m) => !m.alive && prevAlive.has(m.id));
  for (const mobInst of newlyDead) {
    const mobData = MOBS.find((m) => m.id === mobInst.mobId);
    log.push(`${mobData?.nome ?? mobInst.mobId} sucumbe ao dano continuo.`);
    if (mobData && !player.catalogo.mobsDerrotados.includes(mobData.id)) {
      player.catalogo.mobsDerrotados.push(mobData.id);
      player.xp += 1;
      if (!player.catalogo.biomasVisitados.includes(mobData.biome)) {
        player.catalogo.biomasVisitados.push(mobData.biome);
      }
      log.push(`XP +1 por derrubar ${mobData.nome} via efeito continuo. XP total: ${player.xp}`);
      levelUpIfNeeded(player, log);
    }
    const drops = rollDrops(mobData?.dropTable ?? []);
    if (drops.length) {
      for (const drop of drops) {
        addToInventory(player, drop);
        const itemName = fetchItem(drop.itemId)?.nome ?? drop.itemId;
        log.push(`Loot: ${itemName} x${drop.qtd}`);
      }
    }
    dropDungeonEssence(room, roomState);
  }
}

export async function handleCommand({ command, player, world, room, roomState }: HandleInput): Promise<CommandResult> {
  const log: string[] = [];
  maybeAutoUnlockReflex(player, log);
  ensureDynamicArchetypes(player, log);
  const trimmed = (command || "").trim();
  if (!trimmed) {
    return { log: ["Envie um comando: help para lista."], player, room, roomState };
  }
  const [rawVerb, ...rest] = trimmed.split(/\s+/);
  const aliases: Record<string, string> = {
    olhar: "look",
    ver: "look",
    ir: "go",
    seguir: "go",
    fugir: "flee",
    correr: "flee",
    inventario: "inventory",
    equipar: "equip",
    usar: "use",
    absorver: "absorb",
    purificar: "purge",
    mapa: "map",
    status: "stats",
    habilidades: "skills",
    inspecionar: "inspect",
    identidade: "identity",
    descanso: "rest",
    ajuda: "help",
    falar: "chat",
    say: "chat",
    chat: "chat",
    global: "chat",
    sala: "examine",
    examinar: "examine",
    starter: "starter",
  };
  const verb = aliases[rawVerb.toLowerCase()] ?? rawVerb;

  // parser narrativo para "usar <skill> <alvo?>"
  const parsedUse = parseUseSkill(trimmed, availableSkills(player));
  if (parsedUse) {
    rest.splice(0, rest.length, parsedUse.skillId, ...(parsedUse.target ? [parsedUse.target] : []));
  }

  if (verb === "chat") {
    const msg = rest.join(" ");
    if (!msg) {
      return { log: ["Use chat <mensagem> para falar no canal global."], player, room, roomState };
    }
    const tag = `[GLOBAL ${player.nome ?? player.id.slice(0, 4)}] ${msg}`;
    await publishGlobalChat(tag);
    const recent = await fetchGlobalChat(5);
    return { log: [tag, "Recentes:", ...recent], player, room, roomState };
  }
  if (verb === "who") {
    const players = await listPresence(room.id);
    const others = players.filter((p) => p.id !== player.id);
    if (!others.length) return { log: ["Nenhum outro jogador visivel nesta sala."], player, room, roomState };
    return { log: [`Jogadores na sala: ${others.map((p) => p.nome).join(", ")}`], player, room, roomState };
  }
  if (verb === "starter") {
    if (player.starterEscolhido) {
      return { log: ["Escolha inicial ja realizada."], player, room, roomState };
    }
    if (rest.length < 3) {
      return { log: ["Use starter <skill1> <skill2> <itemId>. Skills basicas: " + starterSkillPoolIds().join(", ") + ". Itens: " + starterItemPoolIds().join(", ")], player, room, roomState };
    }
    const [s1, s2, itemId] = rest;
    const pool = starterSkillPoolIds();
    if (!pool.includes(s1) || !pool.includes(s2) || s1 === s2) {
      return { log: ["Escolha duas skills diferentes do pool inicial."], player, room, roomState };
    }
    const itemPool = starterItemPoolIds();
    if (!itemPool.includes(itemId)) {
      return { log: ["Item inicial invalido. Escolha entre: " + itemPool.join(", ")], player, room, roomState };
    }
    const chosenItem = ITEM_CATALOG.find((i) => i.id === itemId);
    player.skillsDesbloqueadas = Array.from(new Set([...(player.skillsDesbloqueadas ?? []), s1, s2, ...classSkillIds(player.classeBase)]));
    if (chosenItem) {
      addToInventory(player, { itemId: chosenItem.id, qtd: 1 });
      player.equipamento[chosenItem.tipo as ItemSlot] = chosenItem.id;
    }
    player.starterEscolhido = true;
    return { log: [`Starter definido: skills ${s1}, ${s2} e item ${itemId} equipado.`], player, room, roomState };
  }

  if (verb === "identity") {
    if (player.lockedIdentity) {
      return { log: ["Identidade já definida."], player, room, roomState };
    }
    const [lin, rac, cls] = rest;
    if (!lin || !rac || !cls) {
      return { log: ["Use identity <linhagem> <raca> <classe>. Ex: identity tecnologica humano artifice"], player, room, roomState };
    }
    const lineage = LINEAGES.find((l) => l.id === lin);
    const race = RACES.find((r) => r.id === rac);
    const classe = BASE_CLASSES.find((c) => c.id === cls);
    if (!lineage || !race || !classe) {
      return { log: ["Linhagem/Raca/Classe inválidos."], player, room, roomState };
    }
    const updated = applyIdentity(player, lineage.id, classe.id, race.id);
    updated.lockedIdentity = true;
    return {
      log: [`Identidade escolhida: ${race.nome}, ${classe.nome}, ${lineage.nome}.`],
      player: updated,
      room,
      roomState,
    };
  }

  // corrupcao passiva se essencia instavel
  if (player.essencias.includes("fenda_latente") && room.tipo !== "santuario") {
    player.corrupcao = Math.min(100, player.corrupcao + 1);
    log.push("A fenda lateja... sua corrupcao aumenta levemente.");
    if (player.corrupcao > 85) {
      player.hp = Math.max(1, player.hp - 2);
      log.push("A corrupcao corrói sua carne (HP -2).");
    }
  }
  if (player.corrupcao >= 70 && Math.random() < 0.05) {
    const lost = 2;
    player.stamina = Math.max(0, player.stamina - lost);
    log.push("Espasmo de corrupcao drena sua estamina.");
  }

  applyIdleThreat(player, room, roomState, log);
  // efeitos continuos no jogador
  if (player.conditions) {
    const condLog: string[] = [];
    if (player.conditions.veneno || player.conditions.sangramento) {
      const dot = (player.conditions.veneno ? 2 : 0) + (player.conditions.sangramento ? 2 : 0);
      player.hp = Math.max(0, player.hp - dot);
      condLog.push(`Efeitos continuos causam ${dot} de dano em voce.`);
      if (player.conditions.veneno && player.conditions.veneno > 0) player.conditions.veneno -= 1;
      if (player.conditions.sangramento && player.conditions.sangramento > 0) player.conditions.sangramento -= 1;
    }
    // medo reduz chance de evitar contra; silenciado avisa
    if (player.conditions.medo) condLog.push("Voce sente medo e hesita.");
    if (player.conditions.silenciado) condLog.push("Voce esta silenciado, conjurar fica mais dificil.");
    log.push(...condLog);
  }
  if (player.hp <= 0) {
    handleDeath(player, roomState, world, log);
    return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
  }

  switch (verb.toLowerCase()) {
    case "tomo": {
      if (!player.pendingTomes || player.pendingTomes.length === 0) {
        log.push("Nenhum tomo pendente. Suba de nivel para receber novas escolhas.");
        break;
      }
      if (!rest.length) {
        log.push("Use tomo <id>. Opcoes atuais:");
        player.pendingTomes.forEach((t) => log.push(`${t.id}: ${t.desc}`));
        break;
      }
      const choice = player.pendingTomes.find((t) => t.id === rest[0]);
      if (!choice) {
        log.push("Tomo nao encontrado. Veja as opcoes com 'tomo'.");
        break;
      }
      for (const [k, v] of Object.entries(choice.bonus || {})) {
        // @ts-ignore
        player.stats.atributos[k] = (player.stats.atributos[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(choice.malus || {})) {
        // @ts-ignore
        player.stats.atributos[k] = (player.stats.atributos[k] || 0) + v;
      }
      // recalcula hp/stamina max
      player.stats.maxHp = 40 + player.stats.atributos.vigor * 4 + player.stats.atributos.forca;
      player.stats.maxStamina = 30 + player.stats.atributos.vigor * 2 + player.stats.atributos.mente + player.stats.atributos.foco;
      if (player.hp > player.stats.maxHp) player.hp = player.stats.maxHp;
      if (player.stamina > player.stats.maxStamina) player.stamina = player.stats.maxStamina;
      player.pendingTomes = [];
      log.push(`Tomo aplicado: ${choice.desc}.`);
      break;
    }
    case "look":
    case "where": {
      ensureAnomaly(room, roomState);
      trackDiscovery(player, room, roomState, log);
      log.push(...maybeRevealSecrets(room, player));
      log.push(...describeRoom(room, player, roomState));
      {
        const presenceHere = await listPresence(room.id);
        const others = presenceHere.filter((p) => p.id !== player.id);
        log.push(`Jogadores: ${others.length ? others.map((p) => p.nome).join(", ") : "apenas voce"}`);
      }
      checkStealthAmbush(player, roomState, log);
      break;
    }
    case "examine": {
      trackDiscovery(player, room, roomState, log);
      log.push(...describeRoom(room, player, roomState));
      {
        const presenceHere = await listPresence(room.id);
        const others = presenceHere.filter((p) => p.id !== player.id);
        log.push(`Jogadores: ${others.length ? others.map((p) => p.nome).join(", ") : "apenas voce"}`);
      }
      break;
    }
    case "go": {
      if (!rest.length) {
        log.push("Use go/ir <numero ou rota>");
        break;
      }
      const targetArg = rest[0];
      const visible = room.conexoes.filter((c) => !c.secreta || player.revelados.includes(c.id));
      let targetConn: Room | null = null;
      let connLabel = "";
      const index = parseInt(targetArg, 10);
      if (!Number.isNaN(index) && index > 0 && index <= visible.length) {
        connLabel = visible[index - 1].label;
        targetConn = world.salas[visible[index - 1].target];
      } else {
        const match = visible.find((c) => c.label.toLowerCase() === targetArg.toLowerCase() || c.target === targetArg);
        if (match) {
          connLabel = match.label;
          targetConn = world.salas[match.target];
        }
      }
      if (!targetConn) {
        log.push("Caminho invalido ou nao visivel.");
        break;
      }
      player.localizacao = targetConn.id;
      log.push(`Voce segue por ${connLabel} e chega em ${targetConn.nome}.`);
      log.push(...maybeRevealSecrets(targetConn, player));
      trackDiscovery(player, targetConn, null, log);
      const prevAlive = new Set(roomState.mobs.filter((m) => m.alive).map((m) => m.id));
      const tick = mobActionTick(player, roomState);
      log.push(...tick.log);
      processMobDeaths(prevAlive, roomState, player, log, room);
      if (player.hp <= 0) {
        handleDeath(player, roomState, world, log);
        return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
      }
      break;
    }
    case "attack": {
      log.push("Use skills em vez de ataque basico: useSkill <id>.");
      break;
    }
    case "settarget": {
      if (!rest.length) {
        log.push("Use settarget <indice ou id>");
        break;
      }
      const targetId = resolveTarget(roomState, rest[0]);
      if (!targetId) {
        log.push("Alvo nao encontrado.");
        break;
      }
      player.selectedTarget = targetId;
      log.push(`Alvo selecionado: ${targetId}`);
      break;
    }
    case "inspect": {
      if (!rest.length) {
        log.push("Use inspect <indice ou id>");
        break;
      }
      const targetId = resolveTarget(roomState, rest[0]);
      const target = roomState.mobs.find((m) => m.id === targetId);
      if (!target) {
        log.push("Nao localizado.");
        break;
      }
      const mobData = MOBS.find((m) => m.id === target.mobId);
      if (!mobData) {
        log.push("Mob desconhecido.");
        break;
      }
      log.push(`Mob ${mobData.nome} (role ${mobData.role}, nivel ${mobData.nivel}) HP:${target.hp} Efeitos:${mobData.efeitos.join(", ")}`);
      break;
    }
    case "skills": {
      log.push(...listSkills(player));
      break;
    }
    case "useskill": {
      if (!rest.length) {
        log.push("Use useSkill <id>");
        break;
      }
      const skillId = rest[0];
      const skill = availableSkills(player).find(
        (h) => h.id === skillId || h.nome.toLowerCase().includes(skillId.toLowerCase())
      );
    if (!skill) {
      log.push("Skill nao encontrada ou indisponivel.");
      break;
    }
    const now = Date.now();
      const last = player.skillCooldowns?.[skill.id] ?? 0;
      const cd = skill.cooldownMs ?? 0;
    if (cd > 0 && now - last < cd) {
      const remain = Math.ceil((cd - (now - last)) / 1000);
      log.push(`Skill em recarga: ${remain}s restantes.`);
      break;
    }
    const ammoCheck = consumeAmmo(player, skill.id);
    if (!ammoCheck.ok) {
      log.push(`Sem municao (${ammoCheck.ammoId} x${ammoCheck.need ?? 1}). Use craft ${ammoCheck.ammoId} ou encontre mais.`);
      break;
    }
      let targetId = player.selectedTarget ?? undefined;
      if (skill.requerAlvo) {
        const targetArg = rest[1];
        const resolved = resolveTarget(roomState, targetArg);
        if (!targetId && resolved) targetId = resolved;
        if (!targetId && roomState.mobs.filter((m) => m.alive).length === 1) {
          targetId = roomState.mobs.find((m) => m.alive)!.id;
          log.push(`Alvo unico encontrado: ${targetId}`);
        }
        if (!targetId) {
          log.push("Selecione um alvo com settarget ou informe apos a skill: useskill <id> <alvo>.");
          break;
        }
      }
      if (targetId) player.selectedTarget = targetId;
      const prevAlive = new Set(roomState.mobs.filter((m) => m.alive).map((m) => m.id));
      const result = performSkill(player, room, roomState, {
        skillId: skill.id,
        skillBase: skill.baseDano,
        skillCost: skill.custoStamina,
        targetId,
      });
      log.push(...result.log);
      player.skillCooldowns = { ...(player.skillCooldowns ?? {}), [skill.id]: now };
      if (result.killed) {
        const killedMob = result.killed;
        const mobData = MOBS.find((m) => m.id === killedMob.mobId);
        if (mobData && !player.catalogo.mobsDerrotados.includes(mobData.id)) {
          player.catalogo.mobsDerrotados.push(mobData.id);
          player.xp += 1;
          if (!player.catalogo.biomasVisitados.includes(mobData.biome)) {
            player.catalogo.biomasVisitados.push(mobData.biome);
          }
          log.push(`XP +1 por derrotar um novo tipo: ${mobData.nome}. XP total: ${player.xp}`);
          levelUpIfNeeded(player, log);
        }
        const drops = rollDrops(mobData?.dropTable ?? []);
        if (drops.length) {
          for (const drop of drops) {
            addToInventory(player, drop);
            const itemName = fetchItem(drop.itemId)?.nome ?? drop.itemId;
            log.push(`Loot: ${itemName} x${drop.qtd}`);
          }
        }
        dropDungeonEssence(room, roomState);
      }
      const tick = mobActionTick(player, roomState);
      log.push(...tick.log);
      processMobDeaths(prevAlive, roomState, player, log, room);
      if (player.hp <= 0) {
        handleDeath(player, roomState, world, log);
        return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
      }
      break;
    }
    case "flee": {
      const fleeResult = attemptFlee(player, roomState);
      log.push(...fleeResult.log);
      if (fleeResult.success) {
        const exits = room.conexoes.filter((c) => !c.secreta || player.revelados.includes(c.id));
        if (exits.length) {
          const exit = exits[0];
          player.localizacao = exit.target;
          log.push(`Voce corre para ${exit.label}.`);
          trackDiscovery(player, world.salas[player.localizacao], null, log);
          player.selectedTarget = null;
        } else {
          log.push("Sem saidas claras nesta sala!");
        }
      }
      break;
    }
    case "stats": {
      log.push(...handleStats(player));
      break;
    }
    case "map": {
      const visited = player.visitados ?? [];
      const current = player.localizacao;
      const tail = visited.slice(-10);
      log.push(`Salas visitadas (${visited.length}): ${tail.join(", ")}`);
      log.push(`Atual: ${current}`);
      if (player.ultimaMorte) {
        log.push(`Ultima morte: ${player.ultimaMorte}`);
      }
      if (roomState?.deathCount && roomState.deathCount > 0) {
        log.push(`Esta sala ficou mais perigosa: mortes acumuladas aqui ${roomState.deathCount}.`);
      }
      if (roomState?.loot?.length) {
        log.push(`Loot no chao: ${roomState.loot.map((l) => `${l.itemId} x${l.qtd}`).join(", ")}`);
      }
      const exits = room.conexoes.map((c) => {
        const targetRoom = world.salas[c.target];
        const biomeName = targetRoom ? findBiomeName(targetRoom.biome) : "?";
        const risco = targetRoom ? targetRoom.dificuldade : "?";
        return `${c.label} -> ${c.target} [${biomeName}/R${risco}]${visited.includes(c.target) ? " (visitada)" : ""}${c.secreta ? " (secreta)" : ""}`;
      });
      log.push(`Saidas: ${exits.join(" | ")}`);
      break;
    }
    case "inventory": {
      log.push(...handleInventory(player));
      log.push(...handleEquipment(player));
      break;
    }
    case "craft": {
      if (!rest.length) {
        log.push("Use craft <id>, craft help ou pesquisar <item>.");
        break;
      }
      if (rest[0] === "help") {
        const known = player.recipesDescobertas ?? [];
        if (!known.length) {
          log.push("Nenhuma receita descoberta ainda. Use pesquisar <item> ou tente combinar materiais.");
        } else {
          log.push("Receitas descobertas:");
          known.forEach((id) => {
            const r = RECIPES.find((rr) => rr.id === id);
            if (r) log.push(`${r.id}: ${r.nome} -> ${r.outputs.map((o) => `${o.itemId} x${o.qtd}`).join(", ")}`);
          });
        }
        break;
      }
      craftItem(player, rest[0], log);
      break;
    }
    case "acao": {
      if (rest.length < 2) {
        log.push("Use acao <anomaliaId> <opcao>. Ex: acao <id> orar/quebrar/guardar/beber/pescar");
        break;
      }
      const [anomId, opcao] = rest;
      handleAnomalyAction(player, room, roomState, log, anomId, opcao);
      break;
    }
    case "pesquisar": {
      if (!rest.length) {
        log.push("Use pesquisar <item> para receber pistas de crafting.");
        break;
      }
      const itemId = rest[0];
      const hints = RECIPES.filter((r) => r.inputs.some((inp) => inp.itemId === itemId));
      if (!hints.length) {
        log.push("Nenhuma pista encontrada para este item.");
        break;
      }
      hints.forEach((r) => {
        const outros = r.inputs.filter((i) => i.itemId !== itemId);
        log.push(`Talvez ${itemId} combine com ${outros.map((o) => `${o.itemId} x${o.qtd}`).join(" + ")} para formar algo (${r.outputs.map((o) => o.itemId).join(", ")}).`);
      });
      break;
    }
    case "loot": {
      const loot = roomState.loot ?? [];
      if (!loot.length) {
        log.push("Nada para coletar aqui.");
        break;
      }
      for (const item of loot) {
        addToInventory(player, item);
        const meta = fetchItem(item.itemId);
        if (item.ownerId && item.ownerId === player.id) {
          log.push(`Voce recupera ${meta?.nome ?? item.itemId} x${item.qtd} que havia deixado aqui.`);
        } else if (item.ownerId && item.ownerId !== player.id) {
          log.push(`Voce saqueia ${meta?.nome ?? item.itemId} x${item.qtd} que outro jogador perdeu.`);
        } else {
          log.push(`Voce coleta ${meta?.nome ?? item.itemId} x${item.qtd}.`);
        }
      }
      roomState.loot = [];
      break;
    }
    case "use": {
      if (!rest.length) {
        log.push("Use use <itemId>");
        break;
      }
      const targetId = rest[0];
      const invItem = player.inventario.find((i) => i.itemId === targetId && i.qtd > 0);
      const item = invItem ? fetchItem(invItem.itemId) : null;
      if (!item || !invItem) {
        log.push("Item nao encontrado no inventario.");
        break;
      }
      if (item.tipo !== "consumivel") {
        log.push("Apenas consumiveis podem ser usados.");
        break;
      }
      const prevAlive = new Set(roomState.mobs.filter((m) => m.alive).map((m) => m.id));
      if (item.id === "essencia_dungeon") {
        player.masterRoom = room.id;
        roomState.masterId = player.id;
        log.push(`Voce reivindica esta sala como mestre da dungeon. (Sala ${room.nome})`);
      } else {
        applyConsumable(player, item, log);
      }
      invItem.qtd -= 1;
      if (invItem.qtd <= 0) {
        player.inventario = player.inventario.filter((i) => i.qtd > 0);
      }
      const tick = mobActionTick(player, roomState);
      log.push(...tick.log);
      processMobDeaths(prevAlive, roomState, player, log, room);
      if (player.hp <= 0) {
        handleDeath(player, roomState, world, log);
        return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
      }
      break;
    }
    case "bestiario": {
      log.push(...handleBestiary(player));
      break;
    }
    case "catalogo": {
      if (!rest.length) {
        log.push("Use catalogo classes|skills|itens|essencias");
        break;
      }
      log.push(...handleCatalogo(rest[0]));
      break;
    }
    case "absorb": {
      if (!rest.length) {
        log.push("Use absorb <essenciaId>");
        break;
      }
      if (player.essencias.length >= player.slotsEssencia) {
        log.push("Sem slots de essencia livres.");
        break;
      }
      const essId = rest[0];
      const ess = ESSENCES.find((e) => e.id === essId);
      if (!ess) {
        log.push("Essencia desconhecida.");
        break;
      }
      if (player.essencias.includes(ess.id)) {
        log.push("Essencia ja absorvida.");
        break;
      }
      const afinidadeMatch = ess.afinidade.some((a) => player.stats.atributos[a] >= 6 || player.lineage === "sobrenatural");
      const risco = afinidadeMatch ? "absorvida sem corrupcao." : "absorvida, mas voce sente corrupcao leve.";
      if (!afinidadeMatch) {
        player.hp = Math.max(1, player.hp - 5);
        player.corrupcao = Math.min(100, player.corrupcao + 5);
      }
      player.essencias.push(ess.id);
      log.push(`Essencia ${ess.nome} ${risco}`);
      break;
    }
    case "purge": {
      if (!rest.length) {
        log.push("Use purge <essenciaId>");
        break;
      }
      const essId = rest[0];
      if (!player.essencias.includes(essId)) {
        log.push("Essencia nao ativa.");
        break;
      }
      if (player.ouro < 20) {
        log.push("Ouro insuficiente para purge (20 necessario).");
        break;
      }
      const material = spendMaterial(player, ["placa_ossea", "fio_condutivo"]);
      if (!material.ok) {
        log.push("Falta material para ritual de purge (placa_ossea ou fio_condutivo).");
        break;
      }
      player.ouro -= 20;
      player.essencias = player.essencias.filter((e) => e !== essId);
      const custoSta = 10;
      const custoHp = 5;
      player.stamina = Math.max(0, player.stamina - custoSta);
      player.hp = Math.max(1, player.hp - custoHp);
      player.corrupcao = Math.max(0, player.corrupcao - 3);
      log.push(
        `Essencia ${essId} removida. Custo 20 ouro, ${custoSta} STA, ${custoHp} HP e material (${material.used}). Corrupcao agora ${player.corrupcao}%. Slots livres: ${
          player.slotsEssencia - player.essencias.length
        }`
      );
      break;
    }
    case "equip": {
      if (!rest.length) {
        log.push("Use equip <itemId>");
        break;
      }
      const targetId = rest[0];
      const item = ITEM_CATALOG.find((it) => it.id === targetId);
      if (!item) {
        log.push("Item nao encontrado.");
        break;
      }
      if (item.tipo === "material" || item.tipo === "consumivel") {
        log.push("Este item nao pode ser equipado.");
        break;
      }
      const inBag = player.inventario.find((i) => i.itemId === targetId && i.qtd > 0);
      if (!inBag) {
        log.push("Voce nao possui este item.");
        break;
      }
      player.equipamento[item.tipo] = item.id;
      log.push(`Equipou ${item.nome} no slot ${item.tipo}.`);
      const eqSkill = EQUIP_SKILLS[item.id];
      if (eqSkill) {
        log.push(`Nova habilidade disponivel: ${eqSkill.nome} (useSkill ${eqSkill.id}).`);
        if (!player.skillsDesbloqueadas?.includes(eqSkill.id)) {
          player.skillsDesbloqueadas = [...(player.skillsDesbloqueadas ?? []), eqSkill.id];
        }
      }
      const prevAlive = new Set(roomState.mobs.filter((m) => m.alive).map((m) => m.id));
      const tick = mobActionTick(player, roomState);
      log.push(...tick.log);
      processMobDeaths(prevAlive, roomState, player, log, room);
      if (player.hp <= 0) {
        handleDeath(player, roomState, world, log);
        return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
      }
      break;
    }
    case "passivas": {
      log.push(...handlePassives(player));
      break;
    }
    case "essencias": {
      log.push(...handleEssences(player));
      break;
    }
    case "rest": {
      const recHp = Math.floor(player.stats.maxHp * 0.25);
      const recSta = Math.floor(player.stats.maxStamina * 0.4);
      player.hp = Math.min(player.stats.maxHp, player.hp + recHp);
      player.stamina = Math.min(player.stats.maxStamina, player.stamina + recSta);
      const corrReduce = room.tipo === "santuario" ? 5 : 1;
      if (player.corrupcao > 0) player.corrupcao = Math.max(0, player.corrupcao - corrReduce);
      log.push(`Voce descansa. Recupera ${recHp} HP, ${recSta} Estamina e reduz corrupcao (${corrReduce}). Atual: ${player.corrupcao}%.`);
      if (room.tipo !== "santuario" && roomState.mobs.some((m) => m.alive)) {
        log.push("Descansar aqui e arriscado...");
        const prevAlive = new Set(roomState.mobs.filter((m) => m.alive).map((m) => m.id));
        const tick = mobActionTick(player, roomState);
        log.push(...tick.log);
        processMobDeaths(prevAlive, roomState, player, log, room);
        if (player.hp <= 0) {
          handleDeath(player, roomState, world, log);
          return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
        }
      }
      break;
    }
    case "help": {
      log.push(...handleHelp());
      break;
    }
    default: {
      log.push(`Comando ${verb} nao reconhecido. Use help.`);
    }
  }

  if (player.hp <= 0) {
    handleDeath(player, roomState, world, log);
  }
  player.lastActionAt = Date.now();

  return {
    log,
    player,
    room: world.salas[player.localizacao],
    roomState,
    world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao },
  };
}
