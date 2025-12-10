import { BIOMES, PASSIVES, BASE_CLASSES, ESSENCES, ITEMS } from "../data";
import { getItem as fetchItem } from "../state/itemCatalog";
import { Player, CommandResult, Room, RoomState, WorldState, ItemSlot, InventoryItem, DropEntry, Skill } from "../types";
import { attemptFlee, performAttack, performSkill } from "../systems/combat";
import { MOBS } from "../data/mobs";

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
  const mobsInfo = formatMobs(roomState, player);
  visible.push(mobsInfo);
  if (roomState.loot && roomState.loot.length) {
    visible.push(`Loot no chao: ${roomState.loot.map((l) => `${l.itemId} x${l.qtd}`).join(", ")}`);
  }

  const conexoesVisiveis = room.conexoes.filter((c) => !c.secreta || player.revelados.includes(c.id));
  visible.push(
    `Caminhos: ${conexoesVisiveis
      .map((c, idx) => `[${idx + 1}] ${c.label} -> ${c.target}${c.secreta ? " (secreto)" : ""}`)
      .join(" | ") || "nenhum"}`
  );
  return visible;
}

function formatMobs(roomState: RoomState, player: Player): string {
  if (!roomState.mobs.length) return "Sem inimigos visiveis.";
  const lines = roomState.mobs.map((m, idx) => {
    const mob = MOBS.find((mm) => mm.id === m.mobId);
    const furtivo = mob?.furtivo;
    const detect = player.stats.sub.percepcao >= 3 || player.essencias.includes("areia_sussurrante");
    if (furtivo && !detect) return `?${idx + 1}: algo se move nas sombras...`;
    const mark = player.selectedTarget === m.id ? "*" : "";
    return `${mark}${idx + 1}:${mob?.nome ?? m.mobId} HP:${Math.max(0, m.hp)}`;
  });
  return `Inimigos: ${lines.join(" | ")}`;
}

const EQUIP_SKILLS: Record<string, Skill> = {
  arco_rudimentar: {
    id: "tiro_arco",
    nome: "Tiro de Arco",
    descricao: "Ataque a distancia escalado por AGI/SOR.",
    custoStamina: 6,
    baseDano: [5, 9],
    escala: { agilidade: 0.6, sorte: 0.4 },
    tags: ["distancia"],
    requerAlvo: true,
  },
  adaga_rapida: {
    id: "golpe_preciso",
    nome: "Golpe Preciso",
    descricao: "Ataque rapido, chance maior de critico.",
    custoStamina: 5,
    baseDano: [4, 7],
    escala: { agilidade: 0.5, sorte: 0.3 },
    tags: ["fisico"],
    requerAlvo: true,
  },
  martelo_pesado: {
    id: "martelada",
    nome: "Martelada",
    descricao: "Golpe pesado que pode atordoar.",
    custoStamina: 9,
    baseDano: [7, 12],
    escala: { forca: 0.9, vigor: 0.4 },
    tags: ["fisico"],
    requerAlvo: true,
  },
};

function availableSkills(player: Player): Skill[] {
  const classe = BASE_CLASSES.find((c) => c.id === player.classeBase);
  const classSkills = classe?.habilidades ?? [];
  const equipSkills: Skill[] = [];
  for (const slot of Object.keys(player.equipamento) as ItemSlot[]) {
    const id = player.equipamento[slot];
    if (id && EQUIP_SKILLS[id]) equipSkills.push(EQUIP_SKILLS[id]);
  }
  return [...classSkills, ...equipSkills];
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

function handleDeath(player: Player, roomState: RoomState, world: WorldState, log: string[]) {
  const loot: InventoryItem[] = roomState.loot ?? [];
  const dropCount = Math.ceil(player.inventario.length / 2);
  const dropped = player.inventario.slice(0, dropCount);
  for (const item of dropped) {
    const existing = loot.find((l) => l.itemId === item.itemId);
    if (existing) existing.qtd += item.qtd;
    else loot.push({ ...item });
  }
  roomState.loot = loot;
  player.inventario = player.inventario.slice(dropCount);
  player.hp = player.stats.maxHp;
  player.stamina = player.stats.maxStamina;
  player.localizacao = world.salaInicial;
  player.selectedTarget = null;
  log.push("Voce caiu e desperta no vestibulo. Parte do seu inventario ficou na sala anterior.");
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

function xpNeededFor(level: number) {
  return 3 + level;
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
  lines.push(
    `Lv ${player.nivel} ${player.classeBase} (${player.race}) | Linhagem ${player.lineage} | XP ${player.xp}`
  );
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

function listSkills(player: Player): string[] {
  const skills = availableSkills(player);
  if (!skills.length) return ["Nenhuma habilidade disponivel."];
  return skills.map((h) => `${h.id}: ${h.nome} (STA ${h.custoStamina}) - ${h.descricao}`);
}

function handleInventory(player: Player): string[] {
  if (!player.inventario.length) return ["Inventario vazio."];
  return player.inventario.map((slot) => {
    const item = fetchItem(slot.itemId);
    return `${item?.nome ?? slot.itemId} x${slot.qtd} (${item?.tipo ?? "?"}, peso ${item?.peso ?? "?"})`;
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
    "Comandos: look | go <numero/rota> | attack | settarget <id> | inspect <id> | skills | useSkill <id> | flee | stats | inventory | loot | equip <itemId> | use <itemId> | absorb <essenciaId> | purge <essenciaId> | map | passivas | essencias | rest | help",
    "Look revela caminhos, percepcao pode expor rotas secretas.",
    "Attack usa estamina e considera peso. Flee tenta sair rapido.",
    "Use para consumiveis; absorb/purge gerenciam essencias (limitado por slots). Map lista salas visitadas.",
    "settarget <idx|id> escolhe alvo. skills lista habilidades da classe. useSkill <id> usa habilidade no alvo.",
  ];
}

export function handleCommand({ command, player, world, room, roomState }: HandleInput): CommandResult {
  const log: string[] = [];
  const trimmed = (command || "").trim();
  if (!trimmed) {
    return { log: ["Envie um comando: help para lista."], player, room, roomState };
  }
  const [verb, ...rest] = trimmed.split(/\s+/);

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
  if (player.hp <= 0) {
    handleDeath(player, roomState, world, log);
    return { log, player, room, roomState, world: { salaInicial: world.salaInicial, seed: world.seed, versao: world.versao } };
  }

  switch (verb.toLowerCase()) {
    case "look":
    case "where": {
      trackDiscovery(player, room, roomState, log);
      log.push(...maybeRevealSecrets(room, player));
      log.push(...describeRoom(room, player, roomState));
      if (player.essencias.includes("nucleo_tecnomantico")) {
        player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), droneCharges: 1 };
        log.push("Seu drone zune ao redor, pronto para interceptar um golpe.");
      }
      break;
    }
    case "go": {
      if (!rest.length) {
        log.push("Use go <numero ou rota>");
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
      break;
    }
    case "attack": {
      const result = performAttack(player, room, roomState);
      log.push(...result.log);
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
      }
      break;
    }
    case "settarget": {
      if (!rest.length) {
        log.push("Use settarget <indice ou id>");
        break;
      }
      const arg = rest[0];
      const visible = roomState.mobs.filter((m) => m.alive);
      let target = visible.find((m) => m.id === arg);
      if (!target) {
        const idx = parseInt(arg, 10);
        if (!Number.isNaN(idx) && idx > 0 && idx <= visible.length) {
          target = visible[idx - 1];
        }
      }
      if (!target) {
        log.push("Alvo nao encontrado.");
        break;
      }
      player.selectedTarget = target.id;
      log.push(`Alvo selecionado: ${target.id}`);
      break;
    }
    case "inspect": {
      if (!rest.length) {
        log.push("Use inspect <indice ou id>");
        break;
      }
      const arg = rest[0];
      const visible = roomState.mobs.filter((m) => m.alive);
      let target = visible.find((m) => m.id === arg);
      if (!target) {
        const idx = parseInt(arg, 10);
        if (!Number.isNaN(idx) && idx > 0 && idx <= visible.length) {
          target = visible[idx - 1];
        }
      }
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
      const skill = availableSkills(player).find((h) => h.id === skillId);
      if (!skill) {
        log.push("Skill nao encontrada ou indisponivel.");
        break;
      }
      if (skill.requerAlvo && !player.selectedTarget) {
        log.push("Selecione um alvo com settarget antes de usar esta skill.");
        break;
      }
      const result = performSkill(player, room, roomState, {
        skillId: skill.id,
        skillBase: skill.baseDano,
        skillCost: skill.custoStamina,
        targetId: player.selectedTarget ?? undefined,
      });
      log.push(...result.log);
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
      const exits = room.conexoes.map((c) => `${c.label} -> ${c.target}${visited.includes(c.target) ? " (visitada)" : ""}`);
      log.push(`Saidas: ${exits.join(" | ")}`);
      break;
    }
    case "inventory": {
      log.push(...handleInventory(player));
      log.push(...handleEquipment(player));
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
      }
      roomState.loot = [];
      log.push("Voce coleta o loot espalhado na sala.");
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
      applyConsumable(player, item, log);
      invItem.qtd -= 1;
      if (invItem.qtd <= 0) {
        player.inventario = player.inventario.filter((i) => i.qtd > 0);
      }
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
      const item = ITEMS.find((it) => it.id === targetId);
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
      if (room.tipo === "santuario") {
        player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), shield: 5 };
        log.push("A aura do santuario reergue um escudo protetor.");
      }
      log.push(`Voce descansa. Recupera ${recHp} HP, ${recSta} Estamina e reduz corrupcao (${corrReduce}). Atual: ${player.corrupcao}%.`);
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
