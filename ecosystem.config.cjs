module.exports = {
  apps: [
    {
      // AKIRA Python/FastAPI extractor. Runs on port 5100
      // (NOT 5000/5001 — those are taken by macOS Control
      // Center on this Mac). PM2 auto-restarts if it
      // crashes; the 6h launchd pipeline (see
      // ~/Library/LaunchAgents/com.antena.akira-pipeline.plist)
      // triggers the harvest cycle separately.
      name: 'akira',
      cwd: './packages/akira',
      script: './.venv/bin/uvicorn',
      args: 'main:app --host 0.0.0.0 --port 5100 --log-level info',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '500M',
      error_file: '/tmp/akira-akira-error.log',
      out_file: '/tmp/akira-akira-out.log',
      merge_logs: true,
      env: {
        PYTHONPATH: '.',
      },
    },
    {
      // API worker (Cloudflare Hono). Local dev only — production
      // is the deployed wrangler on akira-api.miclusty.workers.dev.
      name: 'akira-api',
      cwd: './packages/api',
      script: 'wrangler',
      args: 'dev --env=production --port 8787',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      error_file: '/tmp/akira-api-error.log',
      out_file: '/tmp/akira-api-out.log',
      merge_logs: true,
      watch: false,
    },
    {
      // Antena frontend (Astro). Local dev only — production
      // is the Pages deploy.
      name: 'web',
      cwd: './packages/antena',
      script: 'pnpm',
      args: 'dev',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      error_file: '/tmp/akira-antena-error.log',
      out_file: '/tmp/akira-antena-out.log',
      merge_logs: true,
      watch: false,
    },
  ],
};
