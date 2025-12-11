import { Skill } from "../types";

/**
 * Parser simples para frases do tipo:
 * "usar tiro rapido no goblin", "useskill golpe_duplo 2", "usar finta em arqueiro".
 * Retorna o id da skill encontrado e, se houver, o token do alvo (nome ou indice).
 */
export function parseUseSkill(input: string, skills: Skill[]) {
  const lower = input.trim().toLowerCase();
  if (!lower.startsWith("usar") && !lower.startsWith("useskill")) return null;

  // remove pontuacao e separa
  const cleaned = lower.replace(/[.,;:!?]/g, " ");
  const afterVerb = cleaned.replace(/^(usar|useskill)\s+/, "");

  // escolhe a skill cujo nome/id apareca na frase (prioriza match mais longo)
  const candidates = skills
    .map((s) => ({
      id: s.id,
      nome: s.nome.toLowerCase(),
      score: s.nome.length,
    }))
    .sort((a, b) => b.score - a.score);

  let chosen: { id: string; nome: string } | null = null;
  for (const c of candidates) {
    if (afterVerb.includes(c.id.toLowerCase()) || afterVerb.includes(c.nome)) {
      chosen = { id: c.id, nome: c.nome };
      break;
    }
  }
  if (!chosen) return null;

  // remove a skill da frase para tentar extrair o alvo
  const remainder = afterVerb.replace(chosen.id.toLowerCase(), "").replace(chosen.nome, "").trim();
  const tokens = remainder.split(/\s+/).filter(Boolean);
  const stopWords = new Set(["no", "na", "em", "o", "a", "um", "uma", "do", "da", "de"]);
  const targetToken = tokens.find((t) => !stopWords.has(t));

  return { skillId: chosen.id, target: targetToken };
}
