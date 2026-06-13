import 'dotenv/config';
import { getMyContext } from '../src/lib/api/decyra.functions.ts';

// Mock the raw context
const mockCtx = {
  userId: '3990a1fd-9341-47c1-860c-53522b5111bb',
  claims: {},
  isDatabaseLocal: true,
};

async function test() {
  // getMyContext is a serverFn. We can reach its handler directly?
  // Wait, createServerFn returns a function that delegates to a handler.
  // Actually, let's just copy the logic inside getMyContext.

  const { query, queryOne } = await import("../src/integrations/database/postgres.ts");
  const userId = mockCtx.userId;

  const [profileRow, rolesRow, membershipsRow] = await Promise.all([
    queryOne("SELECT * FROM profiles WHERE id = $1", [userId]),
    query("SELECT role FROM user_roles WHERE user_id = $1", [userId]),
    query(
      `SELECT pm.role, pm.project_id,
              p.id AS proj_id, p.name AS proj_name, p.code AS proj_code, p.description AS proj_desc
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id = $1`,
      [userId]
    ),
  ]);

  console.log("Profile:", profileRow);
  console.log("Roles:", rolesRow.rows);
  console.log("Memberships:", membershipsRow.rows);
}

test().catch(console.error);
