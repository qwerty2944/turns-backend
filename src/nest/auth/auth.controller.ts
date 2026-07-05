import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthPayload } from "../../shared/auth/jwt.js";
import { CurrentUser, JwtAuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";

@Controller("auth")
export class AuthController {
  // 명시적 @Inject — tsx(esbuild)는 emitDecoratorMetadata를 지원하지
  // 않으므로 design:paramtypes에 의존하지 않는다.
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("signup")
  signup(@Body() body: Record<string, unknown>) {
    return this.auth.signup(body);
  }

  @Post("login")
  login(@Body() body: Record<string, unknown>) {
    return this.auth.login(body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthPayload) {
    return this.auth.me(user);
  }

  @Patch("me/nickname")
  @UseGuards(JwtAuthGuard)
  updateNickname(
    @CurrentUser() user: AuthPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.auth.updateNickname(user, body);
  }

  @Patch("me/password")
  @UseGuards(JwtAuthGuard)
  updatePassword(
    @CurrentUser() user: AuthPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.auth.updatePassword(user, body);
  }
}
