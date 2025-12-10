import { Lineage } from "../types";

export const LINEAGES: Lineage[] = [
  {
    id: "magica",
    nome: "Linhagem Magica",
    descricao: "Afinidade natural com fluxo arcano e alteracao de forma.",
    afinidades: ["mente", "foco", "sangue"],
    bonus: { mente: 2, foco: 1 },
    efeitos: [
      "Reduz custo de canalizacao em 10%",
      "Ganha resistencia leve a corrupcao de essencias arcana",
    ],
  },
  {
    id: "cosmica",
    nome: "Linhagem Cosmica",
    descricao: "Reage a horrores estelares e fenomenos de vazio.",
    afinidades: ["sorte", "mente", "sangue"],
    bonus: { sorte: 2, mente: 1 },
    efeitos: [
      "Ao entrar em sala de desafio, ganha escudo de foco temporario",
      "Pequena chance de negar corrupcao de essencias desconhecidas",
    ],
  },
  {
    id: "tecnologica",
    nome: "Linhagem Tecnologica",
    descricao: "Conserta, modula e subverte engenhos e construtos.",
    afinidades: ["foco", "agilidade", "forca"],
    bonus: { foco: 1, agilidade: 1, forca: 1 },
    efeitos: [
      "Custo de crafting reduzido em 20%",
      "Pode fabricar drones improvisados em santuarios",
    ],
  },
  {
    id: "sobrenatural",
    nome: "Linhagem Sobrenatural",
    descricao: "Sangue marcado por pactos, maldicoes e metamorfoses.",
    afinidades: ["sangue", "vigor", "sorte"],
    bonus: { sangue: 2, vigor: 1 },
    efeitos: [
      "Resiste melhor a feridas sangrentas",
      "Chance de despertar mutacao ao absorver essencia rara",
    ],
  },
];
