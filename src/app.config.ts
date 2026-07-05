// Symbol.metadata polyfill must run before any @colyseus/schema class loads.
import "./common/polyfill.js";

import { defineServer, defineRoom, monitor } from "colyseus";
import cors from "cors";
import express from "express";

import { mountNest } from "./main.js";
import { GAME_REGISTRY } from "./games/registry.js";

// Build the rooms map at module-load time from the game registry.
// Each game slice exposes a manifest with `roomName` and `RoomClass`.
const rooms = Object.fromEntries(
  GAME_REGISTRY.map((g) => [g.roomName, defineRoom(g.RoomClass)]),
);

export default defineServer({
  rooms,
  beforeListen: async () => {
    for (const g of GAME_REGISTRY) {
      console.log(`[turns] registered game room: ${g.roomName}`);
    }
  },
  // Colyseus awaits this hook (Server.attach → await options.express(app)),
  // so mounting Nest async here is safe. 게임 룸은 Colyseus 그대로,
  // REST(auth/rooms)는 NestJS가 담당한다.
  express: async (app) => {
    app.use(cors());
    app.use(express.json());
    app.use("/monitor", monitor());
    await mountNest(app);
  },
});
