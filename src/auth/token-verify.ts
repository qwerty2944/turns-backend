import { verifyToken, type AuthPayload } from "./jwt.js";
import { userRepo } from "../users/users.repository.js";

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
 *
 * Nest 가드(JwtAuthGuard)와 Colyseus 룸의 onAuth가 공유하는 단일 검증
 * 경로 — 룸은 Nest DI 밖에서 인스턴스화되므로 함수로 노출한다.
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
