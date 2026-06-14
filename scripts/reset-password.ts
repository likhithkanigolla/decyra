import 'dotenv/config';
import { queryOne, query } from '../src/integrations/database/postgres';
import { randomBytes, pbkdf2 } from 'crypto';

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    pbkdf2(password, salt, 100_000, 64, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function main() {
  const emailOrUsername = process.argv[2];
  const newPassword = process.argv[3];

  if (!emailOrUsername || !newPassword) {
    console.error('Usage: npm run reset-password <email-or-username> <new-password>');
    process.exit(1);
  }

  const identifier = emailOrUsername.toLowerCase().trim();

  try {
    const user = await queryOne<{ id: string, email: string }>(
      'SELECT id, email FROM public.local_users WHERE email = $1 OR username = $1',
      [identifier]
    );

    if (!user) {
      console.error('User not found.');
      process.exit(1);
    }

    const passwordHash = await hashPassword(newPassword);

    await query('BEGIN');
    
    await query(
      'UPDATE auth.users SET encrypted_password = $1 WHERE email = $2',
      [passwordHash, user.email]
    );

    await query(
      'UPDATE public.local_users SET password_hash = $1 WHERE id = $2',
      [passwordHash, user.id]
    );

    await query('COMMIT');
    console.log(`Successfully updated password for user ${user.email}`);
  } catch (err) {
    await query('ROLLBACK');
    console.error('Failed to update password:', err);
  } finally {
    process.exit(0);
  }
}

main();
