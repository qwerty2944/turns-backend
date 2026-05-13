import type { GameManifest } from "../types.js";
import { MafiaRoom } from "./room.js";
import { MAX_PLAYERS, MIN_PLAYERS } from "./rules.js";

export const mafiaManifest: GameManifest = {
  id: "mafia",
  roomName: "mafia",
  displayName: "타뷸라의 늑대",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  RoomClass: MafiaRoom,
  filterBy: ["roomName"],
};
