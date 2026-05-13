import type { GameManifest } from "./types.js";
import { loveLetterManifest } from "./love-letter/index.js";
import { mafiaManifest } from "./mafia/index.js";
import { multitaskManifest } from "./multitask/index.js";
import { tetrisManifest } from "./tetris/index.js";

// Register new games here. Each manifest is self-contained.
export const GAME_REGISTRY: GameManifest[] = [
  loveLetterManifest,
  mafiaManifest,
  multitaskManifest,
  tetrisManifest,
];

export const getGame = (id: string) =>
  GAME_REGISTRY.find((g) => g.id === id || g.roomName === id);
