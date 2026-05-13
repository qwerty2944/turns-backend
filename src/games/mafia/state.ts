import "../../shared/polyfill.js";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import { Spectator } from "../../shared/colyseus/spectator.js";

export class MafiaPlayer extends Schema {
  @type("string") sessionId: string = "";
  @type("number") userId: number = 0;
  @type("string") nickname: string = "";
  @type("boolean") connected: boolean = true;
  @type("boolean") ready: boolean = false;

  // role is only public after death (reveal) or game end
  @type("string") revealedRole: string = "";
  @type("boolean") alive: boolean = true;

  // vote target sessionId during vote phase (public so clients can show tallies)
  @type("string") voteTarget: string = "";
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

export class MafiaState extends Schema {
  @type("string") hostSessionId: string = "";
  @type("string") roomName: string = "";
  // lobby | night | nightReveal | day | vote | voteReveal | roleReveal | gameEnd
  @type("string") phase: string = "lobby";
  @type("number") maxPlayers: number = 8;
  @type("boolean") maskNicknames: boolean = false;
  @type("number") dayCount: number = 0;
  @type("number") phaseEndsAt: number = 0;

  @type({ map: MafiaPlayer }) players = new MapSchema<MafiaPlayer>();

  // Set during reveal phases
  @type("string") lastKilledId: string = "";
  @type("boolean") lastNightSaved: boolean = false;
  @type("string") lastLynchedId: string = "";
  @type("string") winners: string = ""; // "wolves" | "villagers" | ""

  @type([LogEntry]) log = new ArraySchema<LogEntry>();

  @type({ map: Spectator }) spectators = new MapSchema<Spectator>();
}
