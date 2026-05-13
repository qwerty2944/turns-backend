import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db/index.js";
import { users, type UserRow } from "../../shared/db/schema.js";

export type { UserRow };

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
