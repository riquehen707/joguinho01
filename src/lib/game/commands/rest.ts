export async function rest(player) {
  player.vitals.stamina = Math.min(player.vitals.stamina + 2, 8)
  player.vitals.hp = Math.min(player.vitals.hp + 1, 10)
  return Você descansa um pouco.
}
