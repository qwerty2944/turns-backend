const required = (key: string, fallback?: string) => {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env: ${key}`);
};

export const env = {
  port: Number(process.env.PORT || 2567),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  databaseUrl: required(
    "DATABASE_URL",
    process.env.NODE_ENV === "production"
      ? undefined
      : "postgres://postgres:postgres@localhost:5432/turns",
  ),
  nodeEnv: process.env.NODE_ENV || "development",
};
