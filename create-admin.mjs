var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/integrations/database/config.ts
function getPostgresConfig() {
  return {
    url: process.env.DATABASE_URL,
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "decyra",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD
  };
}
var init_config = __esm({
  "src/integrations/database/config.ts"() {
    "use strict";
  }
});

// src/integrations/database/postgres.ts
import { Pool } from "pg";
function getPostgresPool() {
  if (pool) {
    return pool;
  }
  const config = getPostgresConfig();
  pool = new Pool({
    connectionString: config.url || `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`,
    // Keep a warm pool so connections are never created on the hot path
    min: 2,
    max: parseInt(process.env.POSTGRES_POOL_MAX ?? "10", 10),
    // Release idle connections after 30 s to avoid phantom holds on the DB
    idleTimeoutMillis: 3e4,
    // Fail fast if we can't get a connection within 5 s (instead of hanging)
    connectionTimeoutMillis: 5e3,
    // Keep TCP connections alive to avoid reconnects after Docker bridge idle
    keepAlive: true,
    keepAliveInitialDelayMillis: 1e4
  });
  pool.on("error", (err) => {
    console.error("[pg-pool] Unexpected error on idle client:", err.message);
  });
  pool.connect().then((c) => c.release()).catch(() => {
  });
  return pool;
}
async function query(text, values) {
  const client = await getPostgresPool().connect();
  try {
    const result = await client.query(text, values);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  } finally {
    client.release();
  }
}
async function queryOne(text, values) {
  const result = await query(text, values);
  return result.rows[0] || null;
}
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
var pool;
var init_postgres = __esm({
  "src/integrations/database/postgres.ts"() {
    "use strict";
    init_config();
    pool = null;
  }
});

// src/integrations/database/local-auth.server.ts
var local_auth_server_exports = {};
__export(local_auth_server_exports, {
  createLocalUser: () => createLocalUser,
  generateAndSaveRecoveryKey: () => generateAndSaveRecoveryKey,
  loginLocal: () => loginLocal,
  resetPasswordWithRecoveryKey: () => resetPasswordWithRecoveryKey,
  signJwt: () => signJwt,
  signUpLocal: () => signUpLocal,
  verifyJwt: () => verifyJwt
});
import { randomBytes, pbkdf2, createHmac, timingSafeEqual } from "crypto";
function hashPassword(password2) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString("hex");
    pbkdf2(password2, salt, 1e5, 64, "sha256", (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}
function verifyPassword(password2, stored) {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return resolve(false);
    pbkdf2(password2, salt, 1e5, 64, "sha256", (err, derivedKey) => {
      if (err) return reject(err);
      try {
        const derived = Buffer.from(derivedKey.toString("hex"));
        const expected = Buffer.from(hash);
        if (derived.length !== expected.length) return resolve(false);
        resolve(timingSafeEqual(derived, expected));
      } catch {
        resolve(false);
      }
    });
  });
}
function b64url(data) {
  const str = typeof data === "string" ? Buffer.from(data) : data;
  return str.toString("base64url");
}
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1e3);
  const body = b64url(JSON.stringify({ iat: now, exp: now + TOKEN_EXPIRY_SECONDS, ...payload }));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token) {
  try {
    const [header, body, sig] = token.split(".");
    if (!header || !body || !sig) return null;
    const expected = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1e3)) return null;
    return payload;
  } catch {
    return null;
  }
}
async function loginLocal(identifier, password2) {
  const user = await queryOne(
    `SELECT u.id, u.email, u.username, u.full_name, u.password_hash, u.role, p.is_locked 
     FROM public.local_users u 
     LEFT JOIN public.profiles p ON u.id = p.id 
     WHERE u.email = $1 OR u.username = $1`,
    [identifier.toLowerCase().trim()]
  );
  if (!user) throw new Error("Invalid email, username, or password");
  if (user.is_locked) {
    throw new Error("Your account has been locked. Please contact your administrator.");
  }
  const valid = await verifyPassword(password2, user.password_hash);
  if (!valid) throw new Error("Invalid email, username, or password");
  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { token, user: { id: user.id, email: user.email, username: user.username, full_name: user.full_name, role: user.role } };
}
async function signUpLocal(email2, password2, fullName2, role = "member", username) {
  const user = await createLocalUser(email2, password2, fullName2, role, username);
  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { token, user };
}
async function createLocalUser(email2, password2, fullName2, role = "member", username) {
  const existingEmail = email2.toLowerCase().trim();
  const existingUser = username ? username.toLowerCase().trim() : null;
  const existing = await queryOne(
    "SELECT id FROM public.local_users WHERE email = $1 OR (username IS NOT NULL AND username = $2)",
    [existingEmail, existingUser]
  );
  if (existing) throw new Error("A user with that email or username already exists");
  const passwordHash = await hashPassword(password2);
  await query("BEGIN");
  try {
    const authUser = await queryOne(
      `INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [existingEmail, passwordHash, JSON.stringify({ full_name: fullName2, username: existingUser })]
    );
    if (!authUser) throw new Error("Failed to create auth user");
    const userId = authUser.id;
    await query(
      `INSERT INTO public.local_users (id, email, full_name, password_hash, role, username)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, existingEmail, fullName2, passwordHash, role, existingUser]
    );
    await query(
      `INSERT INTO public.profiles (id, email, full_name, username)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, username = EXCLUDED.username`,
      [userId, existingEmail, fullName2, existingUser]
    );
    await query(
      `INSERT INTO public.user_roles (user_id, role)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, role]
    );
    await query("COMMIT");
    const recoveryKey = await generateAndSaveRecoveryKey(userId, existingEmail);
    return { id: userId, email: existingEmail, username: existingUser, full_name: fullName2, role, recoveryKey };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}
async function generateAndSaveRecoveryKey(userId, email2) {
  const fs2 = await import("fs");
  const path2 = await import("path");
  const recoveryKey = `rec_${randomBytes(16).toString("hex")}`;
  const keyHash = await hashPassword(recoveryKey);
  await query(
    "UPDATE public.local_users SET recovery_key_hash = $1 WHERE id = $2",
    [keyHash, userId]
  );
  const keysDir = path2.resolve(process.cwd(), "recovery-keys");
  if (!fs2.existsSync(keysDir)) {
    fs2.mkdirSync(keysDir, { recursive: true, mode: 448 });
  }
  const sanitizedEmail = email2.replace(/[^a-zA-Z0-9._-]/g, "_");
  const keyFilePath = path2.join(keysDir, `${sanitizedEmail}.recovery.key`);
  const keyFileContent = [
    `# ============================================================`,
    `# Decyra Account Recovery Key`,
    `# User: ${email2}`,
    `# Generated At: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    `# NOTE: Keep this file secure. Anyone with server access can`,
    `# read this key to reset the password for this account.`,
    `# ============================================================`,
    ``,
    `RECOVERY_KEY=${recoveryKey}`,
    ``
  ].join("\n");
  fs2.writeFileSync(keyFilePath, keyFileContent, { encoding: "utf8", mode: 384 });
  return recoveryKey;
}
async function resetPasswordWithRecoveryKey(identifier, recoveryKey, newPassword) {
  const user = await queryOne(
    `SELECT id, email, recovery_key_hash FROM public.local_users 
     WHERE email = $1 OR username = $1`,
    [identifier.toLowerCase().trim()]
  );
  if (!user || !user.recovery_key_hash) {
    throw new Error("Invalid account or no recovery key has been configured.");
  }
  const validKey = await verifyPassword(recoveryKey.trim(), user.recovery_key_hash);
  if (!validKey) {
    throw new Error("Invalid recovery key. Please check the file on your server.");
  }
  const newPasswordHash = await hashPassword(newPassword);
  await query("BEGIN");
  try {
    await query(
      "UPDATE auth.users SET encrypted_password = $1 WHERE email = $2",
      [newPasswordHash, user.email]
    );
    await query(
      "UPDATE public.local_users SET password_hash = $1 WHERE id = $2",
      [newPasswordHash, user.id]
    );
    const newRecoveryKey = await generateAndSaveRecoveryKey(user.id, user.email);
    await query("COMMIT");
    return {
      success: true,
      message: `Password reset successfully! A new recovery key was saved to your server for ${user.email}.`
    };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}
var JWT_SECRET, TOKEN_EXPIRY_SECONDS;
var init_local_auth_server = __esm({
  "src/integrations/database/local-auth.server.ts"() {
    "use strict";
    init_postgres();
    JWT_SECRET = process.env.POSTGRES_JWT_SECRET || "local-dev-jwt-secret-change-in-production";
    TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 7;
  }
});

// scripts/create-admin.ts
init_local_auth_server();
init_postgres();
import "dotenv/config";

// src/integrations/database/migrate.ts
init_postgres();
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function getMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const files = fs.readdirSync(migrationsDir);
  return files.filter((f) => f.endsWith(".sql")).map((f) => ({
    name: f,
    path: path.join(migrationsDir, f),
    timestamp: parseInt(f.split("_")[0], 10) || 0
  })).sort((a, b) => a.timestamp - b.timestamp);
}
async function getAppliedMigrations() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const migrations = await query("SELECT name FROM migrations");
    return new Set(migrations.rows.map((m) => m.name));
  } catch (error) {
    console.error("Error checking applied migrations:", error);
    return /* @__PURE__ */ new Set();
  }
}
async function recordMigration(name) {
  await query("INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
}
function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let dollarTag = "";
  while (i < sql.length) {
    if (sql[i] === "$" && dollarTag === "") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== "$" && sql[j] !== "\n") j++;
      if (j < sql.length && sql[j] === "$") {
        const tag = sql.slice(i, j + 1);
        current += tag;
        dollarTag = tag;
        i = j + 1;
        continue;
      }
    }
    if (dollarTag !== "") {
      if (sql.slice(i, i + dollarTag.length) === dollarTag) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = "";
        continue;
      }
      current += sql[i++];
      continue;
    }
    if (sql[i] === ";") {
      const stmt = current.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = "";
      i++;
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      current += "\n";
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      current += " ";
      continue;
    }
    current += sql[i++];
  }
  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }
  return statements;
}
async function executeMigration(filepath) {
  const sql = fs.readFileSync(filepath, "utf-8");
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    try {
      await query(statement);
    } catch (err) {
      console.error(`Statement failed:
${statement.slice(0, 200)}
`);
      throw err;
    }
  }
}
async function runMigrations(migrationsDir) {
  const dir = migrationsDir || (fs.existsSync(path.resolve(__dirname, "../../../migrations")) ? path.resolve(__dirname, "../../../migrations") : path.resolve(process.cwd(), "migrations"));
  console.log(`\u{1F4C2} Looking for migrations in: ${dir}`);
  const migrationFiles = getMigrationFiles(dir);
  if (migrationFiles.length === 0) {
    console.log("\u2705 No migrations found");
    return;
  }
  const applied = await getAppliedMigrations();
  const pending = migrationFiles.filter((m) => !applied.has(m.name));
  if (pending.length === 0) {
    console.log("\u2705 All migrations already applied");
    return;
  }
  console.log(`\u23F3 Running ${pending.length} pending migration(s)...`);
  for (const migration of pending) {
    try {
      console.log(`  \u{1F4DD} Applying: ${migration.name}`);
      await executeMigration(migration.path);
      await recordMigration(migration.name);
      console.log(`  \u2705 Applied: ${migration.name}`);
    } catch (error) {
      console.error(`  \u274C Failed to apply ${migration.name}:`, error);
      throw error;
    }
  }
  console.log("\u2705 All migrations completed successfully");
  try {
    const roleCheck = await query("SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'");
    if (parseInt(roleCheck.rows[0]?.count || "0", 10) === 0) {
      console.log("\u{1F331} No admin found. Seeding default admin...");
      const { createLocalUser: createLocalUser2 } = await Promise.resolve().then(() => (init_local_auth_server(), local_auth_server_exports));
      const email2 = process.env.ADMIN_EMAIL || "decyra_admin";
      const password2 = process.env.ADMIN_PASSWORD || "admin1234";
      const fullName2 = process.env.ADMIN_NAME || "Platform Admin";
      const user = await createLocalUser2(email2, password2, fullName2, "admin");
      console.log(`\u2705 Default admin created: ${user.email} / ${password2}`);
    }
  } catch (err) {
    console.error("\u26A0\uFE0F Failed to seed default admin:", err.message);
  }
}
if (process.argv[1] === __filename) {
  const migrationsDir = process.argv[2];
  runMigrations(migrationsDir).then(() => {
    console.log("\u2705 Done");
    process.exit(0);
  }).catch((error) => {
    console.error("\u274C Migration failed:", error);
    process.exit(1);
  });
}

// scripts/create-admin.ts
var email = process.env.ADMIN_EMAIL || "decyra_admin";
var password = process.env.ADMIN_PASSWORD || "admin1234";
var fullName = process.env.ADMIN_NAME || "Platform Admin";
async function main() {
  console.log("\u{1F504} Ensuring database is migrated...");
  await runMigrations();
  console.log(`
\u{1F464} Creating admin user:`);
  console.log(`   Email    : ${email}`);
  console.log(`   Name     : ${fullName}`);
  console.log(`   Password : ${"*".repeat(password.length)}`);
  console.log(`   Role     : admin
`);
  try {
    const user = await createLocalUser(email, password, fullName, "admin");
    console.log("\u2705 Admin user created successfully!");
    console.log(`   ID: ${user.id}`);
    if (user.recoveryKey) {
      console.log(`   \u{1F511} Recovery Key saved to server: recovery-keys/${email.replace(/[^a-zA-Z0-9._-]/g, "_")}.recovery.key`);
    }
    console.log(`
\u{1F680} You can now log in at http://localhost:3000/auth`);
    console.log(`   Email   : ${email}`);
    console.log(`   Password: (the one you set)`);
  } catch (err) {
    if (err.message?.includes("already exists")) {
      console.log("\u2139\uFE0F  A user with that email already exists.");
      console.log("   If you need to reset the password, delete the user from the DB and re-run.");
    } else {
      console.error("\u274C Failed to create admin:", err.message);
      process.exit(1);
    }
  } finally {
    await closePool();
  }
}
main();
