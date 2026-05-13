import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthPayload } from "./jwt.js";
import { userRepo } from "../../entities/user/model.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * Decode + verify a Bearer JWT, then confirm the embedded tokenVersion
 * still matches what the DB has for this user. Returns the payload on
 * success or null on any failure (signature, missing user, stale version).
 */
export const verifyAuthRequest = async (
  token: string,
): Promise<AuthPayload | null> => {
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await userRepo.findById(payload.userId);
  if (!user) return null;
  if (user.tokenVersion !== payload.tokenVersion) return null;
  return payload;
};

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }
  const payload = await verifyAuthRequest(auth.slice("Bearer ".length));
  if (!payload) {
    return res
      .status(401)
      .json({ error: "다른 브라우저에서 로그인되었거나 토큰이 만료되었습니다" });
  }
  req.user = payload;
  next();
};
