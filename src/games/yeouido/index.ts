import type { GameManifest } from "../types.js";
import { YeouidoRoom } from "./room.js";

export const yeouidoManifest: GameManifest = {
  id: "yeouido",
  roomName: "yeouido",
  displayName: "여의도 대전",
  minPlayers: 2,
  maxPlayers: 2,
  RoomClass: YeouidoRoom,
  filterBy: ["roomName"],
};
