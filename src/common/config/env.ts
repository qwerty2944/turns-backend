const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required (Colyseus Cloud → Environment Variables tab)",
  );
}

const jwtSecret =
  (process.env.JWT_SECRET ?? "").trim() || "dev-secret-change-me";

export const env = {
  port: Number(process.env.PORT || 2567),
  jwtSecret,
  databaseUrl,
};
