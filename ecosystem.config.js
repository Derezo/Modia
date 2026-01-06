module.exports = {
  apps: [
    {
      name: 'modia-api',
      script: './api/src/index.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      time: true
    }
  ]
};
