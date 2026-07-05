import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { db } from "../database/database.js";
import { users, type UserRow } from "../database/schema.js";

export type { UserRow };

/**
 * 유저 영속성. Nest에는 UsersRepository로 주입되고, Colyseus 룸의
 * onAuth(verifyAuthRequest)처럼 DI 밖에서 쓰는 코드는 userRepo 싱글턴을
 * 그대로 사용한다 — 같은 객체다.
 */
export const userRepo = {
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return row;
  },

  async findById(id: number): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  },

  async create(
    email: string,
    passwordHash: string,
    nickname: string,
  ): Promise<UserRow> {
    const [row] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        nickname,
        createdAt: Date.now(),
      })
      .returning();
    return row;
  },

  async updateNickname(id: number, nickname: string): Promise<UserRow> {
    const [row] = await db
      .update(users)
      .set({ nickname })
      .where(eq(users.id, id))
      .returning();
    return row;
  },

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  },

  async bumpTokenVersion(id: number): Promise<number> {
    const [row] = await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning();
    return row?.tokenVersion ?? 0;
  },
};

@Injectable()
export class UsersRepository {
  findByEmail = userRepo.findByEmail;
  findById = userRepo.findById;
  create = userRepo.create;
  updateNickname = userRepo.updateNickname;
  updatePassword = userRepo.updatePassword;
  bumpTokenVersion = userRepo.bumpTokenVersion;
}
