import type { Room } from "colyseus";

export type GameManifest = {
  id: string;
  roomName: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  RoomClass: new (...args: any[]) => Room;
  filterBy?: string[];
};
