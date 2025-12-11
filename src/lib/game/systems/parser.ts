import { Skill } from "../types";

export function parseUseSkill(input: string, skills: Skill[]) {
  const parts = input.trim().split(/\s+/);
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  if (first.toLowerCase() !== "usar" && first.toLowerCase() !== "useskill") return null;
  const skillToken = rest[0];
  if (!skillToken) return null;
  const targetToken = rest[1];
  const skill = skills.find((s) => s.id === skillToken || s.nome.toLowerCase().includes(skillToken.toLowerCase()));
  if (!skill) return null;
  return { skillId: skill.id, target: targetToken };
}
