const env = require('./config/env');
const prisma = require('./config/prisma');
const { createApp } = require('./app');
const scheduler = require('./jobs/scheduler');

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`\n  StayEase running at ${env.appUrl}  (port ${env.port}, ${env.nodeEnv})`);
    console.log(`  Payments: ${env.payments.provider}${env.payments.provider === 'mock' ? ' (simulated — development only)' : ''}`);
    console.log(`  Email:    ${env.brevo.apiKey ? 'Brevo' : 'console (BREVO_API_KEY not set)'}\n`);
  });
  scheduler.start();

  const shutdown = async (sig) => {
    console.log(`\n${sig} received, shutting down…`);
    scheduler.stop();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start StayEase:', err);
  process.exit(1);
});
