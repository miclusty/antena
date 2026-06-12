module.exports = {
  apps: [
    {
      name: 'akira',
      cwd: './packages/akira',
      script: 'python3',
      args: '-m uvicorn main:app --host 0.0.0.0 --port 5000',
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
        PYTHONPATH: '.'
      }
    },
    {
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
      watch: false
    },
    {
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
      watch: false
    }
  ]
};
