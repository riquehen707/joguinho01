export async function inventory(player) {
  const inv = player.inventory || []
  if (!inv.length) return Inventário vazio.
  return inv.join("\n")
}
