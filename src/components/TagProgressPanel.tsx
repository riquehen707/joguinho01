import React from "react";
import { SKILL_TAG_UNLOCKS, SKILLS } from "@/lib/worldData";

type TagProgressPanelProps = {
  tagProgress?: Record<string, number>;
};

const skillNameById = SKILLS.reduce<Record<string, string>>((acc, s) => {
  acc[s.id] = s.name;
  return acc;
}, {});

export function TagProgressPanel({ tagProgress }: TagProgressPanelProps) {
  const entries = Object.entries(tagProgress || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow-inner">
      <div className="text-xs font-semibold text-emerald-200">Progresso de tags</div>
      <div className="mt-2 space-y-2 text-[12px] text-slate-200">
        {entries.length === 0 && <div className="text-slate-400">Nenhum progresso ainda.</div>}
        {entries.map(([tag, value]) => {
          const unlocks = SKILL_TAG_UNLOCKS[tag] || [];
          const next = unlocks.find((u) => value < u.threshold);
          const unlocked = unlocks.filter((u) => value >= u.threshold).map((u) => skillNameById[u.skillId] || u.skillId);
          return (
            <div key={tag} className="rounded border border-slate-800/70 bg-slate-950/60 px-2 py-1">
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-wider text-[11px] text-slate-300">{tag}</span>
                <span className="text-[11px] text-emerald-200">{value}x</span>
              </div>
              {next ? (
                <div className="text-[11px] text-slate-400">
                  Próximo: {skillNameById[next.skillId] || next.skillId} em {next.threshold} ({value}/{next.threshold})
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  Tudo desbloqueado para esta tag.
                </div>
              )}
              {unlocked.length > 0 && (
                <div className="text-[11px] text-emerald-300">Desbloqueado: {unlocked.join(", ")}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
