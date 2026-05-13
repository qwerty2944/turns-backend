import "../../shared/polyfill.js";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import { Spectator } from "../../shared/colyseus/spectator.js";

export const BOARD_W = 10;
export const BOARD_H = 20;
export const BOARD_CELLS = BOARD_W * BOARD_H;

export class FallingPiece extends Schema {
  @type("number") type: number = 0; // 0=none, 1..7 = I,O,T,S,Z,J,L
  @type("number") rot: number = 0;  // 0..3
  @type("number") x: number = 0;    // top-left of 4x4 bounding box
  @type("number") y: number = 0;
}

export class PlayerBoard extends Schema {
  @type("string") sessionId: string = "";
  @type("number") userId: number = 0;
  @type("string") nickname: string = "";
  @type("boolean") connected: boolean = true;
  @type("boolean") ready: boolean = false;
  @type("boolean") alive: boolean = true;
  @type("number") tokens: number = 0;

  // 10x20 grid, row-major. 0 = empty, 1..7 = mino color id, 8 = garbage.
  @type(["number"]) cells = new ArraySchema<number>();

  @type(FallingPiece) cur = new FallingPiece();
  @type("number") hold: number = 0;        // 0 = none
  @type("boolean") holdUsed: boolean = false;
  @type(["number"]) nextQueue = new ArraySchema<number>();

  @type("number") level: number = 1;
  @type("number") lines: number = 0;
  @type("number") score: number = 0;
  @type("number") incomingGarbage: number = 0;
  @type("number") lastClearTs: number = 0;
}

export class LogEntry extends Schema {
  @type("number") ts: number = 0;
  @type("string") kind: string = "info";
  @type("string") text: string = "";
  @type("string") actor: string = "";
  @type("string") target: string = "";
}

export class TetrisState extends Schema {
  @type("string") hostSessionId: string = "";
  @type("string") roomName: string = "";
  // lobby | playing | roundEnd | gameEnd
  @type("string") phase: string = "lobby";
  @type("number") maxPlayers: number = 6;
  @type("number") tokensToWin: number = 3;

  @type({ map: PlayerBoard }) players = new MapSchema<PlayerBoard>();
  @type(["string"]) seatOrder = new ArraySchema<string>();

  @type("string") roundWinnerId: string = "";
  @type("string") lastWinnerId: string = "";
  @type("string") gameWinnerId: string = "";

  @type([LogEntry]) log = new ArraySchema<LogEntry>();

  @type({ map: Spectator }) spectators = new MapSchema<Spectator>();
}
