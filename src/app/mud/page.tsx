"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Player, Room, RoomState, Skill, ItemSlot } from "@/lib/game/types";
import { LINEAGES } from "@/lib/game/data/lineages";
import { RACES } from "@/lib/game/data/races";
import { BASE_CLASSES } from "@/lib/game/data/classes";
import { EQUIP_SKILLS } from "@/lib/game/data/equipSkills";
import { ITEMS } from "@/lib/game/data/items";
import { SKILLS, getSkill } from "@/lib/game/data/skills";
import { RECIPES } from "@/lib/game/data/recipes";

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
type Tab = "log" | "map" | "status";

export default function MudPage() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [logs, setLogs] = useState<string[]>([
    "Bem-vindo ao Joguinho Daora (beta) — terra de OOO!",
    "Escolha identidade/starter, explore salas, use comandos em texto. Dê feedback/sugestoes conforme testa.",
  ]);
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
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [consumableModalOpen, setConsumableModalOpen] = useState(false);
  const [craftModalOpen, setCraftModalOpen] = useState(false);

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

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/mud/chat");
        if (res.ok) {
          const data = (await res.json()) as { messages?: string[] };
          if (data.messages) setChatLog(data.messages);
        }
      } catch {
        // ignore
      }
    }, 6000);
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

  const starterSkills = useMemo(() => {
    const equipIds = new Set(Object.values(EQUIP_SKILLS).map((s) => s.id));
    return SKILLS.filter((s) => s.starterPool && !equipIds.has(s.id));
  }, []);
  const starterItems = useMemo(() => ITEMS.filter((i) => i.starter && i.tipo !== "material" && i.tipo !== "consumivel"), []);

  const visibleLogs = useMemo(() => logs.slice(-80), [logs]);

  return (
    <>
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: "12px",
          gap: "12px",
          background: "#0c0c12",
          maxWidth: 1200,
          margin: "0 auto",
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
          <h1 style={{ margin: 0, fontSize: 20 }}>Joguinho Daora</h1>
          <span style={{ color: "#8da1b9" }}>{statusLine}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy} onClick={() => setSkillModalOpen(true)} style={btnStyle}>
            Usar Habilidade
          </button>
          <button disabled={busy} onClick={() => setConsumableModalOpen(true)} style={btnStyleSecondary}>
            Usar Consumivel
          </button>
          <button disabled={busy} onClick={() => setCraftModalOpen(true)} style={btnStyleSecondary}>
            Craftar
          </button>
        </div>
      </header>

      <section style={{ ...panelStyle, padding: 0 }}>
        <div style={{ display: "flex", borderBottom: "1px solid #242434" }}>
          <TabButton active={tab === "log"} onClick={() => setTab("log")} label="Log" />
          <TabButton active={tab === "map"} onClick={() => setTab("map")} label="Mapa/Sala" />
          <TabButton active={tab === "status"} onClick={() => setTab("status")} label="Status" />
        </div>
        <div style={{ padding: 12 }}>
          {tab === "log" && (
            <div style={{ maxHeight: "52vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {[...visibleLogs].reverse().map((line, idx) => {
                const { color, label } = lineStyle(line);
                return (
                  <div
                    key={idx}
                    style={{
                      background: "linear-gradient(135deg, #0f1118, #0d1018)",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #1f2432",
                      color,
                    }}
                  >
                    {label ? <strong style={{ marginRight: 6 }}>{label}</strong> : null}
                    {line}
                  </div>
                );
              })}
            </div>
          )}
          {tab === "map" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "#c4d0dd" }}>
              {room ? (
                <>
                  <div style={{ fontWeight: 600 }}>{room.nome}</div>
                  <div style={{ color: "#9fb2c8" }}>
                    Bioma: {room.biome} | Tipo: {room.tipo} | Dificuldade: {room.dificuldade}
                  </div>
                  <div style={{ color: "#c4d0dd" }}>Conexoes visiveis: {room.conexoes.length}</div>
                  <div style={{ color: "#c4d0dd" }}>
                    Mobs:{" "}
                    {roomState && roomState.mobs.length
                      ? roomState.mobs.map((m) => `${m.mobId} HP:${Math.max(0, m.hp)}`).join(" | ")
                      : room.mobs.length
                      ? room.mobs.join(", ")
                      : "Nenhum"}
                  </div>
                  <div style={{ color: "#c4d0dd" }}>
                    Jogadores:{" "}
                    {presence.length
                      ? presence
                          .filter((p) => p.id !== player?.id)
                          .map((p) => p.nome)
                          .join(", ") || "apenas voce"
                      : "apenas voce"}
                  </div>
                  <div style={{ color: "#c4d0dd" }}>
                    Salas visitadas: {player?.visitados?.length ?? 0} | Atual: {player?.localizacao ?? room.id}
                  </div>
                </>
              ) : (
                <div>Nenhuma sala carregada.</div>
              )}
            </div>
          )}
          {tab === "status" && player && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "#c4d0dd" }}>
              <div>
                Classe base: {player.classeBase} | Arquétipos: {player.arquetipos?.join(", ") || "nenhum"} | Mutação: {player.mutacao ?? "nenhuma"}
              </div>
              <div>
                HP: {player.hp}/{player.stats.maxHp} | STA: {player.stamina}/{player.stats.maxStamina} | Escudo: {player.status?.shield ?? 0} | Drone:{" "}
                {player.status?.droneCharges ?? 0}
              </div>
              <div>Corrupcao: {player.corrupcao}% | Ouro: {player.ouro}</div>
              <div>Passivas: {player.passivas.join(", ") || "nenhuma"}</div>
              <div>
                Essencias ({player.essencias.length}/{player.slotsEssencia}):{" "}
                {player.essencias.length
                  ? player.essencias.map((id) => (
                      <span key={id} style={{ marginRight: 6 }}>
                        {id}{" "}
                        <button
                          disabled={busy}
                          style={{ ...btnStyleSecondary, padding: "3px 6px" }}
                          onClick={() => quick(`purge ${id}`)}
                        >
                          Purge
                        </button>
                      </span>
                    ))
                  : "nenhuma (use absorb <id>)"}
              </div>
              <div>
                Municao: flechas {player.inventario.find((i) => i.itemId === "flecha_bruta")?.qtd ?? 0} | facas{" "}
                {player.inventario.find((i) => i.itemId === "faca_lancavel")?.qtd ?? 0}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontWeight: 600 }}>Skills</div>
                <SkillsList player={player} busy={busy} quick={quick} now={now} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontWeight: 600 }}>Inventario</div>
                {player.inventario.length
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
      {skillModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 18,
          }}
        >
          <div style={{ background: "#12121a", padding: 16, borderRadius: 12, border: "1px solid #242434", maxWidth: 720, width: "100%", color: "#cfd1d6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Usar habilidade</h3>
              <button style={btnStyleSecondary} onClick={() => setSkillModalOpen(false)}>
                Fechar
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                  {player
                    ? resolveAvailableSkills(player).map((s) => {
                        const last = player.skillCooldowns?.[s.id] ?? 0;
                        const cdLeft = s.cooldownMs ? Math.max(0, Math.ceil((s.cooldownMs - (now - last)) / 1000)) : 0;
                        const tags = s.tags?.length ? s.tags : ["sem tags"];
                        const escalaStr = Object.entries(s.escala || {})
                          .map(([k, v]) => `${k.toUpperCase()}:${v}`)
                          .join(" | ");
                        return (
                          <div
                            key={s.id}
                            style={{
                              border: "1px solid #1f2432",
                          borderRadius: 10,
                          padding: 12,
                          background: "linear-gradient(135deg, #0f1118, #0d1018)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <div style={{ fontWeight: 700 }}>{s.nome}</div>
                          <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "#1f2432", color: "#9fb2c8" }}>
                            {s.categoria ?? "geral"} / {s.raridade ?? "comum"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {tags.map((t) => (
                            <span key={t} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 8, background: "#161b26", color: "#c4d0dd" }}>
                              {t}
                            </span>
                          ))}
                        </div>
                            <div style={{ fontSize: 13 }}>{s.descricao}</div>
                            <div style={{ fontSize: 12, color: "#c4d0dd" }}>Dano base: {s.baseDano[0]} - {s.baseDano[1]}</div>
                            {escalaStr ? <div style={{ fontSize: 11, color: "#9fb2c8" }}>Escala: {escalaStr}</div> : null}
                            <div style={{ fontSize: 12, color: "#9fb2c8" }}>
                              STA {s.custoStamina} | CD {s.cooldownMs ? `${Math.ceil(s.cooldownMs / 1000)}s` : "0s"} {cdLeft > 0 ? `(restam ${cdLeft}s)` : ""}
                            </div>
                        {s.aplica?.length ? (
                          <div style={{ fontSize: 12, color: "#c499f7" }}>
                            Aplica: {s.aplica.map((a) => `${a.efeito}(${a.duracao})${a.chance ? ` ${Math.round(a.chance * 100)}%` : ""}`).join(", ")}
                          </div>
                        ) : null}
                        <button disabled={busy || cdLeft > 0} style={btnStyleSecondary} onClick={() => quick(`useskill ${s.id}`)}>
                          {cdLeft > 0 ? `Recarga ${cdLeft}s` : "Usar"}
                        </button>
                      </div>
                    );
                  })
                : "Carregando..."}
            </div>
          </div>
        </div>
      )}
      </main>
      {consumableModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 18,
          }}
        >
          <div style={{ background: "#12121a", padding: 16, borderRadius: 12, border: "1px solid #242434", maxWidth: 620, width: "100%", color: "#cfd1d6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Usar consumível</h3>
              <button style={btnStyleSecondary} onClick={() => setConsumableModalOpen(false)}>
                Fechar
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              {player && player.inventario.filter((i) => ITEMS.find((it) => it.id === i.itemId)?.tipo === "consumivel").length
                ? player.inventario
                    .filter((i) => ITEMS.find((it) => it.id === i.itemId)?.tipo === "consumivel")
                    .map((slot) => {
                      const meta = ITEMS.find((it) => it.id === slot.itemId);
                      if (!meta) return null;
                      return (
                        <div key={slot.itemId} style={{ border: "1px solid #1f2432", borderRadius: 10, padding: 10, background: "#0f1118", display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                            <div style={{ fontWeight: 700 }}>{meta.nome}</div>
                            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "#1f2432", color: "#9fb2c8" }}>
                              {meta.raridade}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "#9fb2c8" }}>{meta.efeitos?.join("; ")}</div>
                          <div style={{ fontSize: 12, color: "#c4d0dd" }}>Quantidade: {slot.qtd}</div>
                          <button disabled={busy} style={btnStyleSecondary} onClick={() => quick(`use ${slot.itemId}`)}>
                            Usar
                          </button>
                        </div>
                      );
                    })
                : "Nenhum consumível disponível."}
            </div>
          </div>
        </div>
      )}
      {craftModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 18,
          }}
        >
          <div style={{ background: "#12121a", padding: 16, borderRadius: 12, border: "1px solid #242434", maxWidth: 720, width: "100%", color: "#cfd1d6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Crafting</h3>
              <button style={btnStyleSecondary} onClick={() => setCraftModalOpen(false)}>
                Fechar
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              {player
                ? RECIPES.filter((r) => player.recipesDescobertas?.includes(r.id)).map((r) => {
                    const canCraft = r.inputs.every((inp) => (player.inventario.find((i) => i.itemId === inp.itemId)?.qtd ?? 0) >= inp.qtd);
                    return (
                      <div key={r.id} style={{ border: "1px solid #1f2432", borderRadius: 10, padding: 12, background: "#0f1118", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ fontWeight: 700 }}>{r.nome}</div>
                        <div style={{ fontSize: 12, color: "#9fb2c8" }}>{r.descricao}</div>
                        <div style={{ fontSize: 12, color: "#c4d0dd" }}>
                          Inputs: {r.inputs.map((i) => `${i.itemId} x${i.qtd}`).join(" + ")}
                        </div>
                        <div style={{ fontSize: 12, color: "#c4d0dd" }}>
                          Output: {r.outputs.map((o) => `${o.itemId} x${o.qtd}`).join(", ")}
                        </div>
                        <button disabled={busy || !canCraft} style={btnStyleSecondary} onClick={() => quick(`craft ${r.id}`)}>
                          {canCraft ? "Craftar" : "Falta material"}
                        </button>
                      </div>
                    );
                  })
                : "Carregando..."}
              {!player?.recipesDescobertas?.length && <div>Nenhuma receita descoberta. Use pesquisar & craft para registrar.</div>}
            </div>
          </div>
        </div>
      )}
      <style jsx global>{globalStyles}</style>
    </>
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

// Ajuste leve de layout responsivo sem depender de classes globais externas
const globalStyles = `
  @media (min-width: 1024px) {
    main { gap: 14px; }
  }
`;

function resolveAvailableSkills(player: Player): Skill[] {
  const classe = BASE_CLASSES.find((c) => c.id === player.classeBase);
  const classSkills = (classe?.habilidades ?? []).map((id) => getSkill(id)).filter(Boolean) as Skill[];
  const equipSkills: Skill[] = [];
  const slots: ItemSlot[] = ["arma", "armadura", "trinket"];
  for (const slot of slots) {
    const id = player.equipamento[slot];
    if (id && EQUIP_SKILLS[id]) equipSkills.push(EQUIP_SKILLS[id]);
  }
  const unlocked = new Set(player.skillsDesbloqueadas ?? []);
  const all = [...classSkills, ...equipSkills];
  const uniq: Skill[] = [];
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (unlocked.has(s.id) || equipSkills.some((eq) => eq.id === s.id)) {
      uniq.push(s);
    }
  }
  return uniq;
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

function lineStyle(line: string): { color: string; label?: string } {
  if (line.startsWith("[GLOBAL")) return { color: "#9fffe0", label: "CHAT" };
  if (line.toLowerCase().includes("xp +")) return { color: "#b4ff91" };
  if (line.toLowerCase().includes("loot")) return { color: "#c7b8ff" };
  if (line.toLowerCase().includes("perigo") || line.toLowerCase().includes("risco")) return { color: "#ffb347" };
  if (line.toLowerCase().includes("voce cai") || line.toLowerCase().includes("morte")) return { color: "#ff8a80" };
  return { color: "#dfe7f3" };
}
