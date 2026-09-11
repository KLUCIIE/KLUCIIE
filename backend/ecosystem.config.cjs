module.exports = {
  apps: [
    {
      name: 'kl-ciie-api',
      script: 'dist/index.js',
      instances: 'max',           // Use all CPU cores
      exec_mode: 'cluster',       // Cluster mode for load balancing
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Restart strategy
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Health check
      health_check_grace_period: 3000,
      // Reload on config change
      reload_config: false,
    },
  ],
  // Deployment config
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-server-ip'],
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/kl-ciie-backend.git',
      path: '/var/www/kl-ciie',
      'pre-setup': 'apt-get install -y redis-server postgresql',
      'post-setup': 'npm install && npm run build',
      env: {
        NODE_ENV: 'production',
      },
    },
  },
}
