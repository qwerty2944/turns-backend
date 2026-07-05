import { Controller, Get, Inject, Query } from "@nestjs/common";
import { matchMaker } from "colyseus";
import { GAME_REGISTRY_TOKEN } from "../games/games.module.js";
import type { GameManifest } from "../games/types.js";

@Controller()
export class RoomsController {
  constructor(
    @Inject(GAME_REGISTRY_TOKEN) private readonly registry: GameManifest[],
  ) {}

  @Get("health")
  health() {
    return { ok: true };
  }

  @Get("games")
  games() {
    return this.registry.map((g) => ({
      id: g.id,
      roomName: g.roomName,
      displayName: g.displayName,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
    }));
  }

  @Get("rooms")
  async rooms(@Query("game") gameId?: string) {
    const games = gameId
      ? this.registry.filter((g) => g.id === gameId)
      : this.registry;

    const results: Array<{
      roomId: string;
      name: string;
      game: string;
      clients: number;
      maxClients: number;
      locked: boolean;
      spectators: number;
    }> = [];
    for (const g of games) {
      const rooms = await matchMaker.query({ name: g.roomName });
      for (const r of rooms) {
        // matchMaker.query() returns rooms with an opaque shape; metadata can
        // carry a per-room spectator count if a room chose to publish one.
        const spectators =
          (r.metadata as { spectators?: number } | undefined)?.spectators ?? 0;
        results.push({
          roomId: r.roomId,
          name: r.metadata?.roomName || "Room",
          game: g.id,
          clients: r.clients,
          maxClients: r.maxClients,
          locked: r.locked,
          spectators,
        });
      }
    }
    return results;
  }
}
