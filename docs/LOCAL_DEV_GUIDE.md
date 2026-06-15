# Local Development Mode Guide

Now your app works in **local PostgreSQL mode** without requiring Supabase!

## Quick Start (3 Steps)

### Step 1: Start PostgreSQL
```bash
npm run db:setup
```

This starts:
- PostgreSQL database on port 5432
- pgAdmin UI on http://localhost:5050 (admin@admin.com / admin)

### Step 2: Start Development Server
```bash
npm run dev
```

Server runs at: http://localhost:5173 (or similar)

### Step 3: Use Development Token
The auth middleware now supports **development tokens** in local mode!

Your `.env` has:
```
LOCAL_DEV_MODE=true
DEV_USER_ID=dev-user-00000000-0000-0000-0000-000000000000
```

Any token starting with `dev-` is accepted in local mode.

## How It Works

### Authentication Flow

1. **Supabase Mode** (`DATABASE_TYPE=supabase`)
   - Uses real Supabase JWT tokens
   - Validates against Supabase servers

2. **Local Development Mode** (`DATABASE_TYPE=postgres` + `LOCAL_DEV_MODE=true`)
   - Accepts any token starting with `dev-`
   - No external auth provider needed
   - Perfect for local development

### Making API Calls

#### From Browser/Client Code

```typescript
// Import the dev helper
import { getDevAuthHeader } from '@/integrations/database/dev-helpers';

// Make authenticated request
const response = await fetch('/api/some-endpoint', {
  method: 'GET',
  headers: getDevAuthHeader(),
});
```

#### Using React Query / TanStack Query

```typescript
import { useQuery } from '@tanstack/react-query';
import { getDevelopmentToken } from '@/integrations/database/dev-helpers';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${getDevelopmentToken()}`,
        },
      });
      return response.json();
    },
  });
}
```

#### Direct Fetch

```typescript
// Simple way - just add the dev token
const token = 'dev-test-token-12345'; // or 'dev-anything'

const response = await fetch('/api/list-projects', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

## Server Functions with Local Database

Your server functions now work with both databases:

```typescript
// Server function (src/lib/api/decyra.functions.ts)
export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireFlexibleAuth])  // Now supports both databases!
  .handler(async ({ context }) => {
    const { userId, supabase, isDatabaseLocal } = context;
    
    if (isDatabaseLocal) {
      // Using local PostgreSQL
      console.log('Using local database');
    } else {
      // Using Supabase
      const { data } = await supabase.from('table').select('*');
    }
    
    return { userId };
  });
```

## Switching Between Databases

### To Use Local PostgreSQL (Development)
```bash
# Update .env
DATABASE_TYPE=postgres
LOCAL_DEV_MODE=true

# Start PostgreSQL
npm run db:setup

# Start dev server
npm run dev

# Use dev token in requests
```

### To Use Supabase (Production)
```bash
# Update .env
DATABASE_TYPE=supabase
LOCAL_DEV_MODE=false
SUPABASE_URL=your_url
VITE_SUPABASE_URL=your_url
SUPABASE_PUBLISHABLE_KEY=your_key
VITE_SUPABASE_PUBLISHABLE_KEY=your_key

# Restart dev server
npm run dev

# Use real Supabase auth tokens
```

## Database Access

### pgAdmin Web UI
- URL: http://localhost:5050
- Email: admin@admin.com
- Password: admin
- Add connection:
  - Host: `postgres` (use service name, not localhost)
  - Port: 5432
  - Database: decyra
  - Username: postgres
  - Password: postgres

### PostgreSQL CLI
```bash
# Access database directly
docker-compose exec postgres psql -U postgres -d decyra

# Common SQL commands
\dt              # List tables
\d table_name    # Describe table
SELECT * FROM users LIMIT 10;  # Query data
```

### Using PostgreSQL Client
```typescript
import { query, queryOne } from '@/integrations/database/postgres';

// Query multiple rows
const { rows } = await query('SELECT * FROM users');

// Query single row
const user = await queryOne('SELECT * FROM users WHERE id = $1', ['user-id']);
```

## Available Helpers

### Development Helpers (`src/integrations/database/dev-helpers.ts`)

```typescript
import {
  getDevelopmentToken,        // Get a test token
  getDevAuthHeader,           // Get auth headers for fetch
  fetchWithDevAuth,           // Fetch with auth auto-added
  createMockUserContext,      // Create mock user for testing
} from '@/integrations/database/dev-helpers';

// Use in your code
const token = getDevelopmentToken();
const headers = getDevAuthHeader();
const response = await fetchWithDevAuth('/api/endpoint');
```

### Database Context (`src/integrations/database/context.ts`)

```typescript
import {
  getDatabaseClient,          // Get database client
  isSupabaseContext,          // Check if Supabase
  isLocalContext,             // Check if local PostgreSQL
  getUserProfile,             // Get profile (database-agnostic)
} from '@/integrations/database/context';

// Use in server functions
const { type, client } = await getDatabaseClient(context);
if (type === 'postgres') {
  // Use PostgreSQL client
}
```

## Troubleshooting

### Error: "Unauthorized: No token provided"
**Solution**: Add auth header to your request
```typescript
fetch('/api/endpoint', {
  headers: { 'Authorization': 'Bearer dev-test-token' }
})
```

### Error: "PostgreSQL connection refused"
**Solution**: Start PostgreSQL first
```bash
npm run db:setup
# Wait 10 seconds for it to start
```

### Error: "Database does not exist"
**Solution**: Reset the database
```bash
npm run db:reset
```

### Server functions return Supabase errors
**Solution**: Check `DATABASE_TYPE` in `.env`
```bash
# Make sure it's set to postgres
echo $DATABASE_TYPE
# Should output: postgres
```

### Can't access pgAdmin
**Solution**: Use service name `postgres`, not `localhost`
- Host: `postgres` ✅
- Host: `localhost` ❌

## Next Steps

1. **Review Server Functions**
   - Check: `src/lib/api/decyra.functions.ts`
   - They now use `requireFlexibleAuth` middleware
   - Works with both Supabase and local PostgreSQL

2. **Update Client Code if Needed**
   - Replace hardcoded Supabase calls with database-agnostic helpers
   - Use `getDatabaseClient()` for database-agnostic access

3. **Create Database Tables**
   - SQL migrations are in `supabase/migrations/`
   - Auto-applied when PostgreSQL starts
   - Or manually run with: `npm run db:migrate`

4. **Test Your API**
   - Use development token: `Bearer dev-test-token`
   - Check pgAdmin for data: http://localhost:5050

## Environment Configuration

Your `.env` now has:

| Variable | Value | Purpose |
|----------|-------|---------|
| `DATABASE_TYPE` | `postgres` | Use local PostgreSQL |
| `LOCAL_DEV_MODE` | `true` | Enable dev token support |
| `NODE_ENV` | `development` | Development mode |
| `DEV_USER_ID` | UUID | Your test user ID |
| `DATABASE_URL` | postgres://... | PostgreSQL connection |

## Commands Reference

```bash
# Database
npm run db:setup        # Start PostgreSQL + pgAdmin
npm run db:stop         # Stop containers
npm run db:reset        # Wipe data and restart

# Development
npm run dev             # Start dev server
npm run build           # Build for production
npm run lint            # Lint code
npm run format          # Format code
```

## Security Notes

- ⚠️ **LOCAL_DEV_MODE=true** is development only
- ⚠️ Don't use in production
- ⚠️ Disable in production: `LOCAL_DEV_MODE=false`
- Use real JWT validation for production PostgreSQL
- Use Supabase for production recommended

## Still Having Issues?

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common problems
2. View logs: `docker-compose logs -f postgres`
3. Check config: `src/integrations/database/config.ts`
4. Review auth: `src/integrations/supabase/auth-flexible.ts`
