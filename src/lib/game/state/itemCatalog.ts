import { ITEMS } from "../data";
import { Item } from "../types";

const itemMap = new Map<string, Item>(ITEMS.map((i) => [i.id, i]));

export function getItem(itemId: string): Item | undefined {
  return itemMap.get(itemId);
}

export function listItems(): Item[] {
  return ITEMS;
}
