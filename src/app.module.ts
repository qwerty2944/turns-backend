import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { GamesModule } from "./games/games.module.js";
import { RoomsModule } from "./rooms/rooms.module.js";
import { UsersModule } from "./users/users.module.js";

@Module({
  imports: [UsersModule, AuthModule, RoomsModule, GamesModule],
})
export class AppModule {}
