import { bigint, bigserial, integer, pgTable, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nickname: text("nickname").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  // Bumped on every fresh login (or password change). JWTs are stamped with
  // the version that was current at issue time; any older token is rejected
  // by requireAuth / Colyseus onAuth, so the previous browser/tab is forced
  // out as soon as it makes its next authenticated call.
  tokenVersion: integer("token_version").notNull().default(1),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
