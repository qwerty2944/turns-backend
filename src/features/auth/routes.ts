import { Router, Request, Response } from "express";
import { userRepo } from "../../entities/user/model.js";
import {
  hashPassword,
  verifyPassword,
} from "../../shared/auth/password.js";
import { signToken } from "../../shared/auth/jwt.js";
import { requireAuth } from "../../shared/auth/middleware.js";

const router = Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nicknameRegex = /^[\p{L}\p{N}_-]{2,12}$/u;

router.post("/signup", async (req: Request, res: Response) => {
  const { email, password, passwordConfirm, nickname } = req.body ?? {};

  if (!email || !password || !passwordConfirm) {
    return res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요" });
  }
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "이메일 형식이 올바르지 않습니다" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다" });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: "비밀번호가 일치하지 않습니다" });
  }
  if (await userRepo.findByEmail(email)) {
    return res.status(409).json({ error: "이미 사용 중인 이메일입니다" });
  }

  const passwordHash = await hashPassword(password);
  const finalNickname =
    (typeof nickname === "string" && nickname.trim()) ||
    email.split("@")[0].slice(0, 12);
  const user = await userRepo.create(email, passwordHash, finalNickname);
  const userId = Number(user.id);
  const token = signToken({
    userId,
    email: user.email,
    nickname: user.nickname,
    tokenVersion: user.tokenVersion,
  });
  return res.json({
    token,
    user: { id: userId, email: user.email, nickname: user.nickname },
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요" });
  }
  const user = await userRepo.findByEmail(email);
  if (!user) {
    return res
      .status(401)
      .json({ error: "이메일 또는 비밀번호가 잘못되었습니다" });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res
      .status(401)
      .json({ error: "이메일 또는 비밀번호가 잘못되었습니다" });
  }
  // Every successful login bumps the user's token version so any older
  // browser/tab logged in as this user has its JWT invalidated.
  const tokenVersion = await userRepo.bumpTokenVersion(Number(user.id));
  const userId = Number(user.id);
  const token = signToken({
    userId,
    email: user.email,
    nickname: user.nickname,
    tokenVersion,
  });
  return res.json({
    token,
    user: { id: userId, email: user.email, nickname: user.nickname },
  });
});

router.get("/me", requireAuth, (req: Request, res: Response) => {
  return res.json({ user: req.user });
});

router.patch(
  "/me/nickname",
  requireAuth,
  async (req: Request, res: Response) => {
    const raw = (req.body?.nickname ?? "").toString().trim();
    if (!nicknameRegex.test(raw)) {
      return res
        .status(400)
        .json({ error: "닉네임은 2~12자, 한글/영문/숫자/_- 만 가능합니다" });
    }
    const updated = await userRepo.updateNickname(req.user!.userId, raw);
    const token = signToken({
      userId: Number(updated.id),
      email: updated.email,
      nickname: updated.nickname,
      tokenVersion: updated.tokenVersion,
    });
    return res.json({
      token,
      user: {
        id: Number(updated.id),
        email: updated.email,
        nickname: updated.nickname,
      },
    });
  },
);

router.patch(
  "/me/password",
  requireAuth,
  async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string"
    ) {
      return res.status(400).json({ error: "현재 및 새 비밀번호를 입력해주세요" });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "새 비밀번호는 6자 이상이어야 합니다" });
    }
    const user = await userRepo.findById(req.user!.userId);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    }
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "현재 비밀번호가 일치하지 않습니다" });
    }
    const hash = await hashPassword(newPassword);
    await userRepo.updatePassword(req.user!.userId, hash);
    // Force-logout every other browser/tab — they'll get 401 on next call.
    await userRepo.bumpTokenVersion(req.user!.userId);
    return res.json({ ok: true });
  },
);

export default router;
