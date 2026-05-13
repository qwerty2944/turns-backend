import { Schema, type } from "@colyseus/schema";
import type { Client } from "colyseus";

/** Spectator entry exposed in each game's schema. Lets the UI render a
 *  "관전자 N명" badge without leaking anything sensitive. */
export class Spectator extends Schema {
  @type("string") sessionId: string = "";
  @type("number") userId: number = 0;
  @type("string") nickname: string = "";
}

/** True when a client joined the room with `{ spectator: true }` in their
 *  join options. We stash that on `client.userData` in onJoin so it's cheap
 *  to check at the top of every message handler. */
export const isSpectator = (c: Client): boolean =>
  Boolean((c.userData as { spectator?: boolean } | undefined)?.spectator);
