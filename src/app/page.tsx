"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  monster?: { name: string; hp: number; maxHp: number };
  occupants: { id: string; name: string }[];
};

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
  statusEffects: { id: string; name: string; kind: string; stat?: string; magnitude: number; duration: number }[];
};

type Snapshot = {
  player: PlayerView;
  room: RoomView;
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

const miniMap = (roomId?: string) => {
  const grid = [
    ["", "torre", ""],
    ["porto", "praca", "floresta"],
    ["", "mina", ""],
    ["", "caverna", "cratera"],
  ];
  const nameFor = (id: string) => {
    if (id === "praca") return "Praça";
    if (id === "caverna") return "Cav.";
    if (id === "cratera") return "Crat.";
    return id.charAt(0).toUpperCase() + id.slice(1, 4);
  };
  const lines: string[] = [];
  grid.forEach((row) => {
    const line = row
      .map((cell) => {
        if (!cell) return "   ";
        if (cell === roomId) return "[P]";
        return `[${nameFor(cell).padEnd(2, " ").slice(0, 2)}]`;
      })
      .join(" ");
    lines.push(line);
  });
  return lines.join("\n");
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
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
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
      const parsed = JSON.parse(saved) as { id?: string; name?: string; originId?: string; tendency?: string; email?: string };
      if (parsed?.name && parsed?.id) {
        if (parsed.originId) setOriginId(parsed.originId);
        if (parsed.tendency) setTendency(parsed.tendency);
        if (parsed.email) setEmail(parsed.email);
        joinGame(parsed.name, parsed.id).catch(() => setStatus("Sessão expirada. Entre novamente."));
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
    return Math.max(0, Math.min(100, Math.round((player.energy / (player.maxEnergy || 1)) * 100)));
  }, [player]);

  const inventoryCount = player?.inventory.length ?? 0;
  const inventoryLimit = player?.inventoryLimit ?? 12;
  const connected = Boolean(playerId);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.12),transparent_26%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.08),transparent_25%),radial-gradient(circle_at_30%_70%,rgba(248,113,113,0.08),transparent_24%)]" />
      <div className="absolute inset-0 opacity-[0.06] mix-blend-screen [background-image:linear-gradient(0deg,transparent_24%,rgba(255,255,255,0.05)_25%,rgba(255,255,255,0.05)_26%,transparent_27%,transparent_74%,rgba(255,255,255,0.05)_75%,rgba(255,255,255,0.05)_76%,transparent_77%),linear-gradient(90deg,transparent_24%,rgba(255,255,255,0.05)_25%,rgba(255,255,255,0.05)_26%,transparent_27%,transparent_74%,rgba(255,255,255,0.05)_75%,rgba(255,255,255,0.05)_76%,transparent_77%)] [background-size:40px_40px]" />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 md:px-6 scanline">
        <header className="flex flex-col gap-4 rounded-3xl border border-emerald-500/25 bg-slate-950/80 p-6 shadow-lg shadow-emerald-900/40 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300">Arena MUD</p>
            <h1 className="font-[\'Press Start 2P\'] text-2xl text-emerald-100 sm:text-3xl">
              Frag Echoes ▮ RPG de texto online
            </h1>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              Entre com um codinome, digite comandos e dispute espaço contra outros jogadores em tempo real. Explore salas, lute contra criaturas e apareça no placar.
            </p>
          </div>

            <div className="flex flex-col gap-2 text-sm lg:items-end">
              <div className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`}
                />
                <span className="text-slate-200">
                  {connected ? `Conectado como ${player?.name ?? "?"}` : "Aguardando conexão"}
                </span>
                {connected && (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-full border border-rose-400/60 bg-rose-500/10 px-3 py-1 text-xs text-rose-100 hover:border-rose-300 transition"
                  >
                    Sair
                  </button>
                )}
              </div>
            {player && (
              <div className="flex flex-wrap justify-end gap-2 text-[12px] text-emerald-100">
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1">
                  Ouro: {player.gold}
                </span>
                <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1">
                  Inventário: {inventoryCount}/{inventoryLimit}
                </span>
                <span className="rounded-full border border-slate-500/40 bg-slate-800/50 px-3 py-1">
                  Persistência: memória (demo)
                </span>
              </div>
            )}
          </div>
        </header>

        {!connected ? (
          <section className="grid gap-6 lg:grid-cols-5">
            <form
              onSubmit={handleJoin}
              className="lg:col-span-3 space-y-4 rounded-3xl border border-emerald-500/30 bg-slate-950/80 p-6 shadow-xl shadow-emerald-900/40 backdrop-blur"
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
                  className={`rounded-full border px-3 py-1 ${mode === "account" ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200" : "border-slate-600 bg-slate-800/80"}`}
                  onClick={() => setMode("account")}
                >
                  Conta
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1 ${mode === "guest" ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200" : "border-slate-600 bg-slate-800/80"}`}
                  onClick={() => setMode("guest")}
                >
                  Convidado
                </button>
                <span className="ml-auto text-[10px] lowercase tracking-[0.2em] text-slate-400">
                  {mode === "account" ? "Salvo por email/senha (demo em memória)" : "Sessão temporária"}
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
                    <p className="text-emerald-200 uppercase text-[11px]">Progresso</p>
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
                    <p className="text-emerald-200 uppercase text-[11px]">Dica</p>
                    <p className="mt-1">
                      Origem define afinidades possíveis e ranges de atributos. Tendência só puxa o dado inicial; o jogo ainda pode revelar outra afinidade.
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 text-sm text-slate-200">
                  <p className="text-emerald-200 uppercase text-[11px]">Resumo</p>
                  <p>Código: <span className="text-emerald-100">{playerName || "..."}</span></p>
                  <p>Origem: <span className="text-emerald-100">{originId}</span></p>
                  <p>Tendência: <span className="text-emerald-100">{tendency}</span></p>
                  <p>Conta: <span className="text-emerald-100">{mode === "account" ? email || "(preencha)" : "Convidado"}</span></p>
                  <p className="text-slate-400 text-xs">
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
                  Mova-se com <span className="text-emerald-300">norte/sul/leste/oeste</span> ou{" "}
                  <span className="text-emerald-300">n/s/l/o</span>, ataque com{" "}
                  <span className="text-emerald-300">attack</span>, investigue com{" "}
                  <span className="text-emerald-300">look</span>, fale com{" "}
                  <span className="text-emerald-300">say &lt;mensagem&gt;</span>. Digite{" "}
                  <span className="text-emerald-300">help</span> para a lista completa.
                </p>
              </div>
            </form>

            <aside className="lg:col-span-2 space-y-3 rounded-3xl border border-indigo-500/15 bg-slate-900/60 p-6 shadow-xl shadow-indigo-900/30 backdrop-blur">
              <h3 className="text-lg font-semibold text-indigo-100">O que torna competitivo?</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li>• Placar ao vivo para quem acumula mais pontuação.</li>
                <li>• Ações e falas aparecem no feed global: você vê outros jogadores.</li>
                <li>• Monstros únicos por sala: quem chega primeiro leva os pontos.</li>
              </ul>
              <p className="text-xs text-slate-400">
                Tudo fica em memória do servidor Next.js. Em produção, use Redis/Postgres e WebSockets para persistir e escalar.
              </p>
            </aside>
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-3xl border border-emerald-500/20 bg-slate-900/80 p-6 shadow-xl shadow-emerald-900/30 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">Sala atual</p>
                    <h2 className="text-2xl font-semibold text-emerald-100">{room?.name}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs uppercase text-slate-200">
                    {room?.exits.map((exit) => (
                      <span
                        key={`${exit.direction}-${exit.to}`}
                        className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1"
                      >
                        {exit.direction} → {exit.to}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-slate-200">{room?.description}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-emerald-500/20 bg-slate-950/60 px-4 py-2">
                    Itens: {room?.items.length ? room.items.join(", ") : "nenhum item visível"}
                  </div>
                  <div className="rounded-2xl border border-slate-500/30 bg-slate-950/60 px-4 py-2">
                    Jogadores aqui: {room?.occupants.length ? room.occupants.map((o) => o.name).join(", ") : "só você"}
                  </div>
                  {room?.monster ? (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-rose-100">
                      Inimigo: {room.monster.name} ({room.monster.hp}/{room.monster.maxHp} HP)
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-indigo-100">
                      Nenhum inimigo ativo aqui.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-700/50 bg-slate-950/70 shadow-xl shadow-black/40">
                <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Feed</p>
                    <h3 className="text-lg font-semibold text-slate-100">Eventos em tempo real</h3>
                  </div>
                  <div className="flex gap-2 text-[11px] uppercase text-slate-400">
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1">world</span>
                    <span className="rounded-full bg-indigo-500/10 px-3 py-1">local</span>
                  </div>
                </div>

                <div
                  ref={logRef}
                  className="h-[360px] space-y-2 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-slate-100"
                >
                  {log.length === 0 && (
                    <p className="text-slate-400">Nenhum evento ainda. Digite um comando para começar.</p>
                  )}
                  {log.map((event) => (
                    <div key={event.id} className="flex gap-3">
                      <span className="text-[11px] text-slate-500">
                        {formatClock.format(new Date(event.ts))}
                      </span>
                      <p className={`${eventTone[event.type] ?? "text-slate-100"}`}>{event.text}</p>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleCommand} className="border-t border-slate-800/80 px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="Digite: north | attack | say bora? | look"
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400 focus:bg-slate-900"
                    />
                    <button
                      type="submit"
                      className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    >
                      Enviar
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                    {["look", "attack", "rest", "say oi!", "help"].map((shortcut) => (
                      <button
                        type="button"
                        key={shortcut}
                        className="rounded-full border border-slate-700/80 bg-slate-900 px-3 py-1 text-emerald-100 transition hover:border-emerald-400/70"
                        onClick={() => setCommand(shortcut)}
                      >
                        {shortcut}
                      </button>
                    ))}
                  </div>
                </form>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-3xl border border-emerald-500/25 bg-slate-900/80 p-5 shadow-lg shadow-emerald-900/30 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">Status</p>
                <h3 className="text-xl font-semibold text-emerald-100">{player?.name}</h3>
                <p className="text-xs text-slate-400">
                  Origem: <span className="text-emerald-200">{player?.origin.name}</span>
                </p>
                <p className="text-xs text-slate-400">
                  Tendência pedida: <span className="text-emerald-200">{player?.tendency ?? "equilíbrio"}</span>
                </p>
                <p className="text-xs text-slate-400">
                  Afinidade:{" "}
                  <span className="text-emerald-200">
                    {player?.affinityKnown ? "desperta" : "oculta (revele no altar)"}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  Ouro: <span className="text-emerald-200">{player?.gold ?? 0}</span>
                </p>
                <p className="text-xs text-slate-400">
                  Inventário:{" "}
                  <span className="text-emerald-200">
                    {inventoryCount}/{inventoryLimit}
                  </span>
                </p>

                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>HP</span>
                      <span>
                        {player?.hp}/{player?.maxHp}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                        style={{ width: `${hpPercent}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Energia</span>
                      <span>
                        {player?.energy}/{player?.maxEnergy}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-500"
                        style={{ width: `${energyPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Placar pessoal</span>
                    <span className="text-lg font-semibold text-emerald-200">{player?.score ?? 0} pts</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300">
                    {player &&
                      Object.entries(player.attributes).map(([key, value]) => (
                        <span key={key} className="flex items-center justify-between">
                          <span>{attributeLabels[key as keyof PlayerView["attributes"]]}</span>
                          <span className="text-emerald-200">{value}</span>
                        </span>
                      ))}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-200">
                    {player?.statusEffects.length ? (
                      player.statusEffects.map((effect) => (
                        <span
                          key={effect.id}
                          className={`rounded-full px-3 py-1 border ${
                            effect.kind === "buff"
                              ? "border-emerald-400/50 bg-emerald-500/10"
                              : "border-rose-400/50 bg-rose-500/10"
                          }`}
                        >
                          {effect.name} ({effect.duration})
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">Sem efeitos ativos.</span>
                    )}
                  </div>
                  {!player?.isAlive && (
                    <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-100">
                      Você está fora de combate. Digite <span className="font-semibold">respawn</span> para voltar.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-indigo-500/20 bg-slate-900/70 p-5 shadow-lg shadow-indigo-900/30 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.28em] text-indigo-200">Mapa</p>
                <pre className="mt-3 whitespace-pre text-xs leading-5 text-indigo-100 bg-slate-950/60 rounded-2xl p-4 border border-slate-800">
{miniMap(player?.roomId)}
                </pre>
                <p className="mt-2 text-[11px] text-slate-400">
                  Use &apos;look&apos; para ver saídas. Vá à caverna para despertar sua afinidade.
                </p>
              </div>

              <div className="rounded-3xl border border-indigo-500/20 bg-slate-900/70 p-5 shadow-lg shadow-indigo-900/30 backdrop-blur">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.28em] text-indigo-200">Inventário</p>
                  <span className="text-[11px] text-slate-400">
                    {inventoryCount}/{inventoryLimit} • Ouro: {player?.gold ?? 0}
                  </span>
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-200">
                  {player?.inventory.length ? (
                    player.inventory.map((item) => {
                      const price = priceMap.get(item.toLowerCase());
                      return (
                        <div
                          key={item}
                          className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2"
                        >
                          <div className="flex flex-col">
                            <span>{item}</span>
                            {price !== undefined && (
                              <span className="text-[11px] text-amber-200">{price} ouro (vender)</span>
                            )}
                          </div>
                          <div className="flex gap-3 text-xs">
                            <button
                              type="button"
                              className="text-emerald-300 underline decoration-emerald-500/70 decoration-dashed underline-offset-4"
                              onClick={() => setCommand(`use ${item}`)}
                            >
                              usar
                            </button>
                            <button
                              type="button"
                              className="text-amber-300 underline decoration-amber-500/70 decoration-dashed underline-offset-4"
                              onClick={() => setCommand(`sell ${item}`)}
                            >
                              vender
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-slate-400">Vazio. Pegue algo com &quot;take &lt;item&gt;&quot;.</p>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Inventário cheio? Venda com <span className="text-amber-200">sell &lt;item&gt;</span> ou largue com{" "}
                  <span className="text-emerald-200">drop &lt;item&gt;</span>.
                </p>
              </div>

              <div className="rounded-3xl border border-amber-500/25 bg-slate-900/80 p-5 shadow-lg shadow-amber-900/30 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-amber-200">Placar global</p>
                    <h3 className="text-lg font-semibold text-amber-100">Top competidores</h3>
                  </div>
                  <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-100">tempo real</span>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  {scoreboard.length === 0 && <li className="text-slate-400">Sem jogadores ainda.</li>}
                  {scoreboard.map((entry, index) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">#{index + 1}</span>
                        <span className="font-medium">{entry.name}</span>
                      </div>
                      <span className="text-amber-200">{entry.score} pts</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-slate-700/50 bg-slate-950/70 p-5 shadow-lg shadow-black/30 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Dicas rápidas</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-200">
                  <li>• Monstros são únicos por sala. Vença primeiro para ganhar pontos e essências.</li>
                  <li>• O comando <span className="text-emerald-300">look</span> revela saídas e jogadores próximos.</li>
                  <li>• Se cair em combate, digite <span className="text-emerald-300">respawn</span>.</li>
                  <li>• Venda loot com <span className="text-amber-300">sell &lt;item&gt;</span> (preço aparece no item).</li>
                </ul>
              </div>
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
