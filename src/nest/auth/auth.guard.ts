import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { verifyAuthRequest } from "../../shared/auth/middleware.js";
import type { AuthPayload } from "../../shared/auth/jwt.js";

/** Bearer JWT + tokenVersion 검증 — 기존 requireAuth 미들웨어와 동일 계약. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new HttpException({ error: "인증이 필요합니다" }, 401);
    }
    const payload = await verifyAuthRequest(auth.slice("Bearer ".length));
    if (!payload) {
      throw new HttpException(
        { error: "다른 브라우저에서 로그인되었거나 토큰이 만료되었습니다" },
        401,
      );
    }
    req.user = payload;
    return true;
  }
}

/** 가드가 심어둔 인증 페이로드를 컨트롤러 파라미터로 주입. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPayload => {
    const req = context.switchToHttp().getRequest<Request>();
    return req.user!;
  },
);
