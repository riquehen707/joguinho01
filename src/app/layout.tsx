import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roguelike MUD Persistente",
  description: "Dungeon persistente, multiplayer e multi-linhagem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
