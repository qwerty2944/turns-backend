// PM2 / Colyseus Cloud process definition.
// Cloud reads this file at deploy time.
// - exec_mode MUST be "fork" (cluster is unsupported by Colyseus)
// - @colyseus/tools `listen()` derives the port from NODE_APP_INSTANCE
module.exports = {
  apps: [
    {
      name: "turns",
      script: "build/index.js",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
