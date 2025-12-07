"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { MapPanel } from "@/components/MapPanel";
import { FeedPanel } from "@/components/FeedPanel";
import { StatusPanel } from "@/components/StatusPanel";
import { SkillsList } from "@/components/SkillsList";
import { InventoryList } from "@/components/InventoryList";
import { Leaderboard } from "@/components/Leaderboard";
import { Tips } from "@/components/Tips";
import { TagProgressPanel } from "@/components/TagProgressPanel";

type EventKind = "system" | "combat" | "chat" | "loot" | "move" | "info" | string;

type GameEvent = {
  id: string;
  text: string;
  ts: number;
  type: EventKind;
};

type ScoreEntry = { id: string; name: string; score: number };

type RoomView = {
  id: string;
  name: string;
  description: string;
  exits: { direction: string; to: string }[];
  items: string[];
  monsters: { id: string; name: string; hp: number; maxHp: number }[];
  occupants: { id: string; name: string }[];
  claimable?: boolean;
  ownerId?: string;
  ownerName?: string;
  vaultSize?: number;
  vaultCount?: number;
  danger?: number;
  biome?: string;
  siteType?: string;
  buildCost?: { gold: number; items?: string[]; energy?: number };
};

type WorldRoomView = { id: string; name: string; exits: { direction: string; to: string }[] };

type PlayerView = {
  id: string;
  name: string;
  roomId: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  score: number;
  gold: number;
  inventory: string[];
  inventoryLimit: number;
  isAlive: boolean;
  origin: { id: string; name: string; description: string };
  tendency?: string;
  affinityKnown: boolean;
  formation: string;
  attributes: {
    precision: number;
    agility: number;
    might: number;
    will: number;
    defense: number;
    resistance: number;
    recovery: number;
    crit: number;
  };
  statusEffects: {
    id: string;
    name: string;
    kind: string;
    stat?: string;
    magnitude: number;
    duration: number;
  }[];
  skills?: { id: string; name: string; kind: string; equipped: boolean; cooldown?: number }[];
  tagProgress?: Record<string, number>;
};

type Snapshot = {
  player: PlayerView;
  room: RoomView;
  world: WorldRoomView[];
  scoreboard: ScoreEntry[];
  events: GameEvent[];
  now: number;
  error?: string;
};

const eventTone: Record<EventKind, string> = {
  system: "text-emerald-200",
  combat: "text-rose-200",
  chat: "text-sky-200",
  loot: "text-amber-200",
  move: "text-indigo-200",
  info: "text-slate-100",
};

const formatClock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const attributeLabels: Record<keyof PlayerView["attributes"], string> = {
  precision: "Precisão",
  agility: "Agilidade",
  might: "Força",
  will: "Vontade",
  defense: "Defesa",
  resistance: "Resistência",
  recovery: "Recuperação",
  crit: "Crítico",
};

const itemPrices: { name: string; price: number }[] = [
  { name: "moeda de bronze", price: 2 },
  { name: "pequena runa", price: 4 },
  { name: "pelagem rija", price: 5 },
  { name: "presa trincada", price: 4 },
  { name: "tomo partido", price: 6 },
  { name: "tinta esmaecida", price: 3 },
  { name: "placa enferrujada", price: 5 },
  { name: "rebite pesado", price: 4 },
  { name: "arpão curto", price: 7 },
  { name: "gabarito de corda", price: 3 },
  { name: "estilhaço cintilante", price: 6 },
  { name: "areia cristalizada", price: 4 },
  { name: "fragmento de eco", price: 8 },
  { name: "lente rachada", price: 5 },
  { name: "erva curativa", price: 3 },
  { name: "flecha envenenada", price: 4 },
  { name: "pergaminho de faísca", price: 6 },
  { name: "fragmento de vidro", price: 2 },
  { name: "barril de pólvora", price: 6 },
  { name: "tocha curta", price: 3 },
  { name: "anzol amaldiçoado", price: 5 },
  { name: "corda reforçada", price: 3 },
  { name: "núcleo instável", price: 5 },
  { name: "pedaço de meteoro", price: 7 },
  { name: "poção de vigor", price: 6 },
  { name: "talismã rachado", price: 4 },
];

const buildAsciiMap = (roomId?: string, world?: WorldRoomView[]) => {
  if (!world || world.length === 0)
    return {
      lines: ["Use 'look' para revelar o mapa."],
      legend: [],
      overworldLines: ["Use 'look' para revelar o mapa."],
      localLines: ["Use 'look' para revelar o mapa."],
    };
  const dirs: Record<string, [number, number]> = {
    norte: [0, -1],
    sul: [0, 1],
    leste: [1, 0],
    oeste: [-1, 0],
  };
  const pos = new Map<string, { x: number; y: number }>();
  const start = world.find((r) => r.id === roomId) ?? world[0];
  pos.set(start.id, { x: 0, y: 0 });
  const queue = [start];

  while (queue.length) {
    const node = queue.shift()!;
    const base = pos.get(node.id)!;
    for (const exit of node.exits) {
      const delta = dirs[exit.direction];
      if (!delta) continue;
      const target = world.find((r) => r.id === exit.to);
      if (!target) continue;
      if (!pos.has(target.id)) {
        pos.set(target.id, { x: base.x + delta[0], y: base.y + delta[1] });
        queue.push(target);
      }
    }
  }

  const xs = Array.from(pos.values()).map((p) => p.x);
  const ys = Array.from(pos.values()).map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = (maxX - minX) * 2 + 1;
  const height = (maxY - minY) * 2 + 1;
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " "),
  );

  const place = (x: number, y: number, value: string) => {
    if (y >= 0 && y < height && x >= 0 && x < width) {
      grid[y][x] = value;
    }
  };

  for (const room of world) {
    const here = pos.get(room.id);
    if (!here) continue;
    for (const exit of room.exits) {
      const delta = dirs[exit.direction];
      if (!delta) continue;
      const target = world.find((r) => r.id === exit.to);
      if (!target) continue;
      const there = pos.get(target.id);
      if (!there) continue;
      const gx = (here.x - minX) * 2;
      const gy = (here.y - minY) * 2;
      const tx = (there.x - minX) * 2;
      const ty = (there.y - minY) * 2;
      const cx = (gx + tx) / 2;
      const cy = (gy + ty) / 2;
      place(cx, cy, delta[0] !== 0 ? "-" : "|");
    }
  }

  for (const room of world) {
    const p = pos.get(room.id);
    if (!p) continue;
    const gx = (p.x - minX) * 2;
    const gy = (p.y - minY) * 2;
    const symbol = room.id === roomId ? "@" : "o";
    place(gx, gy, symbol);
  }

  const lines = grid.map((row) => row.join(""));
  const legend = ["@ você", "o sala explorada", "-| conexões cardinais"];
  return { lines, legend, overworldLines: lines, localLines: lines };
};

const limitLog = (log: GameEvent[]) => {
  const deduped = new Map<string, GameEvent>();
  for (const item of log) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }
  const ordered = Array.from(deduped.values()).sort((a, b) => a.ts - b.ts);
  return ordered.slice(-140);
};

const fetchJSON = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json()) as Snapshot;
  if (!response.ok) {
    throw new Error(data.error || "Algo deu errado.");
  }
  return data;
};

export default function Home() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [originId, setOriginId] = useState("arcana");
  const [tendency, setTendency] = useState("precisao");
  const [mode, setMode] = useState<"guest" | "account">("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState(0);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreEntry[]>([]);
  const [world, setWorld] = useState<WorldRoomView[]>([]);
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [mapTab, setMapTab] = useState<"overworld" | "local">("overworld");
  const logRef = useRef<HTMLDivElement | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const lastSeenRef = useRef<number>(0);
  const mountedRef = useRef(false);
  const priceMap = useMemo(
    () => new Map(itemPrices.map((item) => [item.name.toLowerCase(), item.price])),
    [],
  );

  const applySnapshot = useCallback((snapshot: Snapshot) => {
    setPlayer(snapshot.player);
    setRoom(snapshot.room);
    setScoreboard(snapshot.scoreboard);
    setWorld(snapshot.world ?? []);
    if (snapshot.events?.length) {
      setLog((prev) => limitLog([...prev, ...snapshot.events]));
    }
    lastSeenRef.current = Math.max(lastSeenRef.current, snapshot.now);
  }, []);

  const joinGame = useCallback(
    async (name: string, resumeId?: string) => {
      const snapshot = await fetchJSON("/api/mud/join", {
        method: "POST",
        body: JSON.stringify({ name, playerId: resumeId, originId, tendency }),
      });

      setPlayerId(snapshot.player.id);
      setPlayerName(snapshot.player.name);
      setOriginId(snapshot.player.origin.id);
      if (snapshot.player.tendency) {
        setTendency(snapshot.player.tendency);
      }
      applySnapshot(snapshot);
      setStatus(null);
      window.localStorage.setItem(
        "mud-player",
        JSON.stringify({
          id: snapshot.player.id,
          name: snapshot.player.name,
          originId: snapshot.player.origin.id,
          tendency: snapshot.player.tendency,
        }),
      );
    },
    [applySnapshot, originId, tendency],
  );

  const handleLogout = useCallback(() => {
    try {
      window.localStorage.removeItem("mud-player");
    } catch {
      // ignore
    }
    setPlayerId(null);
    setPlayer(null);
    setRoom(null);
    setScoreboard([]);
    setLog([]);
    setStatus(null);
    setStep(0);
    setCommand("");
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    const saved = window.localStorage.getItem("mud-player");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        id?: string;
        name?: string;
        originId?: string;
        tendency?: string;
        email?: string;
      };
      if (parsed?.name && parsed?.id) {
        if (parsed.originId) setOriginId(parsed.originId);
        if (parsed.tendency) setTendency(parsed.tendency);
        if (parsed.email) setEmail(parsed.email);
        joinGame(parsed.name, parsed.id).catch(() =>
          setStatus("Sessão expirada. Entre novamente."),
        );
      }
    } catch {
      // ignore invalid cache
    }
  }, [joinGame]);

  useEffect(() => {
    if (!playerId) return;

    const tick = async () => {
      try {
        const since = lastSeenRef.current ? `&since=${lastSeenRef.current}` : "";
        const snapshot = await fetchJSON(`/api/mud/state?playerId=${playerId}${since}`);
        applySnapshot(snapshot);
      } catch (error) {
        setStatus((error as Error).message);
      }
    };

    const interval = window.setInterval(tick, 2300);
    tick();
    return () => window.clearInterval(interval);
  }, [playerId, applySnapshot]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    if (!playerName.trim()) {
      setStatus("Escolha um codinome para entrar.");
      return;
    }
    if (mode === "account" && (!email.trim() || !password.trim())) {
      setStatus("Preencha email e senha para conta.");
      return;
    }

    if (step < 2) {
      setStep((prev) => Math.min(2, prev + 1));
      return;
    }

    try {
      setIsJoining(true);
      const snapshot = await fetchJSON("/api/mud/join", {
        method: "POST",
        body: JSON.stringify({
          name: playerName.trim(),
          originId,
          tendency,
          email: mode === "account" ? email.trim() : undefined,
          password: mode === "account" ? password : undefined,
        }),
      });
      applySnapshot(snapshot);
      setPlayerId(snapshot.player.id);
      setPlayerName(snapshot.player.name);
      setOriginId(snapshot.player.origin.id);
      if (snapshot.player.tendency) setTendency(snapshot.player.tendency);
      window.localStorage.setItem(
        "mud-player",
        JSON.stringify({
          id: snapshot.player.id,
          name: snapshot.player.name,
          originId: snapshot.player.origin.id,
          tendency: snapshot.player.tendency,
          email: mode === "account" ? email.trim() : undefined,
        }),
      );
      setStatus(null);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsJoining(false);
    }
  };

  const handleCommand = async (event: FormEvent) => {
    event.preventDefault();
    if (!playerId) return;
    const payload = command.trim();
    if (!payload) return;
    setCommand("");

    try {
      const snapshot = await fetchJSON("/api/mud/command", {
        method: "POST",
        body: JSON.stringify({ playerId, command: payload }),
      });
      applySnapshot(snapshot);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const hpPercent = useMemo(() => {
    if (!player) return 0;
    return Math.max(0, Math.min(100, Math.round((player.hp / player.maxHp) * 100)));
  }, [player]);

  const energyPercent = useMemo(() => {
    if (!player) return 0;
    return Math.max(
      0,
      Math.min(100, Math.round((player.energy / (player.maxEnergy || 1)) * 100)),
    );
  }, [player]);

  const asciiMap = useMemo(
    () => buildAsciiMap(player?.roomId, world),
    [player?.roomId, world],
  );

  const handleResetSession = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("mud-player");
      window.location.reload();
    }
  }, []);

  const inventoryCount = player?.inventory.length ?? 0;
  const inventoryLimit = player?.inventoryLimit ?? 12;
  const connected = Boolean(playerId);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.12),transparent_26%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.08),transparent_25%),radial-gradient(circle_at_30%_70%,rgba(248,113,113,0.08),transparent_24%)]" />
      <div className="absolute inset-0 opacity-[0.06] mix-blend-screen [background-image:linear-gradient(0deg,transparent_24%,rgba(255,255,255,0.05)_25%,rgba(255,255,255,0.05)_26%,transparent_27%,transparent_74%,rgba(255,255,255,0.05)_75%,rgba(255,255,255,0.05)_76%,transparent_77%),linear-gradient(90deg,transparent_24%,rgba(255,255,255,0.05)_25%,rgba(255,255,255,0.05)_26%,transparent_27%,transparent_74%,rgba(255,255,255,0.05)_75%,rgba(255,255,255,0.05)_76%,transparent_77%)] [background-size:40px_40px]" />

      <main className="relative mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 md:px-5 scanline">
        <TopBar
          connected={connected}
          player={player}
          inventoryCount={inventoryCount}
          inventoryLimit={inventoryLimit}
          onLogout={handleLogout}
          onResetSession={handleResetSession}
        />

        {!connected ? (
          <section className="grid gap-6 lg:grid-cols-5">
            <form
              onSubmit={handleJoin}
              className="space-y-4 rounded-3xl border border-emerald-500/30 bg-slate-950/80 p-6 shadow-xl shadow-emerald-900/40 backdrop-blur lg:col-span-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-emerald-100">Criação de personagem</h2>
                <span className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">
                  Passo {step + 1}/3
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs uppercase text-slate-400">
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1 ${
                    mode === "account"
                      ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-600 bg-slate-800/80"
                  }`}
                  onClick={() => setMode("account")}
                >
                  Conta
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1 ${
                    mode === "guest"
                      ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-600 bg-slate-800/80"
                  }`}
                  onClick={() => setMode("guest")}
                >
                  Convidado
                </button>
                <span className="ml-auto text-[10px] lowercase tracking-[0.2em] text-slate-400">
                  {mode === "account"
                    ? "Salvo por email/senha (demo em memória)"
                    : "Sessão temporária"}
                </span>
              </div>

              {step === 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {mode === "account" && (
                    <>
                      <label className="text-sm text-slate-200">
                        Email
                        <input
                          className="mt-1 w-full rounded-2xl border border-emerald-500/40 bg-slate-950/70 px-3 py-2 text-sm text-emerald-50 outline-none transition focus:border-emerald-300 focus:bg-slate-900"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          type="email"
                          autoComplete="email"
                          placeholder="voce@exemplo.com"
                        />
                      </label>
                      <label className="text-sm text-slate-200">
                        Senha
                        <input
                          className="mt-1 w-full rounded-2xl border border-emerald-500/40 bg-slate-950/70 px-3 py-2 text-sm text-emerald-50 outline-none transition focus:border-emerald-300 focus:bg-slate-900"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          type="password"
                          autoComplete="current-password"
                          placeholder="••••••"
                        />
                      </label>
                    </>
                  )}
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 text-sm text-slate-300">
                    <p className="text-[11px] uppercase text-emerald-200">Progresso</p>
                    <p className="mt-2">Passo 1: Conta ou convidado.</p>
                    <p>Próximo: Escolha sua origem e tendência.</p>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-200">
                    Origem
                    <select
                      className="mt-1 w-full rounded-2xl border border-emerald-500/40 bg-slate-950/70 px-3 py-2 text-sm text-emerald-50 outline-none transition focus:border-emerald-300 focus:bg-slate-900"
                      value={originId}
                      onChange={(event) => setOriginId(event.target.value)}
                    >
                      <option value="arcana">Arcana/Oculta</option>
                      <option value="nocturna">Nocturna/Sanguínea</option>
                      <option value="forja">Forja/Engenharia</option>
                      <option value="mitica">Mítica/Constelação</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-200">
                    Tendência desejada
                    <select
                      className="mt-1 w-full rounded-2xl border border-emerald-500/40 bg-slate-950/70 px-3 py-2 text-sm text-emerald-50 outline-none transition focus:border-emerald-300 focus:bg-slate-900"
                      value={tendency}
                      onChange={(event) => setTendency(event.target.value)}
                    >
                      <option value="precisao">Precisão (ranged)</option>
                      <option value="agilidade">Agilidade (esquiva/velocidade)</option>
                      <option value="forca">Força (corpo a corpo)</option>
                      <option value="vontade">Vontade (magia/status)</option>
                      <option value="defesa">Defesa (sustentação)</option>
                    </select>
                  </label>
                  <div className="sm:col-span-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 text-sm text-slate-300">
                    <p className="text-[11px] uppercase text-emerald-200">Dica</p>
                    <p className="mt-1">
                      Origem define afinidades possíveis e ranges de atributos. Tendência só puxa o
                      dado inicial; o jogo ainda pode revelar outra afinidade.
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 text-sm text-slate-200">
                  <p className="text-[11px] uppercase text-emerald-200">Resumo</p>
                  <p>
                    Código: <span className="text-emerald-100">{playerName || "..."}</span>
                  </p>
                  <p>
                    Origem: <span className="text-emerald-100">{originId}</span>
                  </p>
                  <p>
                    Tendência: <span className="text-emerald-100">{tendency}</span>
                  </p>
                  <p>
                    Conta:{" "}
                    <span className="text-emerald-100">
                      {mode === "account" ? email || "(preencha)" : "Convidado"}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Afinidade continua oculta e será despertada na caverna. Itens podem ter efeitos exclusivos conforme origem.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  className="w-full rounded-2xl border border-emerald-500/40 bg-slate-950/70 px-4 py-3 text-base text-emerald-50 outline-none transition focus:border-emerald-300 focus:bg-slate-900"
                  placeholder="Ex.: Lâmina Azul"
                  maxLength={18}
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  disabled={isJoining}
                />
                <div className="flex gap-2">
                  {step > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep((prev) => Math.max(0, prev - 1))}
                      className="rounded-2xl border border-slate-600 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-emerald-400"
                    >
                      Voltar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isJoining}
                    className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  >
                    {isJoining ? "Entrando..." : step < 2 ? "Próximo" : "Entrar na Arena"}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-500/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                <p className="text-emerald-200">Comandos principais</p>
                <p className="mt-2">
                  Mova-se com{" "}
                  <span className="text-emerald-300">norte/sul/leste/oeste</span> ou{" "}
                  <span className="text-emerald-300">n/s/l/o</span>, ataque com{" "}
                  <span className="text-emerald-300">attack</span>, investigue com{" "}
                  <span className="text-emerald-300">look</span>, fale com{" "}
                  <span className="text-emerald-300">say &lt;mensagem&gt;</span>. Digite{" "}
                  <span className="text-emerald-300">help</span> para a lista completa.
                </p>
              </div>
            </form>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-8">
              <MapPanel
                asciiMap={asciiMap}
                mapTab={mapTab}
                onTabChange={setMapTab}
                worldCount={world.length}
                seedLabel={process.env.NEXT_PUBLIC_WORLD_SEED ?? "frag-world"}
              />
              <FeedPanel
                log={log}
                logRef={logRef}
                command={command}
                setCommand={setCommand}
                onSubmit={handleCommand}
                formatClock={formatClock}
                eventTone={eventTone}
              />
            </div>
            {/* Sidebar direita */}
            <aside className="space-y-3 lg:col-span-4">
              <StatusPanel
                player={player}
                hpPercent={hpPercent}
                energyPercent={energyPercent}
                attributeLabels={attributeLabels}
              />
              <TagProgressPanel tagProgress={player?.tagProgress} />
              <SkillsList skills={player?.skills} />
              <InventoryList items={player?.inventory ?? []} priceMap={priceMap} />
              <Leaderboard scoreboard={scoreboard} />
              <Tips />
            </aside>
          </section>
        )}

        {status && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 shadow-lg shadow-rose-900/30">
            {status}
          </div>
        )}
      </main>
    </div>
  );
}




