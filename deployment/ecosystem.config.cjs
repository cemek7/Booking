// pm2 process config for the Boka Next.js app on the Hostinger VPS.
//
// First deploy:   pm2 start deployment/ecosystem.config.cjs
// Redeploy:       pm2 reload boka           (zero-downtime) or  pm2 restart boka
// Boot on reboot: pm2 save && pm2 startup   (run once, follow the printed command)
//
// Env comes from .env.production in the repo root (created on the VPS from env.example —
// NEVER committed). Next.js loads .env.production automatically for `next start`.
module.exports = {
  apps: [
    {
      name: 'boka',
      cwd: __dirname + '/..',
      script: 'npm',
      args: 'start', // -> NODE_OPTIONS='--max-old-space-size=2048' next start
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
