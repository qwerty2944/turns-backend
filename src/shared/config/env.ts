const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const env = {
  port: Number(process.env.PORT || 2567),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  databaseUrl,
};
