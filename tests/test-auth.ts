import 'dotenv/config';
import { loginLocal } from '../src/integrations/database/local-auth.server.ts';

async function test() {
  const result = await loginLocal('test@tester.com', 'test1234'); // Guessing the password
  console.log(result);
}
test().catch(console.error);
