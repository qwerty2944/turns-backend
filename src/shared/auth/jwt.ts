import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AuthPayload = {
  userId: number;
  email: string;
  nickname: string;
};

export const signToken = (payload: AuthPayload): string =>
  jwt.sign(payload, env.jwtSecret, { expiresIn: "30d" });

export const verifyToken = (token: string): AuthPayload | null => {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload &
      AuthPayload;
    return {
      userId: decoded.userId,
      email: decoded.email,
      nickname: decoded.nickname,
    };
  } catch {
    return null;
  }
};
