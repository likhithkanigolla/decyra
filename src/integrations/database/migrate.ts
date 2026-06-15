/**
 * Migration helper for PostgreSQL
 * Applies SQL migrations from the supabase/migrations directory
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MigrationFile {
  name: string;
  path: string;
  timestamp: number;
}

/**
 * Get all migration files sorted by timestamp
 */
function getMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir);

  return files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({
      name: f,
      path: path.join(migrationsDir, f),
      timestamp: parseInt(f.split('_')[0], 10) || 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get migrations that have already been applied
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations = await query<{ name: string }>('SELECT name FROM migrations');
    return new Set(migrations.rows.map((m) => m.name));
  } catch (error) {
    console.error('Error checking applied migrations:', error);
    return new Set();
  }
}

/**
 * Record a migration as applied
 */
async function recordMigration(name: string): Promise<void> {
  await query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
}

/**
 * Split SQL into executable statements, correctly handling:
 * - Dollar-quoted blocks ($$...$$, $BODY$...$BODY$, etc.)
 * - Semicolons inside strings and comments
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let dollarTag = '';

  while (i < sql.length) {
    // Detect dollar-quote start: $$ or $tag$
    if (sql[i] === '$' && dollarTag === '') {
      // Try to find the closing $
      let j = i + 1;
      while (j < sql.length && sql[j] !== '$' && sql[j] !== '\n') j++;
      if (j < sql.length && sql[j] === '$') {
        const tag = sql.slice(i, j + 1); // e.g. $$ or $BODY$
        current += tag;
        dollarTag = tag;
        i = j + 1;
        continue;
      }
    }

    // Inside a dollar-quoted block — look for matching closing tag
    if (dollarTag !== '') {
      if (sql.slice(i, i + dollarTag.length) === dollarTag) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = '';
        continue;
      }
      current += sql[i++];
      continue;
    }

    // Normal SQL: split on semicolons
    if (sql[i] === ';') {
      const stmt = current.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = '';
      i++;
      continue;
    }

    // Skip single-line comments
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }

    // Skip block comments
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      current += ' ';
      continue;
    }

    current += sql[i++];
  }

  // Catch any trailing statement without semicolon
  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

/**
 * Read and execute a migration file
 */
async function executeMigration(filepath: string): Promise<void> {
  const sql = fs.readFileSync(filepath, 'utf-8');
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    try {
      await query(statement);
    } catch (err: any) {
      console.error(`Statement failed:\n${statement.slice(0, 200)}\n`);
      throw err;
    }
  }
}

/**
 * Run pending migrations
 */
export async function runMigrations(migrationsDir?: string): Promise<void> {
  const dir =
    migrationsDir ||
    path.resolve(__dirname, '../../../supabase/migrations');

  console.log(`📂 Looking for migrations in: ${dir}`);

  const migrationFiles = getMigrationFiles(dir);
  if (migrationFiles.length === 0) {
    console.log('✅ No migrations found');
    return;
  }

  const applied = await getAppliedMigrations();
  const pending = migrationFiles.filter((m) => !applied.has(m.name));

  if (pending.length === 0) {
    console.log('✅ All migrations already applied');
    return;
  }

  console.log(`⏳ Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    try {
      console.log(`  📝 Applying: ${migration.name}`);
      await executeMigration(migration.path);
      await recordMigration(migration.name);
      console.log(`  ✅ Applied: ${migration.name}`);
    } catch (error) {
      console.error(`  ❌ Failed to apply ${migration.name}:`, error);
      throw error;
    }
  }

  console.log('✅ All migrations completed successfully');

  // Auto-seed default admin if there are no admins
  try {
    const roleCheck = await query<{ count: string }>("SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'");
    if (parseInt(roleCheck.rows[0]?.count || '0', 10) === 0) {
      console.log('🌱 No admin found. Seeding default admin...');
      const { createLocalUser } = await import('./local-auth.server');
      const email = process.env.ADMIN_EMAIL || 'decyra_admin';
      const password = process.env.ADMIN_PASSWORD || 'admin1234';
      const fullName = process.env.ADMIN_NAME || 'Platform Admin';
      const user = await createLocalUser(email, password, fullName, 'admin');
      console.log(`✅ Default admin created: ${user.email} / ${password}`);
    }
  } catch (err: any) {
    console.error('⚠️ Failed to seed default admin:', err.message);
  }
}

/**
 * CLI execution
 */
if (process.argv[1] === __filename) {
  const migrationsDir = process.argv[2];

  runMigrations(migrationsDir)
    .then(() => {
      console.log('✅ Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}
