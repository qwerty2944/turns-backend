import "../../shared/polyfill.js";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import { Spectator } from "../../shared/colyseus/spectator.js";

export class TapTarget extends Schema {
  @type("number") id: number = 0;
  @type("number") cell: number = 0;        // 0..15 in 4x4 grid
  @type("number") spawnedAt: number = 0;   // server ms
  @type("number") expiresAt: number = 0;   // server ms
}

export class DodgeBlock extends Schema {
  @type("number") id: number = 0;
  @type("number") col: number = 0;         // 0,1,2
  @type("number") y: number = 0;           // 0 (top) .. 1 (bottom)
  @type("number") speed: number = 0;       // y units per ms
  @type("number") spawnedAt: number = 0;
}

export class MultitaskPlayer extends Schema {
  @type("string") sessionId: string = "";
  @type("number") userId: number = 0;
  @type("string") nickname: string = "";
  @type("boolean") connected: boolean = true;
  @type("boolean") ready: boolean = false;
  @type("boolean") alive: boolean = true;

  @type("number") hearts: number = 3;
  @type("number") score: number = 0;
  @type("number") tapMisses: number = 0;     // consecutive misses on tap task
  @type("number") lastDamageAt: number = 0;  // hit cooldown
  @type("number") deathAt: number = 0;       // server ms when died (0 if alive)

  // Hold-bar task — indicator runs left→right, must tap inside target zone
  @type("number") holdPos: number = 0;       // 0..1 indicator position
  @type("number") holdZoneStart: number = 0; // 0..1
  @type("number") holdZoneEnd: number = 0;   // 0..1
  @type("number") holdCycleId: number = 0;   // current cycle id (so client can detect re-spawn)

  // Tap-target task — up to ~4 simultaneous targets
  @type([TapTarget]) tapTargets = new ArraySchema<TapTarget>();

  // Dodge task — character + falling blocks in 3 columns
  @type("number") dodgeCol: number = 1;
  @type([DodgeBlock]) dodgeBlocks = new ArraySchema<DodgeBlock>();
}

export class LogEntry extends Schema {
  @type("number") ts: number = 0;
  @type("string") kind: string = "info"; // info | system | hit | death | win
  @type("string") text: string = "";
  @type("string") actor: string = "";
}

export class MultitaskState extends Schema {
  @type("string") hostSessionId: string = "";
  @type("string") roomName: string = "";
  // lobby | playing | gameEnd
  @type("string") phase: string = "lobby";
  @type("number") maxPlayers: number = 8;

  @type("number") startedAt: number = 0;
  @type("number") endsAt: number = 0;       // 3-min hard timeout
  @type("number") difficulty: number = 1;   // increases over time
  @type("number") serverNow: number = 0;    // periodically synced for client clock alignment

  @type("string") winnerSessionId: string = "";
  @type("string") winnerNickname: string = "";

  @type({ map: MultitaskPlayer }) players = new MapSchema<MultitaskPlayer>();
  @type([LogEntry]) log = new ArraySchema<LogEntry>();

  @type({ map: Spectator }) spectators = new MapSchema<Spectator>();
}
