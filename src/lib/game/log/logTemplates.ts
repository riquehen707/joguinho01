export const logTemplates = {
  hit(attacker, target, dmg) {
    return ${attacker} acerta  causando .
  },
  miss(attacker, target) {
    return ${attacker} falha em atingir .
  },
  flee(entity) {
    return ${entity} foge rapidamente.
  },
  discovery(room, thing) {
    return Você encontra  na sala .
  }
}
