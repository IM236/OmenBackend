import { pathToFileURL } from 'url';

import { initializeDatabase, getDatabasePool, shutdownDatabase } from '@infra/database';
import { logger } from '@infra/logging/logger';

import { migrationId as initMigrationId, up as initUp } from './001_init';

interface Migration {
  id: string;
  up: () => Promise<void>;
}

const migrations: Migration[] = [
  {
    id: initMigrationId,
    up: initUp
  }
];

export const runMigrations = async (): Promise<void> => {
  await initializeDatabase();
  const pool = getDatabasePool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const executed = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  const executedIds = new Set(executed.rows.map((row) => row.id));

  for (const migration of migrations) {
    if (executedIds.has(migration.id)) {
      logger.info({ migration: migration.id }, 'Migration already applied');
      continue;
    }

    logger.info({ migration: migration.id }, 'Applying migration');
    await migration.up();
    await pool.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
  }
};

const isCliExecution = () => {
  const modulePath = process.argv[1];
  if (!modulePath) {
    return false;
  }

  return import.meta.url === pathToFileURL(modulePath).toString();
};

if (isCliExecution()) {
  runMigrations()
    .then(async () => {
      logger.info('Migrations applied successfully');
      await shutdownDatabase();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error(error, 'Migration run failed');
      await shutdownDatabase();
      process.exit(1);
    });
}
