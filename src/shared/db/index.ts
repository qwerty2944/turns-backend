import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

// Catch malformed connection strings (e.g. stray whitespace from a copy-paste
// into the Cloud env tab) before they bubble up as a cryptic "Invalid URL"
// out of the postgres driver — the dashboard input is the actual culprit
// here so make the error point at it.
try {
  new URL(env.databaseUrl);
} catch {
  throw new Error(
    `DATABASE_URL is not a valid URL (check Colyseus Cloud env vars for stray whitespace). Got length=${env.databaseUrl.length}.`,
  );
}

// `prepare: false` is recommended whenever you go through Supabase poolers.
const client = postgres(env.databaseUrl, {
  ssl: "require",
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });
export { schema };
