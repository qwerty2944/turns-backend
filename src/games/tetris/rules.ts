// Tetris rules — SRS pieces, kicks, gravity, scoring, garbage.
// All values mirror the canonical "Guideline Tetris" with a few tweaks
// (no T-spin detection in v1, lock delay 500ms, garbage table 0/1/2/4).

import { BOARD_W, BOARD_H } from "./state.js";

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;

export const PIECE = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
} as const;

export const GARBAGE_CELL = 8;

// Each piece: 4 rotations, each rotation is a list of [dx, dy] occupied cells
// inside a 4x4 bounding box anchored at piece (x, y) top-left.
export const PIECE_SHAPES: Record<number, Array<Array<[number, number]>>> = {
  1: [
    // I
    [[0,1],[1,1],[2,1],[3,1]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[1,0],[1,1],[1,2],[1,3]],
  ],
  2: [
    // O
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
  ],
  3: [
    // T
    [[1,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[2,1],[1,2]],
    [[1,0],[0,1],[1,1],[1,2]],
  ],
  4: [
    // S
    [[1,0],[2,0],[0,1],[1,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[1,1],[2,1],[0,2],[1,2]],
    [[0,0],[0,1],[1,1],[1,2]],
  ],
  5: [
    // Z
    [[0,0],[1,0],[1,1],[2,1]],
    [[2,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,2]],
    [[1,0],[0,1],[1,1],[0,2]],
  ],
  6: [
    // J
    [[0,0],[0,1],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[0,2],[1,2]],
  ],
  7: [
    // L
    [[2,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,1],[0,2]],
    [[0,0],[1,0],[1,1],[1,2]],
  ],
};

// SRS wall kicks. For each piece (non-I, I, O), and each rotation transition.
// Key = "from->to". Values are [dx, dy] offsets to try in order.
// Reference: https://tetris.fandom.com/wiki/SRS
type KickTable = Record<string, Array<[number, number]>>;

export const KICKS_JLSTZ: KickTable = {
  "0->1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "1->0": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "1->2": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "2->1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "2->3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "3->2": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "3->0": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "0->3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
};

export const KICKS_I: KickTable = {
  "0->1": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  "1->0": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  "1->2": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  "2->1": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  "2->3": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  "3->2": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  "3->0": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  "0->3": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
};

export const KICKS_O: KickTable = {
  "0->1": [[0,0]],
  "1->0": [[0,0]],
  "1->2": [[0,0]],
  "2->1": [[0,0]],
  "2->3": [[0,0]],
  "3->2": [[0,0]],
  "3->0": [[0,0]],
  "0->3": [[0,0]],
};

export const kicksFor = (pieceType: number): KickTable => {
  if (pieceType === PIECE.I) return KICKS_I;
  if (pieceType === PIECE.O) return KICKS_O;
  return KICKS_JLSTZ;
};

export const shuffle7Bag = (): number[] => {
  const a = [1, 2, 3, 4, 5, 6, 7];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Standard guideline gravity (ms per row drop). Capped at level 15.
const GRAVITY_TABLE = [
  1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 18, 11, 7, 4,
];
export const gravityMsForLevel = (level: number): number => {
  const idx = Math.max(0, Math.min(GRAVITY_TABLE.length - 1, level - 1));
  return GRAVITY_TABLE[idx];
};

// How many garbage lines to send when N lines are cleared.
export const linesToGarbage = (n: number): number => {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  if (n === 3) return 2;
  return 4; // tetris
};

export const LOCK_DELAY_MS = 500;
export const LOCK_MAX_RESETS = 15;
export const SPAWN_X = 3;
export const SPAWN_Y = 0;

// Score table — basic guideline minus T-spins.
export const SCORE_TABLE = [0, 100, 300, 500, 800];
export const scoreForClear = (lines: number, level: number): number => {
  const base = SCORE_TABLE[Math.max(0, Math.min(4, lines))] ?? 0;
  return base * level;
};

// Cell helpers
export const idx = (x: number, y: number) => y * BOARD_W + x;
export const inBounds = (x: number, y: number) =>
  x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;

export const occupiedCells = (
  type: number,
  rot: number,
  x: number,
  y: number,
): Array<[number, number]> => {
  const shape = PIECE_SHAPES[type]?.[rot & 3] ?? [];
  return shape.map(([dx, dy]) => [x + dx, y + dy]);
};

export const canPlace = (
  cells: number[] | { [i: number]: number; length: number },
  type: number,
  rot: number,
  x: number,
  y: number,
): boolean => {
  const occ = occupiedCells(type, rot, x, y);
  for (const [cx, cy] of occ) {
    if (cx < 0 || cx >= BOARD_W) return false;
    if (cy >= BOARD_H) return false;
    if (cy < 0) continue; // allow piece to spawn slightly above the visible area
    if (cells[idx(cx, cy)]) return false;
  }
  return true;
};
