/**
 * Bootstrap script: creates the first admin user in PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts
 *
 * Or with custom values:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret123 ADMIN_NAME="Your Name" npx tsx scripts/create-admin.ts
 */

import 'dotenv/config';
import { createLocalUser } from '../src/integrations/database/local-auth.server.ts';
import { closePool } from '../src/integrations/database/postgres.ts';
import { runMigrations } from '../src/integrations/database/migrate.ts';

import { randomBytes } from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';
const email = process.env.ADMIN_EMAIL || (isProduction ? '' : 'decyra_admin');

let password = process.env.ADMIN_PASSWORD || '';
let generatedPassword = false;

if (isProduction) {
  if (!email) {
    console.error('❌ FATAL: ADMIN_EMAIL must be explicitly provided in production mode.');
    process.exit(1);
  }
  if (password === 'admin1234') {
    console.error('❌ FATAL: Default password "admin1234" is forbidden in production mode. Set a strong ADMIN_PASSWORD.');
    process.exit(1);
  }
  if (!password) {
    // Generate a secure high-entropy random password for first-run bootstrap
    password = randomBytes(16).toString('base64url');
    generatedPassword = true;
  } else if (password.length < 12) {
    console.error('❌ FATAL: ADMIN_PASSWORD must be at least 12 characters in production mode.');
    process.exit(1);
  }
} else {
  // Local development defaults
  password = password || 'admin1234';
}

const fullName = process.env.ADMIN_NAME || 'Platform Admin';
const username = process.env.ADMIN_USERNAME || (email.includes('@') ? email.split('@')[0] : email);


async function main() {
  console.log('🔄 Ensuring database is migrated...');
  await runMigrations();

  console.log(`\n👤 Creating admin user:`);
  console.log(`   Email    : ${email}`);
  console.log(`   Username : ${username}`);
  console.log(`   Name     : ${fullName}`);
  console.log(`   Password : ${'*'.repeat(password.length)}`);
  console.log(`   Role     : admin\n`);

  try {
    const user = await createLocalUser(email, password, fullName, 'admin', username);
    console.log('✅ Admin user created successfully!');
    console.log(`   ID: ${user.id}`);
    if (user.recoveryKey) {
      console.log(`   🔑 Recovery Key saved to server: recovery-keys/${email.replace(/[^a-zA-Z0-9._-]/g, '_')}.recovery.key`);
    }
    console.log(`\n🚀 You can now log in at http://localhost:3000/auth`);
    console.log(`   Email/Username: ${user.username || email}`);
    if (generatedPassword) {
      console.log(`   Generated Password: ${password}`);
      console.log('   ⚠️  Keep this password safe and change it upon first login.');
    } else {
      console.log(`   Password      : (the one you set)`);
    }

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
