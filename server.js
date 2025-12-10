/* eslint-disable @typescript-eslint/no-require-imports */
/* Custom Next.js server with WebSocket lobby for Orbe Arena */
const { createServer } = require("http");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");
const crypto = require("crypto");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const WORLD_SIZE = 2400;
const MAX_PLAYERS = 8;
const BASE_RADIUS = 28;
const COLORS = [
  "#ff6b6b",
  "#feca57",
  "#1dd1a1",
  "#54a0ff",
  "#5f27cd",
  "#ff9ff3",
  "#48dbfb",
  "#c8d6e5",
  "#ffb142",
  "#2ecc71",
];

const NAMES = [
  "Orbe",
  "Plasma",
  "Cometa",
  "Nebula",
  "Vento",
  "Quasar",
  "Vórtice",
  "Pulsar",
];

const state = {
  clients: new Map(),
  lobbySeed: Math.floor(Math.random() * 10000),
};

function pickColor(index) {
  return COLORS[index % COLORS.length];
}

function pickName(index) {
  return `${NAMES[index % NAMES.length]} ${index + 1}`;
}

function createPlayer(id, index) {
  const margin = 200;
  const x = margin + Math.random() * (WORLD_SIZE - margin * 2);
  const y = margin + Math.random() * (WORLD_SIZE - margin * 2);
  return {
    id,
    name: pickName(index),
    color: pickColor(index),
    x,
    y,
    radius: BASE_RADIUS,
    lastSeen: Date.now(),
  };
}

function respawnPlayer(player) {
  const margin = 160;
  player.x = margin + Math.random() * (WORLD_SIZE - margin * 2);
  player.y = margin + Math.random() * (WORLD_SIZE - margin * 2);
  player.radius = BASE_RADIUS;
  player.lastSeen = Date.now();
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const { socket } of state.clients.values()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}

function broadcastPlayers() {
  const snapshot = Array.from(state.clients.values()).map(({ player }) => player);
  broadcast({ type: "state", players: snapshot });
}

function resolveCollisions(hunterId) {
  const hunter = state.clients.get(hunterId)?.player;
  if (!hunter) return;
  for (const [otherId, entry] of state.clients) {
    if (otherId === hunterId) continue;
    const prey = entry.player;
    if (prey.radius >= hunter.radius - 4) continue;
    const dx = prey.x - hunter.x;
    const dy = prey.y - hunter.y;
    const distance = Math.hypot(dx, dy);
    if (distance < Math.max(6, hunter.radius - prey.radius * 0.3)) {
      const hunterArea = Math.PI * hunter.radius * hunter.radius;
      const preyArea = Math.PI * prey.radius * prey.radius * 0.65;
      const newRadius = Math.sqrt((hunterArea + preyArea) / Math.PI);
      hunter.radius = Math.min(360, newRadius);
      respawnPlayer(prey);
    }
  }
}

function handleChat(fromId, text) {
  const trimmed = String(text || "").trim().slice(0, 200);
  if (!trimmed) return;
  const player = state.clients.get(fromId)?.player;
  if (!player) return;
  broadcast({
    type: "chat",
    from: player.name,
    color: player.color,
    text: trimmed,
    at: Date.now(),
  });
}

function handleUpdate(fromId, payload) {
  const entry = state.clients.get(fromId);
  if (!entry) return;
  const { x, y, radius } = payload || {};
  if (typeof x !== "number" || typeof y !== "number") return;
  entry.player.x = Math.max(0, Math.min(WORLD_SIZE, x));
  entry.player.y = Math.max(0, Math.min(WORLD_SIZE, y));
  if (typeof radius === "number" && radius > 5 && radius < 400) {
    entry.player.radius = radius;
  }
  entry.player.lastSeen = Date.now();
  resolveCollisions(fromId);
  broadcastPlayers();
}

function handleMessage(id, raw) {
  const data = typeof raw === "string" ? raw : raw.toString("utf8");
  try {
    const parsed = JSON.parse(data);
    if (parsed.type === "chat") {
      handleChat(id, parsed.text ?? "");
    } else if (parsed.type === "update") {
      handleUpdate(id, parsed);
    }
  } catch {
    // ignore malformed
  }
}

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  if (state.clients.size >= MAX_PLAYERS) {
    socket.send(
      JSON.stringify({
        type: "full",
        message: "Sala cheia. Tente novamente mais tarde.",
      })
    );
    socket.close(1013, "Sala cheia");
    return;
  }

  const playerId = crypto.randomUUID();
  const playerIndex = state.clients.size;
  const player = createPlayer(playerId, playerIndex);

  state.clients.set(playerId, { socket, player });

  socket.on("message", (event) => handleMessage(playerId, event));
  socket.on("close", () => {
    state.clients.delete(playerId);
    broadcastPlayers();
  });
  socket.on("error", () => {
    state.clients.delete(playerId);
    broadcastPlayers();
  });

  socket.send(
    JSON.stringify({
      type: "init",
      id: playerId,
      player,
      worldSize: WORLD_SIZE,
      players: Array.from(state.clients.values()).map(({ player }) => player),
      maxPlayers: MAX_PLAYERS,
    })
  );

  broadcastPlayers();
});

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => handle(req, res));

    server.on("upgrade", (req, socket, head) => {
      if (req.url && req.url.startsWith("/api/ws")) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    server.listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`);
    });
  })
  .catch((err) => {
    console.error("Server start failed", err);
    process.exit(1);
  });
