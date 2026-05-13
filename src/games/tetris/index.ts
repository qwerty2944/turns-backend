import type { GameManifest } from "../types.js";
import { TetrisRoom } from "./room.js";

export const tetrisManifest: GameManifest = {
  id: "tetris",
  roomName: "tetris",
  displayName: "테트리스",
  minPlayers: 1,
  maxPlayers: 6,
  RoomClass: TetrisRoom,
  filterBy: ["roomName"],
};
