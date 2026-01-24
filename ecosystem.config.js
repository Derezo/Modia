module.exports = {
  apps: [
    {
      name: 'modia-api',
      script: './api/src/index.js',

      // Cluster mode for multi-core utilization
      // NOTE: Set to 1 until sticky sessions or Redis pub/sub is implemented
      // WebSocket connections may route to different instances without state sharing
      // Increase to 2+ after implementing: nginx ip_hash, Redis adapter, or sticky sessions
      instances: 1,
      exec_mode: 'cluster',

      // Memory management
      max_memory_restart: '1G',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },

      // File watching (development only)
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'frontend/dist'],

      // Logging configuration
      // Production paths use symlinked shared/logs directory
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,

      // Graceful reload settings
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Restart settings
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,

      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100,

      // Source maps for better error traces
      source_map_support: true,

      // Node.js arguments
      node_args: '--max-old-space-size=1024'
    }
  ],

  // Deployment configuration (UNUSED - use deploy-production.sh instead)
  // Kept as reference template only. The custom deploy scripts provide better
  // features like dry-run, health checks, and automatic rollback.
  deploy: {
    production: {
      user: 'root',  // TODO: Create dedicated deploy user for security
      host: 'mittonvillage.com',
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_USERNAME/Modia.git',  // PLACEHOLDER - update if used
      path: '<APP_DIR>',
      'pre-deploy-local': '',
      'post-deploy': 'npm ci --omit=dev && npm run db:migrate && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
