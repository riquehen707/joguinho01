import Link from "next/link";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0c0c12" }}>
      <div style={{ maxWidth: 640, padding: "24px", background: "#12121a", border: "1px solid #242434", borderRadius: 12 }}>
        <h1 style={{ margin: 0, marginBottom: 12, fontSize: 28 }}>Roguelike MUD</h1>
        <p style={{ margin: 0, marginBottom: 16, color: "#cfd1d6" }}>
          Mundo unico, persistente e multiplayer. Explore biomas, absorva essencias e sobreviva a horrores cosmicos.
        </p>
        <Link
          href="/mud"
          style={{
            display: "inline-block",
            padding: "12px 18px",
            borderRadius: 10,
            background: "linear-gradient(120deg, #2f7af8, #7f4bff)",
            color: "#f7f9ff",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Entrar na dungeon
        </Link>
      </div>
    </main>
  );
}
