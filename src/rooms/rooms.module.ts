import { Module } from "@nestjs/common";
import { GamesModule } from "../games/games.module.js";
import { RoomsController } from "./rooms.controller.js";

@Module({
  imports: [GamesModule],
  controllers: [RoomsController],
})
export class RoomsModule {}
