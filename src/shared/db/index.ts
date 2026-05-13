import postgres from "postgres";
import { env } from "../config/env.js";

export const sql = postgres(env.databaseUrl, {
  // Neon and most managed PGs require SSL — auto-detect via URL hint.
  ssl: env.databaseUrl.includes("sslmode=require") ? "require" : "prefer",
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const initSchema = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
};
