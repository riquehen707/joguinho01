import { Biome } from "../types";

export const BIOMES: Biome[] = [
  {
    id: "cripta",
    nome: "Cripta Sombria",
    tom: "gothic horror com nevoa fria e ecos de sinos",
    tier: 1,
    efeitos: ["Dano sombrio leve", "Visibilidade reduzida"],
  },
  {
    id: "pantano",
    nome: "Pantano Profano",
    tom: "podridao, gases venenosos e fungos luminosos",
    tier: 1,
    efeitos: ["Enfraquece regeneracao de estamina", "Chance de veneno ambiental"],
  },
  {
    id: "biblioteca",
    nome: "Biblioteca Profana",
    tom: "livros sussurrantes, runas flutuantes, luz morta",
    tier: 2,
    efeitos: ["Aumenta custo de foco", "Salas secretas mais frequentes"],
  },
  {
    id: "fissura_abissal",
    nome: "Fissura Abissal",
    tom: "fendas para o vazio, gravidade estranha, ecos cosmicos",
    tier: 2,
    efeitos: ["Corrupcao lenta ao permanecer na sala", "Gera hordas pequenas de larvas"],
  },
  {
    id: "deserto_espectral",
    nome: "Deserto Espectral",
    tom: "tempestades de areia espectral e miragens vivas",
    tier: 3,
    efeitos: ["Drena estamina ao se mover", "Percepcao reduzida sem protecao"],
  },
  {
    id: "forja_tecnomantica",
    nome: "Forja Tecnomantica",
    tom: "mecanismos vivos, faixas de plasma e tecno-runas",
    tier: 3,
    efeitos: ["Arcos de choque eletrico", "Alta chance de salas de desafio"],
  },
];
