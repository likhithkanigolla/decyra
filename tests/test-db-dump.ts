import 'dotenv/config';
import { getPostgresPool } from '../src/integrations/database/postgres.ts';

async function test() {
  const pool = getPostgresPool();
  const res = await pool.query('SELECT id, email, full_name FROM local_users');
  console.log("Users in DB:", res.rows);

  const profiles = await pool.query('SELECT id, email, full_name FROM profiles');
  console.log("Profiles in DB:", profiles.rows);

  const authUsers = await pool.query('SELECT id, email FROM auth.users');
  console.log("Auth Users in DB:", authUsers.rows);

  await pool.end();
}

test().catch(console.error);
