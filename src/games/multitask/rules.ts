export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const STARTING_HEARTS = 3;

/** Whole match length cap — winner-by-score if nobody dies first. */
export const MATCH_MS = 3 * 60 * 1000;

/** Sim tick interval (ms). 50 = 20Hz. */
export const TICK_MS = 50;

/** State broadcast/snapshot cadence — Colyseus 0.17 patches at room.patchRate; we just rely on schema. */
export const SERVER_NOW_SYNC_MS = 1000;

/** Damage cooldown so a single brush doesn't burn multiple hearts. */
export const DAMAGE_COOLDOWN_MS = 1000;

/** Hold-bar task. */
export const HOLD_BASE_CYCLE_MS = 4000;     // sweep duration left→right at difficulty 1
export const HOLD_MIN_CYCLE_MS = 1800;      // floor as difficulty climbs
export const HOLD_BASE_ZONE = 0.30;         // zone width as fraction of bar at diff 1
export const HOLD_MIN_ZONE = 0.12;          // floor

/** Tap-target task. */
export const TAP_BASE_LIFETIME_MS = 1500;
export const TAP_MIN_LIFETIME_MS = 700;
export const TAP_BASE_INTERVAL_MS = 1400;
export const TAP_MIN_INTERVAL_MS = 650;
export const TAP_MAX_ACTIVE = 4;
export const TAP_MISS_THRESHOLD = 3;        // consecutive misses → -1 heart

/** Dodge task. */
export const DODGE_BASE_INTERVAL_MS = 1100;
export const DODGE_MIN_INTERVAL_MS = 500;
export const DODGE_BASE_FALL_MS = 1800;     // top → bottom traversal time
export const DODGE_MIN_FALL_MS = 900;
export const DODGE_CHAR_Y = 0.85;           // character y-position on the lane (0=top, 1=bottom)
export const DODGE_HIT_Y_BAND: [number, number] = [0.78, 0.92];

/** Difficulty: rises by 1 every 20s. Clamped to 6. */
export const DIFFICULTY_STEP_MS = 20_000;
export const MAX_DIFFICULTY = 6;

export const difficultyFor = (elapsedMs: number) =>
  Math.min(MAX_DIFFICULTY, 1 + Math.floor(elapsedMs / DIFFICULTY_STEP_MS));

/** Linear interp helper that clamps t to [0,1] given a difficulty 1..MAX. */
const curve = (diff: number, base: number, floor: number) => {
  const t = Math.min(1, Math.max(0, (diff - 1) / (MAX_DIFFICULTY - 1)));
  return base + (floor - base) * t;
};

export const holdCycleMs = (diff: number) => curve(diff, HOLD_BASE_CYCLE_MS, HOLD_MIN_CYCLE_MS);
export const holdZoneWidth = (diff: number) => curve(diff, HOLD_BASE_ZONE, HOLD_MIN_ZONE);

export const tapLifetime = (diff: number) => curve(diff, TAP_BASE_LIFETIME_MS, TAP_MIN_LIFETIME_MS);
export const tapInterval = (diff: number) => curve(diff, TAP_BASE_INTERVAL_MS, TAP_MIN_INTERVAL_MS);

export const dodgeInterval = (diff: number) =>
  curve(diff, DODGE_BASE_INTERVAL_MS, DODGE_MIN_INTERVAL_MS);
export const dodgeFallMs = (diff: number) => curve(diff, DODGE_BASE_FALL_MS, DODGE_MIN_FALL_MS);

/** Choose a target-zone window for a hold-bar cycle. Returns [start,end] in 0..1. */
export const pickHoldZone = (diff: number): [number, number] => {
  const w = holdZoneWidth(diff);
  // Avoid placing the zone too close to the edges so it stays readable.
  const minStart = 0.15;
  const maxStart = 0.85 - w;
  const start = minStart + Math.random() * Math.max(0, maxStart - minStart);
  return [start, start + w];
};

/** Choose a tap-target grid cell that's not currently occupied. Returns -1 if full. */
export const pickTapCell = (occupied: Set<number>): number => {
  if (occupied.size >= 16) return -1;
  const free: number[] = [];
  for (let i = 0; i < 16; i++) if (!occupied.has(i)) free.push(i);
  return free[Math.floor(Math.random() * free.length)];
};

export const pickDodgeCol = (lastCol: number): number => {
  // Slight bias toward NOT spawning in the same column twice in a row so the
  // game stays readable.
  const candidates = [0, 1, 2].filter((c) => c !== lastCol);
  if (Math.random() < 0.65) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return Math.floor(Math.random() * 3);
};
