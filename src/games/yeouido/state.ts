import "../../shared/polyfill.js";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import { Spectator } from "../../shared/colyseus/spectator.js";

/** A minion on the battlefield. Board order = slot order. */
export class Unit extends Schema {
  @type("string") uid: string = ""; // server-monotonic, never reused in a match
  @type("string") cardId: string = "";
  @type("number") atk: number = 0;
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("boolean") canAttack: boolean = false;
  @type("boolean") taunt: boolean = false;
  @type("boolean") rush: boolean = false;
  @type("boolean") silenced: boolean = false;
  @type("boolean") justPlayed: boolean = false;
}

export class YeouidoPlayer extends Schema {
  @type("string") sessionId: string = "";
  @type("number") userId: number = 0;
  @type("string") nickname: string = "";
  @type("boolean") connected: boolean = true;
  @type("boolean") ready: boolean = false;

  @type("string") faction: string = ""; // "" | "ruling" | "opposition"
  @type("number") hp: number = 30; // 지지율
  @type("number") maxHp: number = 30;
  @type("number") mana: number = 0; // 정치자금
  @type("number") manaMax: number = 0;
  @type("number") deckCount: number = 0;
  @type("number") handCount: number = 0;
  @type("number") fatigue: number = 0; // next empty draw deals fatigue+1
  @type("boolean") heroPowerUsed: boolean = false;
  @type([Unit]) board = new ArraySchema<Unit>(); // max 5
}

export class LogEntry extends Schema {
  @type("number") ts: number = 0;
  @type("string") kind: string = "info"; // system|turn|play|combat|result|info
  @type("string") text: string = "";
  @type("string") actor: string = "";
  @type("string") target: string = "";
  @type("string") card: string = ""; // cardId
}

export class YeouidoState extends Schema {
  @type("string") hostSessionId: string = "";
  @type("string") roomName: string = "";
  @type("string") phase: string = "lobby"; // lobby | playing | gameEnd
  @type("string") turnSid: string = "";
  @type("number") turnEndsAt: number = 0; // absolute ms
  @type("number") turnNumber: number = 0;
  @type("string") winnerSid: string = "";

  @type({ map: YeouidoPlayer }) players = new MapSchema<YeouidoPlayer>();
  @type([LogEntry]) log = new ArraySchema<LogEntry>();
  @type({ map: Spectator }) spectators = new MapSchema<Spectator>();
}
