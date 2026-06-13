import 'dotenv/config';
import { queryOne } from '../src/integrations/database/postgres.ts';

async function test() {
  const result = await queryOne("SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin'");
  console.log("Count result:", result);
}
test().catch(console.error);
