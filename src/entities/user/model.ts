import { sql } from "../../shared/db/index.js";

export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  nickname: string;
  created_at: number;
};

export const userRepo = {
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const rows = await sql<UserRow[]>`
      SELECT id, email, password_hash, nickname, created_at
      FROM users WHERE email = ${email} LIMIT 1
    `;
    return rows[0];
  },

  async findById(id: number): Promise<UserRow | undefined> {
    const rows = await sql<UserRow[]>`
      SELECT id, email, password_hash, nickname, created_at
      FROM users WHERE id = ${id} LIMIT 1
    `;
    return rows[0];
  },

  async create(
    email: string,
    passwordHash: string,
    nickname: string,
  ): Promise<UserRow> {
    const rows = await sql<UserRow[]>`
      INSERT INTO users (email, password_hash, nickname, created_at)
      VALUES (${email}, ${passwordHash}, ${nickname}, ${Date.now()})
      RETURNING id, email, password_hash, nickname, created_at
    `;
    return rows[0];
  },
};
