# Database Integration Examples

## Configuration

The database type is determined by the `DATABASE_TYPE` environment variable:

```env
# Use local PostgreSQL
DATABASE_TYPE=postgres

# Use Supabase
DATABASE_TYPE=supabase
```

## Usage Examples

### 1. Check Database Type

```typescript
import { getDatabaseConfig } from '@/integrations/database/config';

const config = getDatabaseConfig();

if (config.isSupabase) {
  console.log('Using Supabase');
} else if (config.isLocal) {
  console.log('Using local PostgreSQL');
}
```

### 2. Query Data (Supabase)

```typescript
import { supabase } from '@/integrations/supabase/client';

// If using Supabase
const { data, error } = await supabase
  .from('your_table')
  .select('*')
  .eq('id', 123);
```

### 3. Query Data (Local PostgreSQL)

```typescript
import { query, queryOne } from '@/integrations/database/postgres';

// If using local PostgreSQL
const result = await query('SELECT * FROM your_table WHERE id = $1', [123]);
const singleRow = await queryOne('SELECT * FROM your_table WHERE id = $1', [123]);
```

### 4. Unified Adapter Pattern

```typescript
import { isSupabase, isLocal } from '@/integrations/database/adapter';

async function getUserData(userId: string) {
  if (isSupabase()) {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    return data;
  } else if (isLocal()) {
    const { queryOne } = await import('@/integrations/database/postgres');
    return queryOne(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
  }
}
```

### 5. Conditional Imports

```typescript
import { getDatabaseConfig } from '@/integrations/database/config';

const config = getDatabaseConfig();

if (config.isSupabase) {
  const { supabase } = await import('@/integrations/supabase/client');
  // Use Supabase
} else {
  const { query } = await import('@/integrations/database/postgres');
  // Use PostgreSQL
}
```

### 6. Server Functions with Database Access

```typescript
import { createServerFn } from '@tanstack/react-start/server';
import { getDatabaseConfig } from '@/integrations/database/config';

export const getUserById = createServerFn({ method: 'GET' })
  .param<string>()
  .handler(async (userId) => {
    const config = getDatabaseConfig();

    if (config.isSupabase) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      return data;
    } else {
      const { queryOne } = await import('@/integrations/database/postgres');
      return queryOne(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
    }
  });
```

### 7. Data Validation with Zod

```typescript
import { z } from 'zod';
import { getDatabaseConfig } from '@/integrations/database/config';

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
});

async function getUser(userId: string) {
  const config = getDatabaseConfig();
  let data;

  if (config.isSupabase) {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data: result } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    data = result;
  } else {
    const { queryOne } = await import('@/integrations/database/postgres');
    data = await queryOne(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
  }

  return UserSchema.parse(data);
}
```

## Auth Handling

### Supabase Auth

```typescript
import { supabase } from '@/integrations/supabase/client';
import { attachSupabaseAuth } from '@/integrations/supabase/auth-attacher';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

// Attach auth to requests
export const authMiddleware = attachSupabaseAuth;

// Require auth on server functions
export const protectedFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async (context) => {
    console.log('Authenticated user:', context.userId);
  });
```

### Local PostgreSQL Auth (Manual Implementation Needed)

For local PostgreSQL, you'll need to implement your own authentication:

```typescript
// Example: Simple JWT-based auth for local PostgreSQL
import jwt from 'jsonwebtoken';

function verifyLocalAuth(token: string) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}
```

## Migration Management

### Running Migrations

```typescript
import { runMigrations } from '@/integrations/database/migrate';

// Run all pending migrations
await runMigrations();
```

### Creating New Migrations

1. Create a new SQL file in `supabase/migrations/`:
   ```sql
   -- supabase/migrations/20260612000000_create_table.sql
   CREATE TABLE users (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     email TEXT UNIQUE NOT NULL,
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

2. For Supabase: `supabase db push`
3. For local PostgreSQL: Restart containers or manually apply

## Error Handling

```typescript
import { getDatabaseConfig } from '@/integrations/database/config';

async function safeQuery(userId: string) {
  try {
    const config = getDatabaseConfig();

    if (config.isSupabase) {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId);

      if (error) throw error;
      return data;
    } else {
      const { queryOne } = await import('@/integrations/database/postgres');
      return await queryOne(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
    }
  } catch (error) {
    console.error('Database query failed:', error);
    throw new Error('Failed to fetch user');
  }
}
```

## Performance Tips

1. **Connection Pooling**: Local PostgreSQL uses connection pooling via `pg` package
2. **Query Optimization**: Use indexes and proper WHERE clauses
3. **Caching**: Use React Query for client-side caching
4. **Batch Operations**: Group multiple queries together
5. **Prepared Statements**: Always use parameterized queries (`$1`, `$2`, etc.)

## Switching Databases

To switch from local PostgreSQL to Supabase (or vice versa):

1. Update `.env` with appropriate configuration
2. Ensure all migrations are applied to target database
3. Test with your API calls
4. Restart development server if needed

No code changes required - the adapter handles the switching!
