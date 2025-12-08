import { resolveCombatAction } from "../systems/combatManager"

export async function attack(player) {
  if (!player.combatId) return Nenhum combate ativo.
  await resolveCombatAction(player.combatId, player.id, "attack")
  return Você ataca.
}
