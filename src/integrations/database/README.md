# Database Integration

This module supports both **Supabase** (cloud) and **local PostgreSQL** configurations.

## Configuration

Set `DATABASE_TYPE` environment variable to choose:

### Local PostgreSQL (Development)
```
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:password@localhost:5432/architecture_hub
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=architecture_hub
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

### Supabase (Production)
```
DATABASE_TYPE=supabase
SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-key
VITE_SUPABASE_PUBLISHABLE_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Usage

### Checking Database Type
```typescript
import { getDatabaseConfig } from '@/integrations/database/config';

const config = getDatabaseConfig();
if (config.isSupabase) {
  // Use Supabase
}
if (config.isLocal) {
  // Use local PostgreSQL
}
```

### Validating Configuration
```typescript
import { validateDatabaseConfig } from '@/integrations/database/config';

validateDatabaseConfig(); // Throws error if required env vars are missing
```

## Migration Strategy

### For Supabase
- Use Supabase Studio or migrations in `supabase/migrations/`
- Run: `supabase db push`

### For Local PostgreSQL
- Run migrations directly using SQL files in `supabase/migrations/`
- Or use a migration tool like Flyway, Liquibase, or pg-migrate

## Auth Handling

- **Supabase**: Uses Supabase Auth (JWT tokens)
- **Local PostgreSQL**: Requires custom auth implementation (currently planned)

## Client Usage

The Supabase client is exported from `@/integrations/supabase/client` regardless of DATABASE_TYPE.
When `DATABASE_TYPE=postgres`, you'll need to implement custom database queries instead of using the Supabase client.
