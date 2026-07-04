export const TURN_MS = 75_000;
export const HAND_MAX = 8;
export const BOARD_MAX = 5;
export const START_HP = 30;
export const MANA_CAP = 10;
export const HERO_POWER_COST = 2;
export const DECK_SIZE = 20;
export const FIRST_HAND = 3; // first player; second gets FIRST_HAND + 1

export type Faction = "ruling" | "opposition";
export const FACTIONS: Faction[] = ["ruling", "opposition"];

export const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
