import 'dotenv/config';
import { getMyContext } from '../src/lib/api/decyra.functions.ts';
import { attachSupabaseAuth } from '../src/integrations/supabase/auth-attacher.ts';

// We can't directly call getMyContext as it's a serverFn, but we can do a fetch to the dev server
async function test() {
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3ODEzNjEyMTcsImV4cCI6MTc4MTk2NjAxNywic3ViIjoiMzk5MGExZmQtOTM0MS00N2MxLTg2MGMtNTM1MjJiNTExMWJiIiwiZW1haWwiOiJua2xsa0Bua2xsay5jb20iLCJyb2xlIjoibWVtYmVyIn0.FpG3rPD_cCcbGkLAv5b3FW-53AmKEf4LTGYMhVNeN0E';
  const res = await fetch('http://localhost:3000/decyra/_server/?_serverFnId=getMyContext', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([])
  });
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

test().catch(console.error);
