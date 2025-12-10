"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Player, Room, RoomState, Skill, ItemSlot } from "@/lib/game/types";
import { LINEAGES } from "@/lib/game/data/lineages";
import { RACES } from "@/lib/game/data/races";
import { BASE_CLASSES } from "@/lib/game/data/classes";
import { EQUIP_SKILLS } from "@/lib/game/data/equipSkills";
import { ITEMS } from "@/lib/game/data/items";
import { SKILLS } from "@/lib/game/data/skills";

type ApiResponse = {
  playerId: string;
  log: string[];
  player: Player;
  room?: Room;
  roomState?: RoomState;
  chatMessages?: string[];
  presence?: { id: string; nome: string }[];
};

const storageKey = "mud-player-id";
type Tab = "log" | "sala" | "inv" | "ess" | "map" | "status" | "chat";

export default function MudPage() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [logs, setLogs] = useState<string[]>(["Bem-vindo ao MUD persistente."]);
  const [chatLog, setChatLog] = useState<string[]>([]);
  const [presence, setPresence] = useState<{ id: string; nome: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("log");
  const [linSel, setLinSel] = useState<string>(LINEAGES[0]?.id ?? "magica");
  const [raceSel, setRaceSel] = useState<string>(RACES[0]?.id ?? "humano");
  const [classSel, setClassSel] = useState<string>(BASE_CLASSES[0]?.id ?? "vanguarda");
  const [now, setNow] = useState<number>(Date.now());
  const [starterSkillA, setStarterSkillA] = useState<string>("");
  const [starterSkillB, setStarterSkillB] = useState<string>("");
  const [starterItem, setStarterItem] = useState<string>("");

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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const statusLine = useMemo(() => {
    if (!player) return "Sem dados.";
    return `Lv ${player.nivel} | ${player.race} ${player.classeBase} | Linhagem ${player.lineage} | XP ${player.xp} | HP ${player.hp}/${player.stats.maxHp} | STA ${player.stamina}/${player.stats.maxStamina} | Ouro ${player.ouro} | Corrupcao ${player.corrupcao}%`;
  }, [player]);

  const suggestions = useMemo(() => {
    const tips: string[] = ["look", "map"];
    if (player?.hp && player?.stats?.maxHp && player.hp < player.stats.maxHp * 0.5) tips.push("rest");
    if (roomState?.loot?.length) tips.push("loot");
    const targetable = roomState?.mobs?.find((m) => m.alive);
    if (targetable) tips.push("settarget 1");
    const firstSkill = player?.skillsDesbloqueadas?.[0];
    if (firstSkill) tips.push(`useskill ${firstSkill}`);
    return Array.from(new Set(tips)).slice(0, 6);
  }, [player, roomState]);

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
      if (data.chatMessages) setChatLog(data.chatMessages);
      if (data.presence) setPresence(data.presence);
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

  const showIdentityPicker = useMemo(() => player && !player.lockedIdentity, [player]);
  const showStarterPicker = useMemo(() => player && player.starterEscolhido === false, [player]);

  const starterSkills = useMemo(() => SKILLS.filter((s) => s.starterPool), []);
  const starterItems = useMemo(() => ITEMS.filter((i) => i.starter && i.tipo !== "material" && i.tipo !== "consumivel"), []);

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
          <button disabled={busy} onClick={() => quick("map")} style={btnStyleSecondary}>
            Map
          </button>
          <button disabled={busy} onClick={() => quick("inventory")} style={btnStyleSecondary}>
            Inventario
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
          <TabButton active={tab === "status"} onClick={() => setTab("status")} label="Status" />
          <TabButton active={tab === "inv"} onClick={() => setTab("inv")} label="Inventario" />
          <TabButton active={tab === "ess"} onClick={() => setTab("ess")} label="Essencias" />
          <TabButton active={tab === "map"} onClick={() => setTab("map")} label="Mapa" />
          <TabButton active={tab === "skills"} onClick={() => setTab("skills")} label="Skills" />
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")} label="Chat" />
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
                  <div style={{ color: "#c4d0dd" }}>
                    Jogadores:{' '}
                    {presence.length
                      ? presence
                          .filter((p) => p.id !== player?.id)
                          .map((p) => p.nome)
                          .join(", ") || "apenas voce"
                      : "apenas voce"}
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
                ? player.inventario.map((i) => {
                    const meta = ITEMS.find((it) => it.id === i.itemId);
                    const label = meta ? `${meta.nome} (${meta.tipo}/${meta.raridade})` : i.itemId;
                    const efeitos = meta?.efeitos?.join("; ") ?? "desconhecido";
                    return (
                      <div key={i.itemId} style={{ display: "flex", flexDirection: "column", gap: 4, border: "1px solid #1f2432", borderRadius: 8, padding: "6px 8px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <span>
                            {label} x{i.qtd} | Peso {meta?.peso ?? "?"}
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
                        <div style={{ color: "#9fb2c8", fontSize: 13 }}>Efeitos: {efeitos}</div>
                      </div>
                    );
                  })
                : "Inventario vazio."}
            </div>
          )}
          {tab === "status" && player && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "#c4d0dd" }}>
              <div>
                Classe: {player.classeBase} | Raca: {player.race} | Linhagem: {player.lineage}
              </div>
              <div>
                HP: {player.hp}/{player.stats.maxHp} | STA: {player.stamina}/{player.stats.maxStamina} | Escudo: {player.status?.shield ?? 0} | Drone:{" "}
                {player.status?.droneCharges ?? 0}
              </div>
              <div>Corrupcao: {player.corrupcao}% | Ouro: {player.ouro}</div>
              <div>Passivas: {player.passivas.join(", ") || "nenhuma"}</div>
              <div>Essencias: {player.essencias.join(", ") || "nenhuma"}</div>
              <div>Skills: {player.skillsDesbloqueadas?.join(", ") || "use skills para listar"}</div>
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
          {tab === "skills" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "#c4d0dd" }}>
              <div>Use o comando skills no terminal ou escolha uma skill abaixo:</div>
              <SkillsList player={player} busy={busy} quick={quick} now={now} />
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
              <div>Ultima morte: {player?.ultimaMorte ?? "nenhuma"}</div>
              <div>
                Saidas:{" "}
                {room?.conexoes
                  ?.map((c) => `${c.label} -> ${c.target}${player?.visitados?.includes(c.target) ? " (visitada)" : ""}`)
                  .join(" | ") || "N/A"}
              </div>
            </div>
          )}
          {tab === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, color: "#c4d0dd" }}>
              <div style={{ fontWeight: 600 }}>Chat Global (use comando: chat &lt;mensagem&gt;)</div>
              <div style={{ maxHeight: "30vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {chatLog.length ? chatLog.map((m, idx) => <div key={idx}>{m}</div>) : <div>Nenhuma mensagem.</div>}
              </div>
            </div>
          )}
        </div>
      </section>

      <form onSubmit={onSubmit} style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 8 }}>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={busy} style={btnStyleSecondary} onClick={() => quick(s)}>
              {s}
            </button>
          ))}
        </div>
        <button type="submit" disabled={busy} style={btnStyle}>
          Enviar
        </button>
      </form>

      {showIdentityPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 20,
          }}
        >
          <div style={{ background: "#12121a", padding: 16, borderRadius: 12, border: "1px solid #242434", maxWidth: 420, width: "100%", color: "#cfd1d6" }}>
            <h3 style={{ marginTop: 0 }}>Escolha sua identidade</h3>
            <label style={{ display: "block", marginBottom: 8 }}>
              Linhagem:
              <select value={linSel} onChange={(e) => setLinSel(e.target.value)} style={selectStyle}>
                {LINEAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} - {l.nome}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              Raca:
              <select value={raceSel} onChange={(e) => setRaceSel(e.target.value)} style={selectStyle}>
                {RACES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} - {r.nome}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              Classe:
              <select value={classSel} onChange={(e) => setClassSel(e.target.value)} style={selectStyle}>
                {BASE_CLASSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} - {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={btnStyle}
                disabled={busy}
                onClick={() => {
                  void sendCommand(`identity ${linSel} ${raceSel} ${classSel}`);
                  setTab("status");
                }}
                type="button"
              >
                Confirmar
              </button>
              <button style={btnStyleSecondary} type="button" onClick={() => setTab("status")}>
                Ver status
              </button>
            </div>
          </div>
        </div>
      )}
      {showStarterPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 19,
          }}
        >
          <div style={{ background: "#12121a", padding: 16, borderRadius: 12, border: "1px solid #242434", maxWidth: 520, width: "100%", color: "#cfd1d6" }}>
            <h3 style={{ marginTop: 0 }}>Escolha inicial</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                Skills básicas (escolha 2):
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                  {starterSkills.map((s) => (
                    <label key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", background: "#0f1118", padding: "6px 8px", borderRadius: 8, border: "1px solid #1f2432" }}>
                      <input
                        type="checkbox"
                        checked={starterSkillA === s.id || starterSkillB === s.id}
                        onChange={() => {
                          if (starterSkillA === s.id) setStarterSkillA("");
                          else if (starterSkillB === s.id) setStarterSkillB("");
                          else if (!starterSkillA) setStarterSkillA(s.id);
                          else if (!starterSkillB) setStarterSkillB(s.id);
                          else setStarterSkillA(s.id); // substitui
                        }}
                      />
                      <span>
                        {s.id} - {s.nome}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                Item inicial:
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                  {starterItems.map((it) => (
                    <label key={it.id} style={{ display: "flex", gap: 6, alignItems: "center", background: "#0f1118", padding: "6px 8px", borderRadius: 8, border: "1px solid #1f2432" }}>
                      <input type="radio" name="starterItem" checked={starterItem === it.id} onChange={() => setStarterItem(it.id)} />
                      <span>
                        {it.id} - {it.nome} ({it.tipo})
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={btnStyle}
                  disabled={busy || !(starterSkillA && starterSkillB && starterItem)}
                  onClick={() => {
                    if (starterSkillA && starterSkillB && starterItem) {
                      void sendCommand(`starter ${starterSkillA} ${starterSkillB} ${starterItem}`);
                      setTab("status");
                    }
                  }}
                  type="button"
                >
                  Confirmar starter
                </button>
                <button style={btnStyleSecondary} type="button" onClick={() => setTab("status")}>
                  Ver status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  marginTop: 4,
  borderRadius: 8,
  border: "1px solid #2b3040",
  background: "#0f1118",
  color: "#f5f6fb",
};

function resolveAvailableSkills(player: Player): Skill[] {
  const classe = BASE_CLASSES.find((c) => c.id === player.classeBase);
  const classSkills = classe?.habilidades ?? [];
  const equipSkills: Skill[] = [];
  const slots: ItemSlot[] = ["arma", "armadura", "trinket"];
  for (const slot of slots) {
    const id = player.equipamento[slot];
    if (id && EQUIP_SKILLS[id]) equipSkills.push(EQUIP_SKILLS[id]);
  }
  const unlocked = new Set(player.skillsDesbloqueadas ?? []);
  const all = [...classSkills, ...equipSkills];
  return all.filter((s) => unlocked.has(s.id) || equipSkills.some((eq) => eq.id === s.id));
}

function SkillsList({ player, busy, quick, now }: { player: Player | null; busy: boolean; quick: (cmd: string) => void; now: number }) {
  if (!player) return <div>Carregando...</div>;
  const skills = resolveAvailableSkills(player);
  if (!skills.length) return <div>Nenhuma skill disponivel.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {skills.map((skill) => {
        const last = player.skillCooldowns?.[skill.id] ?? 0;
        const remaining = skill.cooldownMs ? Math.max(0, Math.ceil((skill.cooldownMs - (now - last)) / 1000)) : 0;
        return (
          <div key={skill.id} style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
            <span>
              {skill.nome} [{skill.categoria ?? "geral"}/{skill.raridade ?? "comum"}] {remaining > 0 ? `(CD ${remaining}s)` : ""}
            </span>
            <button disabled={busy || remaining > 0} style={btnStyleSecondary} onClick={() => quick(`useskill ${skill.id}`)}>
              Usar
            </button>
          </div>
        );
      })}
    </div>
  );
}
