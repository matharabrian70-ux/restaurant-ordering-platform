const base = String(process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!base) {
  console.log('SMOKE_BASE_URL not set; production smoke test skipped.');
  process.exit(0);
}

const checks = [
  ['health', '/health', 200],
  ['protected platform packages', '/api/platform/packages', 401],
];

for (const [name, path, expected] of checks) {
  const response = await fetch(base + path, { redirect: 'manual' });
  if (response.status !== expected) {
    throw new Error(`${name}: expected HTTP ${expected}, got ${response.status}`);
  }
}

const health = await fetch(base + '/health').then(r => r.json());
if (!health.ok || !health.database) throw new Error('health endpoint did not report database=true');

console.log(`Production smoke checks passed for ${base}`);
