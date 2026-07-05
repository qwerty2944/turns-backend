import { HttpException, Inject, Injectable } from "@nestjs/common";
import { UsersRepository } from "../users/users.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signToken, type AuthPayload } from "./jwt.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nicknameRegex = /^[\p{L}\p{N}_-]{2,12}$/u;

// 이메일은 대소문자/공백 차이로 로그인이 튕기지 않도록 항상 정규화한다.
const normEmail = (raw: unknown): string =>
  typeof raw === "string" ? raw.trim().toLowerCase() : "";

/** 기존 Express 라우터와 동일한 에러 바디({error}) 유지. */
const fail = (status: number, error: string): never => {
  throw new HttpException({ error }, status);
};

export type PublicUser = { id: number; email: string; nickname: string };

const toPublic = (u: {
  id: number | bigint;
  email: string;
  nickname: string;
}): PublicUser => ({ id: Number(u.id), email: u.email, nickname: u.nickname });

@Injectable()
export class AuthService {
  constructor(@Inject(UsersRepository) private readonly users: UsersRepository) {}

  async signup(body: Record<string, unknown> | undefined) {
    const email = normEmail(body?.email);
    const password = body?.password;
    const passwordConfirm = body?.passwordConfirm;
    const nickname = body?.nickname;

    if (!email || !password || !passwordConfirm) {
      fail(400, "이메일과 비밀번호를 입력해주세요");
    }
    if (!emailRegex.test(email)) {
      fail(400, "이메일 형식이 올바르지 않습니다");
    }
    if (typeof password !== "string" || password.length < 6) {
      fail(400, "비밀번호는 6자 이상이어야 합니다");
    }
    if (password !== passwordConfirm) {
      fail(400, "비밀번호가 일치하지 않습니다");
    }
    if (await this.users.findByEmail(email)) {
      fail(409, "이미 사용 중인 이메일입니다");
    }

    const passwordHash = await hashPassword(password as string);
    const finalNickname =
      (typeof nickname === "string" && nickname.trim()) ||
      email.split("@")[0].slice(0, 12);
    const user = await this.users.create(email, passwordHash, finalNickname);
    const token = signToken({
      userId: Number(user.id),
      email: user.email,
      nickname: user.nickname,
      tokenVersion: user.tokenVersion,
    });
    return { token, user: toPublic(user) };
  }

  async login(body: Record<string, unknown> | undefined) {
    const email = normEmail(body?.email);
    const password = body?.password;
    if (!email || !password) {
      fail(400, "이메일과 비밀번호를 입력해주세요");
    }
    const user = await this.users.findByEmail(email);
    if (!user) {
      fail(401, "이메일 또는 비밀번호가 잘못되었습니다");
    }
    const valid = await verifyPassword(password as string, user!.passwordHash);
    if (!valid) {
      fail(401, "이메일 또는 비밀번호가 잘못되었습니다");
    }
    // 로그인마다 tokenVersion 범프 → 다른 기기의 이전 JWT 전부 무효화
    // (단일 활성 세션 정책).
    const tokenVersion = await this.users.bumpTokenVersion(Number(user!.id));
    const token = signToken({
      userId: Number(user!.id),
      email: user!.email,
      nickname: user!.nickname,
      tokenVersion,
    });
    return { token, user: toPublic(user!) };
  }

  me(payload: AuthPayload) {
    // login/signup과 동일한 {id, email, nickname} 형태 유지.
    return {
      user: {
        id: payload.userId,
        email: payload.email,
        nickname: payload.nickname,
      },
    };
  }

  async updateNickname(payload: AuthPayload, body: Record<string, unknown> | undefined) {
    const raw = (body?.nickname ?? "").toString().trim();
    if (!nicknameRegex.test(raw)) {
      fail(400, "닉네임은 2~12자, 한글/영문/숫자/_- 만 가능합니다");
    }
    const updated = await this.users.updateNickname(payload.userId, raw);
    const token = signToken({
      userId: Number(updated.id),
      email: updated.email,
      nickname: updated.nickname,
      tokenVersion: updated.tokenVersion,
    });
    return { token, user: toPublic(updated) };
  }

  async updatePassword(payload: AuthPayload, body: Record<string, unknown> | undefined) {
    const currentPassword = body?.currentPassword;
    const newPassword = body?.newPassword;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      fail(400, "현재 및 새 비밀번호를 입력해주세요");
    }
    if ((newPassword as string).length < 6) {
      fail(400, "새 비밀번호는 6자 이상이어야 합니다");
    }
    const user = await this.users.findById(payload.userId);
    if (!user) {
      fail(404, "사용자를 찾을 수 없습니다");
    }
    const valid = await verifyPassword(
      currentPassword as string,
      user!.passwordHash,
    );
    if (!valid) {
      fail(401, "현재 비밀번호가 일치하지 않습니다");
    }
    const hash = await hashPassword(newPassword as string);
    await this.users.updatePassword(payload.userId, hash);
    // Force-logout every other browser/tab — they'll get 401 on next call.
    await this.users.bumpTokenVersion(payload.userId);
    return { ok: true as const };
  }
}
