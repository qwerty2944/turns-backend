import type { GameManifest } from "../types.js";
import { LoveLetterRoom } from "./room.js";

export const loveLetterManifest: GameManifest = {
  id: "love_letter",
  roomName: "love_letter",
  displayName: "러브레터",
  minPlayers: 2,
  maxPlayers: 4,
  RoomClass: LoveLetterRoom,
  filterBy: ["roomName"],
};
