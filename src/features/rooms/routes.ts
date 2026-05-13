import { Router, Request, Response } from "express";
import { matchMaker } from "colyseus";
import { GAME_REGISTRY } from "../../games/registry.js";

const router = Router();

router.get("/health", (_req: Request, res: Response) =>
  res.json({ ok: true }),
);

router.get("/games", (_req: Request, res: Response) => {
  res.json(
    GAME_REGISTRY.map((g) => ({
      id: g.id,
      roomName: g.roomName,
      displayName: g.displayName,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
    })),
  );
});

router.get("/rooms", async (req: Request, res: Response) => {
  const gameId =
    typeof req.query.game === "string" ? req.query.game : undefined;
  const games = gameId
    ? GAME_REGISTRY.filter((g) => g.id === gameId)
    : GAME_REGISTRY;

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
  res.json(results);
});

export default router;
