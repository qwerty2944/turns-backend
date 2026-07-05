import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { RoomsController } from "./rooms/rooms.controller.js";

@Module({
  controllers: [AuthController, RoomsController],
  providers: [AuthService],
})
export class AppModule {}
