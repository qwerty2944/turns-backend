export const env = {
  port: Number(process.env.PORT || 2567),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  nodeEnv: process.env.NODE_ENV || "development",
};
