import { getPostgresPool } from './src/integrations/database/postgres.js';

async function run() {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE public.profiles ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT false;');
    console.log('Migration applied successfully');
  } catch (e) {
    if (e.message.includes('already exists')) {
      console.log('Column already exists');
    } else {
      console.error('Error applying migration:', e);
    }
  } finally {
    client.release();
    pool.end();
  }
}
run();
