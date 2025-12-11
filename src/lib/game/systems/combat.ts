import { getItem } from "../state/itemCatalog";
import { getMob } from "../state/mobCatalog";
import { MobInstance, Player, Room, RoomState, StatusId } from "../types";
import { getSkill } from "../data/skills";
import { MOBS } from "../data/mobs";

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightPenalty(player: Player): { pesoTotal: number; custoExtra: number } {
  let peso = 0;
  for (const slot of Object.keys(player.equipamento) as (keyof typeof player.equipamento)[]) {
    const id = player.equipamento[slot];
    if (!id) continue;
    const item = getItem(id);
    if (item) peso += item.peso;
  }
  const baseCap = player.stats.sub.pesoSuportado;
  const excedente = Math.max(0, peso - baseCap);
  const custoExtra = excedente > 0 ? Math.ceil(excedente / 2) : 0;
  return { pesoTotal: peso, custoExtra };
}

function pickTargetMob(state: RoomState, targetId?: string): MobInstance | null {
  const alive = state.mobs.filter((m) => m.alive && m.hp > 0);
  if (!alive.length) return null;
  if (targetId) {
    const match = alive.find((m) => m.id === targetId);
    if (match) return match;
  }
  return alive[rand(0, alive.length - 1)];
}

type CombatMods = {
  damageMult: number;
  elementDamage: number;
  elementType: string | null;
  staminaMod: number;
  critBonus: number;
  skipCounterChance: number;
  counterMitPercent: number;
  counterMitFlat: number;
  extraHits: number;
  dotDamage: number;
  healOnKill: number;
  dronePulse: number;
};

function computeMods(player: Player, roomState: RoomState): CombatMods {
  const mods: CombatMods = {
    damageMult: 1,
    elementDamage: 0,
    elementType: null,
    staminaMod: 0,
    critBonus: 0,
    skipCounterChance: 0,
    counterMitPercent: 0,
    counterMitFlat: 0,
    extraHits: 0,
    dotDamage: 0,
    healOnKill: 0,
    dronePulse: 0,
  };
  const has = (id: string) => player.passivas.includes(id);
  const hasEss = (id: string) => player.essencias.includes(id);
  const mobsAlive = roomState.mobs.filter((m) => m.alive).length;
  const pesoExtra = weightPenalty(player).custoExtra;

  if (has("instinto_predador")) mods.damageMult += 0.1;
  if (has("danca_da_lamina")) {
    mods.staminaMod -= 1;
    if (Math.random() < 0.12) mods.extraHits += 1;
  }
  if (has("eco_cosmico") && Math.random() < 0.12) mods.extraHits += 0.5;
  if (has("pele_de_ferro")) mods.counterMitFlat += 2;
  if (has("manto_espectral")) mods.skipCounterChance += 0.15;
  if (has("carapaca_draconica")) mods.counterMitPercent += 0.08;
  if (has("protocolo_de_assimetria") && mobsAlive > 1) {
    mods.staminaMod -= 1;
    mods.counterMitFlat += 1;
  }

  if (hasEss("eco_da_cripta")) mods.healOnKill += 6;
  if (hasEss("toxina_pantano")) mods.dotDamage += 2;
  if (hasEss("manuscrito_vivo")) mods.staminaMod -= 1;
  if (hasEss("fenda_latente")) mods.skipCounterChance += 0.12;
  if (hasEss("areia_sussurrante")) mods.critBonus += 0.05;
  if (hasEss("nucleo_tecnomantico")) mods.counterMitPercent += 0.25;
  if (hasEss("manuscrito_vivo")) {
    mods.elementDamage += 2;
    mods.elementType = "arcano";
    mods.staminaMod -= 1;
  }
  if (hasEss("eco_da_cripta")) {
    mods.elementDamage += 2;
    mods.elementType = mods.elementType ?? "sombrio";
  }
  if (hasEss("nucleo_tecnomantico")) {
    mods.elementDamage += 1;
    mods.elementType = mods.elementType ?? "choque";
    if ((player.status?.droneCharges ?? 0) > 0) mods.dronePulse = 3;
  }

  // Penalidade por carga/peso excedente
  if (pesoExtra > 0) {
    mods.staminaMod += pesoExtra;
    mods.damageMult = Math.max(0.8, mods.damageMult - Math.min(0.15, pesoExtra * 0.03));
    mods.skipCounterChance = Math.max(0, mods.skipCounterChance - 0.05);
  }

  // Corrupcao penaliza
  if (player.corrupcao >= 40) {
    mods.damageMult *= 0.95;
    mods.critBonus -= 0.02;
  }
  if (player.corrupcao >= 70) {
    mods.staminaMod += 1;
    mods.skipCounterChance = Math.max(0, mods.skipCounterChance - 0.05);
  }

  return mods;
}

function applyCondition(target: { conditions?: Record<StatusId, number> }, effect: StatusId, duracao: number) {
  if (!target.conditions) target.conditions = {} as Record<StatusId, number>;
  const current = target.conditions[effect] ?? 0;
  target.conditions[effect] = Math.max(current, duracao);
}

function tickConditionsOnMob(mobInstance: MobInstance, log: string[]) {
  if (!mobInstance.conditions) return;
  let dot = 0;
  const conds = mobInstance.conditions;
  if (conds.veneno && conds.veneno > 0) dot += 2;
  if (conds.sangramento && conds.sangramento > 0) dot += 2;
  if (dot > 0) {
    mobInstance.hp = Math.max(0, mobInstance.hp - dot);
    log.push(`Efeitos continuos ferem ${mobInstance.id} em ${dot}.`);
    if (mobInstance.hp <= 0) mobInstance.alive = false;
  }
  for (const k of Object.keys(conds) as StatusId[]) {
    if (conds[k] > 0) conds[k] -= 1;
    if (conds[k] <= 0) delete conds[k];
  }
}

function tickConditionsOnPlayer(player: Player, log: string[]) {
  if (!player.conditions) return;
  let dot = 0;
  const conds = player.conditions;
  if (conds.veneno && conds.veneno > 0) dot += 2;
  if (conds.sangramento && conds.sangramento > 0) dot += 2;
  if (dot > 0) {
    player.hp = Math.max(0, player.hp - dot);
    log.push(`Efeitos continuos causam ${dot} de dano em voce.`);
  }
  for (const k of Object.keys(conds) as StatusId[]) {
    if (conds[k] > 0) conds[k] -= 1;
    if (conds[k] <= 0) delete conds[k];
  }
}

export function performAttack(player: Player, room: Room, roomState: RoomState) {
  return performSkill(player, room, roomState, {
    skillId: "ataque_basico",
    skillBase: [4, 8],
    skillCost: undefined,
    targetId: player.selectedTarget ?? undefined,
  });
}

type SkillOpts = {
  skillId?: string;
  skillBase?: [number, number];
  skillCost?: number;
  targetId?: string;
  tags?: string[];
  requiresTarget?: boolean;
};

export function performSkill(player: Player, room: Room, roomState: RoomState, opts: SkillOpts) {
  const log: string[] = [];
  const target = pickTargetMob(roomState, opts.targetId);
  if (!target) {
    log.push("Nenhum inimigo vivo na sala.");
    return { log, player, roomState, killed: null };
  }

  const mobData = getMob(target.mobId);
  const { custoExtra } = weightPenalty(player);
  const mods = computeMods(player, roomState);
  // silence/debuff conditions on player
  if (player.conditions?.silenciado) mods.damageMult *= 0.9;
  if (player.conditions?.enfraquecido) mods.damageMult *= 0.9;
  if (player.conditions?.lento) mods.staminaMod += 1;

  const baseMin =
    (opts.skillBase?.[0] ?? 4) + player.stats.atributos.forca * 0.6 + player.stats.atributos.agilidade * 0.3;
  const baseMax =
    (opts.skillBase?.[1] ?? 8) + player.stats.atributos.forca * 0.8 + player.stats.atributos.agilidade * 0.5;
  const staminaBase = opts.skillCost ?? 6;
  const staminaCost = Math.max(
    4,
    Math.floor((staminaBase + custoExtra + mods.staminaMod) * (1 + (room.dificuldade - 1) * 0.1))
  );
  let damage = rand(Math.floor(baseMin), Math.floor(baseMax));
  damage = Math.floor(damage * mods.damageMult);

  if (player.stamina < staminaCost) {
    damage = Math.floor(damage * 0.5);
    log.push("Exausto: pouco stamina, dano reduzido.");
  }
  player.stamina = Math.max(0, player.stamina - staminaCost);

  if (Math.random() < 0.1 + player.stats.atributos.sorte * 0.01 + mods.critBonus) {
    damage = Math.floor(damage * 1.5);
    log.push("Critico!");
  }

  target.hp -= damage;
  if (target.hp <= 0) {
    target.alive = false;
    log.push(`Voce derrota ${mobData?.nome ?? target.mobId} causando ${damage} de dano.`);
  } else {
    log.push(`Voce atinge ${mobData?.nome ?? target.mobId} por ${damage}. HP restante ${target.hp}.`);
  }

  if (mods.elementDamage > 0 && target.alive) {
    target.hp -= mods.elementDamage;
    log.push(`Dano ${mods.elementType ?? "elemental"} extra: ${mods.elementDamage}. HP agora ${Math.max(0, target.hp)}.`);
  }

  if (mods.dronePulse > 0 && target.alive) {
    target.hp -= mods.dronePulse;
    if (player.status) {
      player.status.droneCharges = Math.max(0, (player.status.droneCharges ?? 0) - 1);
    }
    log.push(`Drone dispara pulso causando ${mods.dronePulse} de dano.`);
  }

  if (target.alive && mobData) {
    const droneCharges = player.status?.droneCharges ?? 0;
    if (droneCharges > 0 && player.lineage === "tecnologica") {
      log.push("Seu drone intercepta o contra-ataque inimigo.");
      player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), droneCharges: droneCharges - 1 };
    } else if (Math.random() < mods.skipCounterChance) {
      log.push("Voce evita o contra-ataque.");
    } else {
      const mobDmg = rand(mobData.dano[0], mobData.dano[1]);
      const mitigacaoBase = 1 - Math.min(0.4, player.stats.sub.resFisica * 0.02);
      const mitigacaoExtra = Math.max(0, 1 - mods.counterMitPercent);
      let final = Math.max(1, Math.floor(mobDmg * mitigacaoBase * mitigacaoExtra - mods.counterMitFlat));
      if (player.status?.shield && player.status.shield > 0) {
        const absorb = Math.min(player.status.shield, final);
        final -= absorb;
        player.status.shield -= absorb;
        log.push(`Seu escudo absorve ${absorb} de dano.`);
      }
      player.hp = Math.max(0, player.hp - final);
      log.push(`${mobData.nome} revida causando ${final} de dano.`);
      if (player.hp <= 0) {
        log.push("Voce caiu! Use rest ou reentre apos recuperar.");
        player.hp = 1;
      }
    }
  }

  if (mods.extraHits > 0 && target.alive) {
    const extraDmg = Math.max(1, Math.floor(damage * mods.extraHits * 0.5));
    target.hp -= extraDmg;
    log.push(`Golpe extra causa ${extraDmg} de dano.`);
    if (target.hp <= 0) {
      target.alive = false;
      log.push("O inimigo cai pelo golpe extra.");
    }
  }
  if (mods.dotDamage > 0 && target.alive) {
    target.hp -= mods.dotDamage;
    log.push(`Veneno/efeito continuo causa ${mods.dotDamage} de dano.`);
    if (target.hp <= 0) {
      target.alive = false;
      log.push("O inimigo sucumbe ao dano continuo.");
    }
  }

  if (!target.alive && mods.healOnKill > 0) {
    const before = player.hp;
    player.hp = Math.min(player.stats.maxHp, player.hp + mods.healOnKill);
    log.push(`Eco vital: recupera ${player.hp - before} HP ao matar.`);
  }

  // aplica efeitos de status da skill
  if (opts.skillId) {
    const skillMeta = getSkill(opts.skillId);
    if (skillMeta?.aplica) {
      for (const ap of skillMeta.aplica) {
        if (ap.chance && Math.random() > ap.chance) continue;
        if (ap.alvo === "self") applyCondition(player, ap.efeito, ap.duracao);
        else applyCondition(target, ap.efeito, ap.duracao);
      }
    }
  }

  // efeitos especiais por skillId
  if (opts.skillId === "postura_defensiva") {
    const shield = Math.floor(4 + player.stats.atributos.vigor * 0.3);
    player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), shield: shield + (player.status?.shield ?? 0) };
    log.push(`Escudo temporario ganho: ${shield}.`);
  }
  if (opts.skillId === "escudo_arcano") {
    const shield = Math.floor(5 + player.stats.atributos.foco * 0.5);
    player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), shield: shield + (player.status?.shield ?? 0) };
    log.push(`Escudo arcano: +${shield}.`);
  }
  if (opts.skillId === "pulso_drone") {
    if (player.lineage === "tecnologica" || player.classeBase === "artifice") {
      const charges = (player.status?.droneCharges ?? 0) + 1;
      player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), droneCharges: charges };
      log.push("Drone recarregado (+1 carga).");
    } else {
      log.push("Você nao possui afinidade para drones.");
    }
  }
  if (opts.skillId === "invocar_constructo") {
    if (player.lineage === "tecnologica" || player.classeBase === "artifice") {
      const charges = (player.status?.droneCharges ?? 0) + 1;
      const shield = 3;
      player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), droneCharges: charges, shield: (player.status?.shield ?? 0) + shield };
      log.push("Constructo invocado: +1 carga de drone e escudo leve.");
    } else {
      log.push("Sem afinidade para constructos.");
    }
  }

  if (target.hp < 0) target.hp = 0;

  return { log, player, roomState, killed: target.alive ? null : target };
}
export function attemptFlee(player: Player, roomState: RoomState) {
  const log: string[] = [];
  const alive = roomState.mobs.some((m) => m.alive);
  if (!alive) {
    log.push("Sem perigo na sala. Voce pode sair sem problemas.");
    return { success: true, log };
  }
  const hasSteps = player.passivas.includes("passos_leves");
  const hasSand = player.essencias.includes("areia_sussurrante");
  const mobsVivos = roomState.mobs.filter((m) => m.alive).length;
  const pesoPenalty = weightPenalty(player).custoExtra;
  const base = 0.35 + player.stats.atributos.agilidade * 0.03 + player.stats.sub.velocAtaque * 0.02;
  const bonus = (hasSteps ? 0.08 : 0) + (hasSand ? 0.05 : 0);
  const malus = Math.min(0.2, mobsVivos * 0.05) + pesoPenalty * 0.02 + (roomState.deathCount ?? 0) * 0.02;
  const chance = Math.min(0.95, Math.max(0.05, base + bonus - malus));
  const roll = Math.random();
  if (roll < chance) {
    const staminaCost = 4 + pesoPenalty;
    player.stamina = Math.max(0, player.stamina - staminaCost);
    log.push(`Voce escapa! Gasta ${staminaCost} de estamina.`);
    return { success: true, log };
  }
  // Falha: contra-ataque do mob mais perigoso
  const target = pickTargetMob(roomState);
  if (!target) {
    log.push("Falha na fuga, mas nenhum inimigo reage.");
    return { success: false, log };
  }
  const mob = getMob(target.mobId);
  const retaliate = mob ? rand(mob.dano[0], mob.dano[1]) : rand(3, 8);
  let dmg = retaliate;
  if (mob?.role === "brute") dmg = Math.floor(dmg * 1.2);
  if (mob?.role === "skirmisher") dmg = Math.floor(dmg * 1.1);
  const shield = player.status?.shield ?? 0;
  if (shield > 0) {
    const absorb = Math.min(shield, dmg);
    dmg -= absorb;
    player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), shield: shield - absorb };
    log.push(`Escudo absorve ${absorb} do golpe enquanto voce tenta fugir.`);
  }
  player.hp = Math.max(0, player.hp - dmg);
  log.push(`Fuga falhou! ${mob?.nome ?? "Inimigo"} atinge voce em ${dmg} de dano.`);
  return { success: false, log };
}

export function mobActionTick(player: Player, roomState: RoomState) {
  const log: string[] = [];
  tickConditionsOnPlayer(player, log);
  const aliveMobs = roomState.mobs.filter((m) => m.alive);
  if (!aliveMobs.length) return { log, player };

  const dangerRamp = Math.min(2, roomState.deathCount ?? 0);
  const actions = Math.min(aliveMobs.length, 1 + (aliveMobs.length > 1 ? 1 : 0) + dangerRamp);

  const applyDamage = (dmg: number, source: string, ignoreShield = false) => {
    const shield = player.status?.shield ?? 0;
    if (!ignoreShield && shield > 0) {
      const absorb = Math.min(shield, dmg);
      dmg -= absorb;
      player.status = { ...(player.status ?? { shield: 0, droneCharges: 0 }), shield: shield - absorb };
      log.push(`Escudo absorve ${absorb} do ataque de ${source}.`);
    }
    player.hp = Math.max(0, player.hp - dmg);
    log.push(`${source} causa ${dmg} de dano.`);
    if (player.hp <= 0) {
      log.push("Voce caiu!");
      player.hp = 0;
    }
  };

  for (let i = 0; i < actions; i++) {
    const target = pickTargetMob(roomState);
    if (!target || !target.alive) continue;
    // efeitos continuos no mob
    tickConditionsOnMob(target, log);
    if (!target.alive) continue;
    const mob = getMob(target.mobId);
    if (!mob) continue;
    const power = target.power ?? 0;

    // Armadilha ambiente quando a sala acumula mortes
    const trapChance = Math.min(0.25, (roomState.deathCount ?? 0) * 0.05);
    if (Math.random() < trapChance) {
      const trapDmg = rand(2, 5) + (roomState.deathCount ?? 0);
      applyDamage(trapDmg, "Armadilha da sala");
      continue;
    }

    // role-based behavior
    if (target.conditions?.medo && Math.random() < 0.5) {
      log.push(`${mob.nome} hesita tomado por medo.`);
      continue;
    }

    if (mob.role === "support") {
      const ally = roomState.mobs.find((m) => m.alive && m.hp < (getMob(m.mobId)?.hp ?? m.hp));
      if (ally) {
        const heal = rand(3, 7) + dangerRamp;
        ally.hp += heal;
        log.push(`${mob.nome} cura um aliado em ${heal} HP.`);
        continue;
      }
    }
    if (mob.role === "elite" && Math.random() < 0.35) {
      const pierce = Math.random() < 0.4;
      const buff = 1 + (power > 0 ? 0.2 : 0);
      const dmg = Math.floor((rand(mob.dano[0], mob.dano[1]) + dangerRamp) * (1.1 + power * 0.1) * buff);
      applyDamage(dmg, `${mob.nome} (investida)`, pierce);
      if (pierce) log.push(`${mob.nome} ignora parte do seu escudo!`);
      continue;
    }
    if (mob.role === "caster" && !target.conditions?.silenciado && Math.random() < 0.45) {
      const debuff = rand(1, 3) + dangerRamp;
      player.stamina = Math.max(0, player.stamina - debuff);
      log.push(`${mob.nome} canaliza e drena ${debuff} de sua estamina.`);
      continue;
    }
    if (mob.role === "skirmisher" && Math.random() < 0.25) {
      const trapDmg = rand(2, 5) + dangerRamp;
      applyDamage(trapDmg, `${mob.nome} (emboscada)`);
      continue;
    }

    // atordoado ou congelado: perde ação
    if (target.conditions?.atordoado || target.conditions?.congelado) {
      log.push(`${mob.nome} está impedido de agir.`);
      continue;
    }

    let dmg = rand(mob.dano[0], mob.dano[1]);
    if (mob.role === "brute") dmg = Math.floor(dmg * 1.2);
    if (mob.role === "caster") dmg = Math.floor(dmg * 1.1);
    if (mob.role === "skirmisher" && Math.random() < 0.2) dmg = Math.floor(dmg * 1.3);
    if (dangerRamp > 0) dmg = Math.floor(dmg * (1 + dangerRamp * 0.1));
    if (power > 0) dmg = Math.floor(dmg * (1 + power * 0.15));
    if (target.conditions?.enfraquecido) dmg = Math.floor(dmg * 0.85);
    if (target.conditions?.lento) dmg = Math.floor(dmg * 0.9);

    applyDamage(dmg, mob.nome);
    // mobs aplicam condições baseadas em bioma/role
    const roll = Math.random();
    const biome = MOBS.find((m) => m.id === mob.id)?.biome ?? "";
    if (mob.role === "skirmisher" && roll < 0.25) applyCondition(player, "sangramento", 2);
    if (mob.role === "caster" && roll < 0.2) applyCondition(player, "silenciado", 1);
    if (mob.role === "brute" && roll < 0.2) applyCondition(player, "atordoado", 1);
    if (mob.role === "support" && roll < 0.25) applyCondition(player, "enfraquecido", 2);
    if (mob.role === "elite" && roll < 0.2) applyCondition(player, "medo", 2);
    if (biome === "pantano" && roll < 0.25) applyCondition(player, "veneno", 2);
    if (biome === "fissura_abissal" && roll < 0.2) applyCondition(player, "medo", 2);
    if (biome === "deserto_espectral" && roll < 0.2) applyCondition(player, "enfraquecido", 2);
  }
  return { log, player };
}
