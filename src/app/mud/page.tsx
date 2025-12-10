"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Player, Room, RoomState } from "@/lib/game/types";

type ApiResponse = {
  playerId: string;
  log: string[];
  player: Player;
  room?: Room;
  roomState?: RoomState;
};

const storageKey = "mud-player-id";
type Tab = "log" | "sala" | "inv" | "ess" | "map";

export default function MudPage() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [logs, setLogs] = useState<string[]>(["Bem-vindo ao MUD persistente."]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("log");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    if (saved) {
      setPlayerId(saved);
      void sendCommand("look", saved);
    } else {
      void sendCommand("look", null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLine = useMemo(() => {
    if (!player) return "Sem dados.";
    return `Lv ${player.nivel} | ${player.race} ${player.classeBase} | Linhagem ${player.lineage} | XP ${player.xp} | HP ${player.hp}/${player.stats.maxHp} | STA ${player.stamina}/${player.stats.maxStamina} | Ouro ${player.ouro} | Corrupcao ${player.corrupcao}%`;
  }, [player]);

  async function sendCommand(command: string, explicitPlayer?: string | null) {
    try {
      setBusy(true);
      const res = await fetch("/api/mud/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: explicitPlayer ?? playerId,
          command,
        }),
      });
      if (!res.ok) {
        setLogs((prev) => [...prev, "Falha ao enviar comando."]);
        return;
      }
      const data = (await res.json()) as ApiResponse;
      setPlayerId(data.playerId);
      localStorage.setItem(storageKey, data.playerId);
      setPlayer(data.player);
      setRoom(data.room ?? null);
      setRoomState(data.roomState ?? null);
      setLogs((prev) => [...prev, ...data.log]);
    } catch (err) {
      console.error(err);
      setLogs((prev) => [...prev, "Erro de rede."]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    setInput("");
    void sendCommand(cmd);
  }

  function quick(cmd: string) {
    setInput("");
    void sendCommand(cmd);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "12px",
        gap: "12px",
        background: "#0c0c12",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "#12121a",
          border: "1px solid #242434",
          borderRadius: 12,
          padding: "12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>MUD Roguelike</h1>
          <span style={{ color: "#8da1b9" }}>{statusLine}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy} onClick={() => quick("look")} style={btnStyle}>
            Look
          </button>
          <button disabled={busy} onClick={() => quick("attack")} style={btnStyle}>
            Attack
          </button>
          <button disabled={busy} onClick={() => quick("flee")} style={btnStyleSecondary}>
            Flee
          </button>
          <button disabled={busy} onClick={() => quick("stats")} style={btnStyle}>
            Stats
          </button>
          <button disabled={busy} onClick={() => quick("skills")} style={btnStyleSecondary}>
            Skills
          </button>
          <button disabled={busy} onClick={() => quick("inventory")} style={btnStyleSecondary}>
            Inventory
          </button>
          <button disabled={busy} onClick={() => quick("passivas")} style={btnStyle}>
            Passivas
          </button>
          <button disabled={busy} onClick={() => quick("essencias")} style={btnStyle}>
            Essencias
          </button>
          <button disabled={busy} onClick={() => quick("use frasco_cura")} style={btnStyleSecondary}>
            Usar Cura
          </button>
          <button disabled={busy} onClick={() => quick("rest")} style={btnStyleSecondary}>
            Rest
          </button>
          <button disabled={busy} onClick={() => quick("help")} style={btnStyleSecondary}>
            Help
          </button>
        </div>
      </header>

      <section style={{ ...panelStyle, padding: 0 }}>
        <div style={{ display: "flex", borderBottom: "1px solid #242434" }}>
          <TabButton active={tab === "log"} onClick={() => setTab("log")} label="Log" />
          <TabButton active={tab === "sala"} onClick={() => setTab("sala")} label="Sala" />
          <TabButton active={tab === "inv"} onClick={() => setTab("inv")} label="Inventario" />
          <TabButton active={tab === "ess"} onClick={() => setTab("ess")} label="Essencias" />
          <TabButton active={tab === "map"} onClick={() => setTab("map")} label="Mapa" />
        </div>
        <div style={{ padding: 12 }}>
          {tab === "log" && (
            <div style={{ maxHeight: "48vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {logs.map((line, idx) => (
                <div key={idx} style={{ background: "#0f1118", padding: "8px 10px", borderRadius: 8, border: "1px solid #1f2432" }}>
                  {line}
                </div>
              ))}
            </div>
          )}
          {tab === "sala" && (
            <>
              {room ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 600 }}>{room.nome}</div>
                  <div style={{ color: "#9fb2c8" }}>
                    Bioma: {room.biome} | Tipo: {room.tipo} | Dificuldade: {room.dificuldade}
                  </div>
                  <div style={{ color: "#c4d0dd" }}>Caminhos: {room.conexoes.length}</div>
                  <div style={{ color: "#c4d0dd" }}>
                    Mobs:{" "}
                    {roomState && roomState.mobs.length
                      ? roomState.mobs.map((m) => `${m.mobId} HP:${Math.max(0, m.hp)}`).join(" | ")
                      : room.mobs.length
                      ? room.mobs.join(", ")
                      : "Nenhum"}
                  </div>
                </div>
              ) : (
                <div>Nenhuma sala carregada.</div>
              )}
            </>
          )}
          {tab === "inv" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "#c4d0dd" }}>
              {player?.inventario?.length
                ? player.inventario.map((i) => (
                    <div key={i.itemId} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <span>
                        {i.itemId} x{i.qtd}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button disabled={busy} style={btnStyleSecondary} onClick={() => quick(`use ${i.itemId}`)}>
                          Usar
                        </button>
                        <button disabled={busy} style={btnStyleSecondary} onClick={() => quick(`equip ${i.itemId}`)}>
                          Equipar
                        </button>
                      </div>
                    </div>
                  ))
                : "Inventario vazio."}
            </div>
          )}
          {tab === "ess" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "#c4d0dd" }}>
              <div>
                Slots: {player?.essencias.length ?? 0} / {player?.slotsEssencia ?? 0}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {player?.essencias.length
                  ? player.essencias.map((id) => (
                      <div key={id} style={{ padding: "6px 8px", borderRadius: 8, background: "#0f1118", border: "1px solid #1f2432" }}>
                        {id}
                        <button
                          disabled={busy}
                          style={{ ...btnStyleSecondary, marginLeft: 6, padding: "4px 6px" }}
                          onClick={() => quick(`purge ${id}`)}
                        >
                          Purge
                        </button>
                      </div>
                    ))
                  : "Nenhuma ativa. Use 'absorb <id>'."}
              </div>
              <div>Passivas: {player?.passivas.join(", ") || "nenhuma"}</div>
              <div>Target: {player?.selectedTarget ?? "nenhum"}</div>
              <div>
                Escudo: {player?.status?.shield ?? 0} | Drone: {player?.status?.droneCharges ?? 0}
              </div>
            </div>
          )}
          {tab === "ess" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "#c4d0dd" }}>
              <div>
                Slots: {player?.essencias.length ?? 0} / {player?.slotsEssencia ?? 0}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {player?.essencias.length
                  ? player.essencias.map((id) => (
                      <div key={id} style={{ padding: "6px 8px", borderRadius: 8, background: "#0f1118", border: "1px solid #1f2432" }}>
                        {id}
                        <button
                          disabled={busy}
                          style={{ ...btnStyleSecondary, marginLeft: 6, padding: "4px 6px" }}
                          onClick={() => quick(`purge ${id}`)}
                        >
                          Purge
                        </button>
                      </div>
                    ))
                  : "Nenhuma ativa. Use 'absorb <id>'."}
              </div>
            </div>
          )}
          {tab === "map" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, color: "#c4d0dd" }}>
              <div>Salas visitadas: {player?.visitados?.length ?? 0}</div>
              <div style={{ maxHeight: "24vh", overflowY: "auto" }}>
                {player?.visitados?.length
                  ? player.visitados.slice(-20).map((s) => <div key={s}>{s}</div>)
                  : "Nenhuma sala registrada."}
              </div>
              <div>
                Saidas:{" "}
                {room?.conexoes
                  ?.map((c) => `${c.label} -> ${c.target}${player?.visitados?.includes(c.target) ? " (visitada)" : ""}`)
                  .join(" | ") || "N/A"}
              </div>
            </div>
          )}
        </div>
      </section>

      <form onSubmit={onSubmit} style={{ ...panelStyle, display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Digite comando (ex: go 1, settarget 1, useskill golpe_pesado)..."
          style={{
            flex: 1,
            padding: "12px",
            borderRadius: 10,
            border: "1px solid #2b3040",
            background: "#0f1118",
            color: "#f5f6fb",
          }}
        />
        <button type="submit" disabled={busy} style={btnStyle}>
          Enviar
        </button>
      </form>
    </main>
  );
}

const panelStyle: React.CSSProperties = {
  background: "#12121a",
  border: "1px solid #242434",
  borderRadius: 12,
  padding: "12px",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #2f7af8",
  background: "linear-gradient(120deg, #2f7af8, #7f4bff)",
  color: "#f4f6ff",
  cursor: "pointer",
};

const btnStyleSecondary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #2b3040",
  background: "#191a24",
  color: "#dfe7f3",
  cursor: "pointer",
};

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px",
        background: active ? "#191a24" : "#12121a",
        color: active ? "#f4f6ff" : "#9fb2c8",
        border: "none",
        borderBottom: active ? "2px solid #2f7af8" : "2px solid transparent",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
