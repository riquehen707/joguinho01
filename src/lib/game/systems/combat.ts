import { getItem } from "../state/itemCatalog";
import { getMob } from "../state/mobCatalog";
import { MobInstance, Player, Room, RoomState } from "../types";

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

export function performAttack(player: Player, room: Room, roomState: RoomState) {
  const log: string[] = [];
  return performSkill(player, room, roomState, {
    skillId: "ataque_basico",
    skillBase: [4, 8],
    skillCost: undefined,
    targetId: player.selectedTarget ?? undefined,
    log,
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
    if (droneCharges > 0 && player.essencias.includes("nucleo_tecnomantico")) {
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
  const chanceBase = 0.35 + player.stats.atributos.agilidade * 0.03 + player.stats.sub.velocAtaque * 0.02;
  const chance = Math.min(0.95, chanceBase + (hasSteps ? 0.08 : 0) + (hasSand ? 0.05 : 0));
  const roll = Math.random();
  if (roll < chance) {
    log.push("Voce escapa correndo.");
    return { success: true, log };
  }
  const retaliate = rand(3, 8);
  player.hp = Math.max(0, player.hp - retaliate);
  log.push(`Fuga falhou! Sofre ${retaliate} de dano ao tentar escapar.`);
  return { success: false, log };
}
