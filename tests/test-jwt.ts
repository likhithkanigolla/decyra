import 'dotenv/config';
import { queryOne } from '../src/integrations/database/postgres.ts';
import { signJwt } from '../src/integrations/database/local-auth.server.ts';

async function test() {
  const user = await queryOne('SELECT id, email, role FROM public.local_users WHERE email = $1', ['nkllk@nkllk.com']);
  console.log("User fetched from DB:", user);

  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  console.log("Generated Token:", token);

  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  console.log("Token Payload:", payload);
}

test().catch(console.error);
