// Symbol.metadata polyfill must run before any @colyseus/schema class loads.
import "./shared/polyfill.js";

import { defineServer, defineRoom, monitor } from "colyseus";
import cors from "cors";
import express from "express";

import authRoutes from "./features/auth/routes.js";
import roomRoutes from "./features/rooms/routes.js";
import { initSchema } from "./shared/db/index.js";
import { GAME_REGISTRY } from "./games/registry.js";

// Build the rooms map at module-load time from the game registry.
// Each game slice exposes a manifest with `roomName` and `RoomClass`.
const rooms = Object.fromEntries(
  GAME_REGISTRY.map((g) => [g.roomName, defineRoom(g.RoomClass)]),
);

export default defineServer({
  rooms,
  beforeListen: async () => {
    await initSchema();
    for (const g of GAME_REGISTRY) {
      console.log(`[turns] registered game room: ${g.roomName}`);
    }
  },
  express: (app) => {
    app.use(cors());
    app.use(express.json());
    app.use("/auth", authRoutes);
    app.use(roomRoutes); // /health, /games, /rooms
    app.use("/monitor", monitor());
  },
});
