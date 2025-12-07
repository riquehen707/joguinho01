import React from "react";
type TopBarProps = {
  connected: boolean;
  player: any;
  inventoryCount: number;
  inventoryLimit: number;
  onLogout: () => void;
  onResetSession?: () => void;
};

export function TopBar({ connected, player, inventoryCount, inventoryLimit, onLogout, onResetSession }: TopBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          connected ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
        }`}
      />
      <span>{connected ? `Conectado como ${player?.name ?? "?"}` : "Aguardando conexao"}</span>
      {connected && (
        <div className="flex items-center gap-2">
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              className="rounded-full border border-amber-400/60 bg-amber-500/10 px-3 py-1 text-amber-100 transition hover:border-amber-300"
            >
              Reset sessao
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-full border border-rose-400/60 bg-rose-500/10 px-3 py-1 text-rose-100 transition hover:border-rose-300"
          >
            Sair
          </button>
        </div>
      )}
      {player && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-100">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5">
            Ouro: {player.gold}
          </span>
          <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-0.5">
            Inv.: {inventoryCount}/{inventoryLimit}
          </span>
          <span className="rounded-full border border-slate-500/40 bg-slate-800/50 px-2.5 py-0.5">
            Persistencia: memoria (demo)
          </span>
        </div>
      )}
    </div>
  );
}
