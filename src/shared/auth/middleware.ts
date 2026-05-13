import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthPayload } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }
  const payload = verifyToken(auth.slice("Bearer ".length));
  if (!payload) {
    return res.status(401).json({ error: "토큰이 유효하지 않습니다" });
  }
  req.user = payload;
  next();
};
