import { execSync } from 'node:child_process';

const services = ['tulink-postgres', 'tulink-redis'];
const timeoutMs = 120_000;
const intervalMs = 2_000;
const startedAt = Date.now();

function getHealth(service) {
  try {
    const output = execSync(
      `docker inspect --format '{{.State.Health.Status}}' ${service}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return output || 'unknown';
  } catch {
    return 'missing';
  }
}

while (Date.now() - startedAt < timeoutMs) {
  const statuses = services.map((service) => [service, getHealth(service)]);
  if (statuses.every(([, status]) => status === 'healthy')) {
    console.log('Docker infra is healthy:');
    for (const [service, status] of statuses) {
      console.log(`- ${service}: ${status}`);
    }
    process.exit(0);
  }

  console.log(
    statuses.map(([service, status]) => `${service}=${status}`).join(', '),
  );
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

throw new Error(
  `Timed out waiting for Docker infra after ${timeoutMs / 1000}s`,
);
