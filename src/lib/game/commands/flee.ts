import { resolveCombatAction } from "../systems/combatManager"

export async function flee(player) {
  if (!player.combatId) return Nenhum combate ativo.
  await resolveCombatAction(player.combatId, player.id, "escape")
  return Você tenta fugir.
}
