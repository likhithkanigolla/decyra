# Database Integration Examples

Decyra uses native PostgreSQL queries via parameterized SQL helpers.

## Configuration

In `.env`:

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/decyra
POSTGRES_JWT_SECRET=local-dev-jwt-secret-change-in-production
```

## Querying Data

### 1. Simple Query

```typescript
import { query, queryOne } from '@/integrations/database/postgres';

// Fetch multiple rows
const { rows: projects } = await query<Project>(
  'SELECT * FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC',
  [userId]
);

// Fetch a single row
const adr = await queryOne<Adr>(
  'SELECT * FROM adrs WHERE id = $1',
  [adrId]
);
```

### 2. Transaction / Modifications

```typescript
import { query } from '@/integrations/database/postgres';

await query(
  'INSERT INTO adrs (id, title, status, project_id) VALUES ($1, $2, $3, $4)',
  [newId, title, 'draft', projectId]
);
```

### 3. Server Function with Auth Middleware

```typescript
import { createServerFn } from '@tanstack/react-start';
import { requireAuth } from '@/integrations/database/auth-middleware';
import { query } from '@/integrations/database/postgres';

export const listMyProjects = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const userId = context.user.id;
    const { rows } = await query(
      'SELECT * FROM projects WHERE owner_id = $1',
      [userId]
    );
    return rows;
  });
```
