import { Router, Request, Response } from "express";
import { userRepo } from "../../entities/user/model.js";
import {
  hashPassword,
  verifyPassword,
} from "../../shared/auth/password.js";
import { signToken, verifyToken } from "../../shared/auth/jwt.js";

const router = Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res
      .status(401)
      .json({ error: "이메일 또는 비밀번호가 잘못되었습니다" });
  }
  const userId = Number(user.id);
  const token = signToken({
    userId,
    email: user.email,
    nickname: user.nickname,
  });
  return res.json({
    token,
    user: { id: userId, email: user.email, nickname: user.nickname },
  });
});

router.get("/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }
  const token = auth.slice("Bearer ".length);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "토큰이 유효하지 않습니다" });
  }
  return res.json({ user: payload });
});

export default router;
