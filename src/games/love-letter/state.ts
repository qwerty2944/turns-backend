import "../../shared/polyfill.js";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import { Spectator } from "../../shared/colyseus/spectator.js";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("number") userId: number = 0;
  @type("string") nickname: string = "";
  @type("boolean") connected: boolean = true;
  @type("boolean") ready: boolean = false;

  @type(["number"]) hand = new ArraySchema<number>();
  @type(["number"]) discard = new ArraySchema<number>();
  @type("boolean") protected: boolean = false;
  @type("boolean") eliminated: boolean = false;
  @type("number") tokens: number = 0;
}

export class LogEntry extends Schema {
  @type("number") ts: number = 0;
  @type("string") kind: string = "info";
  @type("string") text: string = "";
  @type("string") actor: string = "";
  @type("string") target: string = "";
  @type("number") card: number = 0;
  @type("number") guess: number = 0;
}

export class LoveLetterState extends Schema {
  @type("string") hostSessionId: string = "";
  @type("string") roomName: string = "";
  @type("string") phase: string = "lobby"; // lobby | playing | roundEnd | gameEnd
  @type("number") maxPlayers: number = 4;
  @type("number") tokensToWin: number = 4;

  @type({ map: Player }) players = new MapSchema<Player>();
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type("number") turnIndex: number = 0;
  @type("number") deckRemaining: number = 0;
  @type(["number"]) publicDiscard = new ArraySchema<number>();
  @type("string") lastWinnerId: string = "";
  @type("string") roundWinnerId: string = "";
  @type("string") gameWinnerId: string = "";

  @type([LogEntry]) log = new ArraySchema<LogEntry>();

  @type("string") pendingAction: string = "";

  @type({ map: Spectator }) spectators = new MapSchema<Spectator>();
}
