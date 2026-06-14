import dataSource from './data-source';

async function main() {
  await dataSource.initialize();
  const ran = await dataSource.runMigrations();
  if (ran.length === 0) {
    console.log('[migrations] Already up to date');
  } else {
    console.log(`[migrations] Ran ${ran.length} migration(s): ${ran.map((m) => m.name).join(', ')}`);
  }
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[migrations] FAILED:', err);
  process.exit(1);
});
