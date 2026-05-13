// 타뷸라의 늑대 (Korean Werewolf / Mafia) — role + phase rules.

export const ROLE = {
  VILLAGER: "villager",
  WOLF: "wolf",
  DOCTOR: "doctor",
  SEER: "seer",
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_NAMES_KR: Record<Role, string> = {
  villager: "시민",
  wolf: "늑대",
  doctor: "의사",
  seer: "예언자",
};

// Phase length in milliseconds. Server-driven.
export const PHASE_MS = {
  night: 45_000,
  nightReveal: 6_000,
  day: 90_000,
  vote: 30_000,
  voteReveal: 6_000,
  roleReveal: 6_000,
} as const;

// Distribution table — counts: [wolves, doctors, seers, villagers]
const DIST: Record<number, [number, number, number, number]> = {
  4: [1, 1, 1, 1],
  5: [1, 1, 1, 2],
  6: [2, 1, 1, 2],
  7: [2, 1, 1, 3],
  8: [2, 1, 1, 4],
  9: [3, 1, 1, 4],
  10: [3, 1, 1, 5],
};

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;

export const rolesFor = (n: number): Role[] => {
  const dist = DIST[Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n))];
  const [w, d, s, v] = dist;
  const list: Role[] = [];
  for (let i = 0; i < w; i++) list.push(ROLE.WOLF);
  for (let i = 0; i < d; i++) list.push(ROLE.DOCTOR);
  for (let i = 0; i < s; i++) list.push(ROLE.SEER);
  for (let i = 0; i < v; i++) list.push(ROLE.VILLAGER);
  return list;
};

export const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Win check — given remaining alive players grouped by role.
export type WinCheckInput = { aliveWolves: number; aliveOthers: number };
export const checkWinner = ({
  aliveWolves,
  aliveOthers,
}: WinCheckInput): "wolves" | "villagers" | null => {
  if (aliveWolves === 0) return "villagers";
  if (aliveWolves >= aliveOthers) return "wolves";
  return null;
};
