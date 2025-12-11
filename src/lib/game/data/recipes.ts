import { Recipe } from "../types";

export const RECIPES: Recipe[] = [
  {
    id: "flecha_reforcada",
    nome: "Flechas Reforcadas",
    descricao: "Combina osso e fio condutivo para flechas mais robustas.",
    inputs: [
      { itemId: "placa_ossea", qtd: 1 },
      { itemId: "fio_condutivo", qtd: 1 },
    ],
    outputs: [{ itemId: "flecha_bruta", qtd: 6 }],
  },
  {
    id: "faca_fina",
    nome: "Facas Finas",
    descricao: "Apara ossos com fragmento de miragem para facas lancaveis melhores.",
    inputs: [
      { itemId: "placa_ossea", qtd: 1 },
      { itemId: "fragmento_miragem", qtd: 1 },
    ],
    outputs: [{ itemId: "faca_lancavel", qtd: 3 }],
  },
  {
    id: "tonico_preciso",
    nome: "Tonico Preciso",
    descricao: "Refina um frasco de cura com fragmento de miragem para foco extra.",
    inputs: [
      { itemId: "frasco_cura", qtd: 1 },
      { itemId: "fragmento_miragem", qtd: 1 },
    ],
    outputs: [{ itemId: "tonico_foco", qtd: 1 }],
  },
];
