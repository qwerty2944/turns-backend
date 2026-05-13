export const CARD = {
  GUARD: 1,
  PRIEST: 2,
  BARON: 3,
  HANDMAID: 4,
  PRINCE: 5,
  KING: 6,
  COUNTESS: 7,
  PRINCESS: 8,
} as const;

export const CARD_NAMES_KR: Record<number, string> = {
  1: "병사",
  2: "사제",
  3: "남작",
  4: "하녀",
  5: "왕자",
  6: "왕",
  7: "백작부인",
  8: "공주",
};

export const DECK: number[] = [
  CARD.GUARD, CARD.GUARD, CARD.GUARD, CARD.GUARD, CARD.GUARD,
  CARD.PRIEST, CARD.PRIEST,
  CARD.BARON, CARD.BARON,
  CARD.HANDMAID, CARD.HANDMAID,
  CARD.PRINCE, CARD.PRINCE,
  CARD.KING,
  CARD.COUNTESS,
  CARD.PRINCESS,
];

export const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const cardNeedsTarget = (card: number): boolean =>
  card === CARD.GUARD ||
  card === CARD.PRIEST ||
  card === CARD.BARON ||
  card === CARD.KING ||
  card === CARD.PRINCE;
