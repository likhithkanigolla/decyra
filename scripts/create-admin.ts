/**
 * Bootstrap script: creates the first admin user in local PostgreSQL mode.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts
 *
 * Or with custom values:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret123 ADMIN_NAME="Your Name" npx tsx scripts/create-admin.ts
 *
 * This ONLY works when DATABASE_TYPE=postgres (local mode).
 * For Supabase mode, use the Supabase dashboard to create the first user.
 */

import 'dotenv/config';
import { createLocalUser } from '../src/integrations/database/local-auth.server.ts';
import { closePool } from '../src/integrations/database/postgres.ts';
import { runMigrations } from '../src/integrations/database/migrate.ts';

const email    = process.env.ADMIN_EMAIL    || 'admin@localhost.com';
const password = process.env.ADMIN_PASSWORD || 'admin1234';
const fullName = process.env.ADMIN_NAME     || 'Platform Admin';

async function main() {
  console.log('🔄 Ensuring database is migrated...');
  await runMigrations();

  console.log(`\n👤 Creating admin user:`);
  console.log(`   Email    : ${email}`);
  console.log(`   Name     : ${fullName}`);
  console.log(`   Password : ${'*'.repeat(password.length)}`);
  console.log(`   Role     : admin\n`);

  try {
    const user = await createLocalUser(email, password, fullName, 'admin');
    console.log('✅ Admin user created successfully!');
    console.log(`   ID: ${user.id}`);
    console.log(`\n🚀 You can now log in at http://localhost:3000/auth`);
    console.log(`   Email   : ${email}`);
    console.log(`   Password: (the one you set)`);
  } catch (err: any) {
    if (err.message?.includes('already exists')) {
      console.log('ℹ️  A user with that email already exists.');
      console.log('   If you need to reset the password, delete the user from the DB and re-run.');
    } else {
      console.error('❌ Failed to create admin:', err.message);
      process.exit(1);
    }
  } finally {
    await closePool();
  }
}

main();
