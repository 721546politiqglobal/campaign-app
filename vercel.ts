export const config = {
  crons: [{ path: '/api/cron/publish', schedule: '*/5 * * * *' }],
} as const;
