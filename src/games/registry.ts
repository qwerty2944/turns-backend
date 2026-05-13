import type { GameManifest } from "./types.js";
import { loveLetterManifest } from "./love-letter/index.js";

// Register new games here. Each manifest is self-contained.
export const GAME_REGISTRY: GameManifest[] = [loveLetterManifest];

export const getGame = (id: string) =>
  GAME_REGISTRY.find((g) => g.id === id || g.roomName === id);
