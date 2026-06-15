/**
 * Local authentication helpers for PostgreSQL mode.
 * Used ONLY when DATABASE_TYPE=postgres.
 * Never imported in Supabase mode.
 *
 * Uses Node's built-in `crypto` module for:
 *   - Password hashing: PBKDF2-SHA256 (no extra dependency)
 *   - JWT: HS256 signed with POSTGRES_JWT_SECRET
 */

import { randomBytes, pbkdf2, createHmac, timingSafeEqual } from 'crypto';
import { query, queryOne } from './postgres';

const JWT_SECRET = process.env.POSTGRES_JWT_SECRET || 'local-dev-jwt-secret-change-in-production';
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ─── Password Hashing ────────────────────────────────────────────────────────

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    pbkdf2(password, salt, 100_000, 64, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return resolve(false);
    pbkdf2(password, salt, 100_000, 64, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      try {
        const derived = Buffer.from(derivedKey.toString('hex'));
        const expected = Buffer.from(hash);
        if (derived.length !== expected.length) return resolve(false);
        resolve(timingSafeEqual(derived, expected));
      } catch {
        resolve(false);
      }
    });
  });
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

function b64url(data: string | Buffer): string {
  const str = typeof data === 'string' ? Buffer.from(data) : data;
  return str.toString('base64url');
}

export function signJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ iat: now, exp: now + TOKEN_EXPIRY_SECONDS, ...payload }));
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── User Types ──────────────────────────────────────────────────────────────

export interface LocalUser {
  id: string;
  email: string;
  username?: string | null;
  full_name: string | null;
  role: string;
}

// ─── Auth Operations ─────────────────────────────────────────────────────────

/**
 * Verify credentials and return a signed JWT.
 */
export async function loginLocal(
  identifier: string,
  password: string
): Promise<{ token: string; user: LocalUser }> {
  const user = await queryOne<{ id: string; email: string; username: string | null; full_name: string | null; password_hash: string; role: string; is_locked: boolean }>(
    `SELECT u.id, u.email, u.username, u.full_name, u.password_hash, u.role, p.is_locked 
     FROM public.local_users u 
     LEFT JOIN public.profiles p ON u.id = p.id 
     WHERE u.email = $1 OR u.username = $1`,
    [identifier.toLowerCase().trim()]
  );

  if (!user) throw new Error('Invalid email, username, or password');
  
  if (user.is_locked) {
    throw new Error('Your account has been locked. Please contact your administrator.');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw new Error('Invalid email, username, or password');

  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { token, user: { id: user.id, email: user.email, username: user.username, full_name: user.full_name, role: user.role } };
}

/**
 * Sign up a new user and return a signed JWT.
 */
export async function signUpLocal(
  email: string,
  password: string,
  fullName: string,
  role: 'admin' | 'member' = 'member',
  username?: string
): Promise<{ token: string; user: LocalUser }> {
  const user = await createLocalUser(email, password, fullName, role, username);
  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { token, user };
}

/**
 * Create a new user in local Postgres.
 * Also inserts into auth.users (the compat shim), profiles, and user_roles.
 */
export async function createLocalUser(
  email: string,
  password: string,
  fullName: string,
  role: 'admin' | 'member' = 'member',
  username?: string
): Promise<LocalUser> {
  const existingEmail = email.toLowerCase().trim();
  const existingUser = username ? username.toLowerCase().trim() : null;

  const existing = await queryOne(
    'SELECT id FROM public.local_users WHERE email = $1 OR (username IS NOT NULL AND username = $2)',
    [existingEmail, existingUser]
  );
  if (existing) throw new Error('A user with that email or username already exists');

  const passwordHash = await hashPassword(password);

  // Use a single transaction to keep everything consistent
  await query('BEGIN');
  try {
    // 1. Insert into auth.users (needed for FK references in profiles, user_roles, etc.)
    const authUser = await queryOne<{ id: string }>(
      `INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [existingEmail, passwordHash, JSON.stringify({ full_name: fullName, username: existingUser })]
    );
    if (!authUser) throw new Error('Failed to create auth user');

    const userId = authUser.id;

    // 2. Insert into local_users (for password login)
    await query(
      `INSERT INTO public.local_users (id, email, full_name, password_hash, role, username)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, existingEmail, fullName, passwordHash, role, existingUser]
    );

    // 3. Insert into profiles
    await query(
      `INSERT INTO public.profiles (id, email, full_name, username)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, username = EXCLUDED.username`,
      [userId, existingEmail, fullName, existingUser]
    );

    // 4. Insert into user_roles
    await query(
      `INSERT INTO public.user_roles (user_id, role)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, role]
    );

    await query('COMMIT');

    return { id: userId, email: existingEmail, username: existingUser, full_name: fullName, role };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}
