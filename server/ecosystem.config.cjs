// PM2 process manager config for the Oracle Cloud VM.
// Keeps the server running, restarts it on crash, and restarts it on VM
// reboot (once `pm2 startup` + `pm2 save` have been run — see DEPLOY.md).
module.exports = {
  apps: [
    {
      name: "mentimeter-server",
      script: "dist/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
