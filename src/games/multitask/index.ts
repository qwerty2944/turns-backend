import type { GameManifest } from "../types.js";
import { MultitaskRoom } from "./room.js";
import { MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";

export const multitaskManifest: GameManifest = {
  id: "multitask",
  roomName: "multitask",
  displayName: "멀티태스크",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  RoomClass: MultitaskRoom,
  filterBy: ["roomName"],
};
