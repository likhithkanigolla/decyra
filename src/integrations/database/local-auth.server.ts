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
  full_name: string | null;
  role: string;
}

// ─── Auth Operations ─────────────────────────────────────────────────────────

/**
 * Verify credentials and return a signed JWT.
 */
export async function loginLocal(
  email: string,
  password: string
): Promise<{ token: string; user: LocalUser }> {
  const user = await queryOne<{ id: string; email: string; full_name: string | null; password_hash: string; role: string }>(
    'SELECT id, email, full_name, password_hash, role FROM public.local_users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  if (!user) throw new Error('Invalid email or password');

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw new Error('Invalid email or password');

  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } };
}

/**
 * Create a new user in local Postgres.
 * Also inserts into auth.users (the compat shim), profiles, and user_roles.
 */
export async function createLocalUser(
  email: string,
  password: string,
  fullName: string,
  role: 'admin' | 'member' = 'member'
): Promise<LocalUser> {
  const existingEmail = email.toLowerCase().trim();

  const existing = await queryOne(
    'SELECT id FROM public.local_users WHERE email = $1',
    [existingEmail]
  );
  if (existing) throw new Error('A user with that email already exists');

  const passwordHash = await hashPassword(password);

  // Use a single transaction to keep everything consistent
  await query('BEGIN');
  try {
    // 1. Insert into auth.users (needed for FK references in profiles, user_roles, etc.)
    const authUser = await queryOne<{ id: string }>(
      `INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [existingEmail, passwordHash, JSON.stringify({ full_name: fullName })]
    );
    if (!authUser) throw new Error('Failed to create auth user');

    const userId = authUser.id;

    // 2. Insert into local_users (for password login)
    await query(
      `INSERT INTO public.local_users (id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, existingEmail, fullName, passwordHash, role]
    );

    // 3. Insert into profiles
    await query(
      `INSERT INTO public.profiles (id, email, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name`,
      [userId, existingEmail, fullName]
    );

    // 4. Insert into user_roles
    await query(
      `INSERT INTO public.user_roles (user_id, role)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, role]
    );

    await query('COMMIT');

    return { id: userId, email: existingEmail, full_name: fullName, role };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}
