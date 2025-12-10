import { Race } from "../types";

export const RACES: Race[] = [
  {
    id: "humano",
    nome: "Humano",
    descricao: "Versatil e adaptavel, sem bonus extremos.",
    perks: ["Ganha 1 ponto extra de subatributo aleatorio"],
  },
  {
    id: "errante",
    nome: "Errante",
    descricao: "Viajante de realidades, acostumado a anomalias.",
    perks: ["Menor penalidade ao usar essencia fora da afinidade"],
  },
  {
    id: "remanescente",
    nome: "Remanescente",
    descricao: "Sangue tocado pelo abismo, resistencia alta a corrupcao leve.",
    perks: ["Resiste efeitos de salas de desafio por 1 turno extra"],
  },
];
