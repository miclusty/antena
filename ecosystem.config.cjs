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
    {
      // AKIRA live-crawl. Cron-restart every 30 minutes selects the
      // top 50 sources by oldest-last-harvest, resets seen_urls for
      // those sources, and delegates the cascade to harvest_run.py.
      // cron_restart is "*"/30 — runs at minute 0 and 30 of every
      // hour. autorestart=false so a failing run doesn't loop.
      // The 6h pipeline (~/Library/LaunchAgents/com.antena.akira-pipeline.plist)
      // is the heavy re-cluster + embed path; this is the news-feed
      // heartbeat.
      name: 'akira-harvest',
      cwd: './packages/akira',
      script: './.venv/bin/python',
      args: '-m scripts.harvest_full_cycle --max-sources 50',
      interpreter: 'none',
      instances: 1,
      autorestart: false,
      cron_restart: '0,30 * * * *',
      max_memory_restart: '500M',
      error_file: '/tmp/akira-harvest-error.log',
      out_file: '/tmp/akira-harvest-out.log',
      merge_logs: true,
      env: {
        PYTHONPATH: '.',
      },
    },
    {
      // AKIRA emerging-themes detector. Runs every 15 minutes to
      // recompute the `emerging_clusters` SQLite mirror table that
      // powers the /api/emerging endpoint. Pure SQL aggregation —
      // no LLM, no network — so a 5-minute drift is acceptable and
      // we keep the cron coarse (every 15 min) to leave cycles for
      // the heavier harvest job. autorestart=false on purpose: if
      // the recompute fails (DB locked, etc.) we don't want it
      // busy-looping. The next 15-min cron tick retries.
      name: 'akira-emerging',
      cwd: './packages/akira',
      script: './.venv/bin/python',
      args: '-m scripts.update_emerging_themes',
      interpreter: 'none',
      instances: 1,
      autorestart: false,
      cron_restart: '*/15 * * * *',
      max_memory_restart: '200M',
      error_file: '/tmp/akira-emerging-error.log',
      out_file: '/tmp/akira-emerging-out.log',
      merge_logs: true,
      env: {
        PYTHONPATH: '.',
      },
    },
    {
      // AKIRA → D1 sync (hourly). Mirrors clusters, emerging_clusters,
      // sources_credibility, and news_cards_simhash from AKIRA's local
      // SQLite to Cloudflare D1 via the HTTP API
      // (core/d1_sync.py + core/cloudflare_d1.py). This is the
      // belt-and-suspenders safety net for the inline sync calls in
      // scripts/harvest_full_cycle.py and scripts/update_emerging_themes.py.
      // If those inline calls fail or get skipped, this hourly cron
      // catches up. autorestart=false: a single failed tick isn't a
      // crash — the next tick at minute 0 retries.
      name: 'akira-d1-sync',
      cwd: './packages/akira',
      script: './.venv/bin/python',
      args: '-m scripts.sync_to_d1_cron',
      interpreter: 'none',
      instances: 1,
      autorestart: false,
      cron_restart: '0 * * * *',
      max_memory_restart: '300M',
      error_file: '/tmp/akira-d1-sync-error.log',
      out_file: '/tmp/akira-d1-sync-out.log',
      merge_logs: true,
      env: {
        PYTHONPATH: '.',
      },
    },
  ],
};
