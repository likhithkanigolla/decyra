# Quick Reference

## Start Here

### First Time Setup (Local PostgreSQL)
```bash
npm install
npm run db:setup
npm run dev
```

### First Time Setup (Supabase)
```bash
npm install
# Update .env with Supabase credentials
npm run dev
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm run db:setup` | Start PostgreSQL with Docker |
| `npm run db:stop` | Stop PostgreSQL containers |
| `npm run db:reset` | Delete all data and restart fresh |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |

## Database Access

### PostgreSQL (local)
- **Connection**: `postgresql://postgres:postgres@localhost:5432/architecture_hub`
- **pgAdmin**: http://localhost:5050
- **CLI**: `docker-compose exec postgres psql -U postgres -d architecture_hub`

### Supabase (cloud)
- **Console**: https://app.supabase.com
- **API Documentation**: Check Supabase project settings
- **Migrations**: Run `supabase db push`

## Environment Variables

### For Local PostgreSQL
```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/architecture_hub
```

### For Supabase
```env
DATABASE_TYPE=supabase
SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-key
VITE_SUPABASE_PUBLISHABLE_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Code Patterns

### Check Database Type
```typescript
import { isSupabase, isLocal } from '@/integrations/database/adapter';

if (isSupabase()) {
  // Use Supabase
} else if (isLocal()) {
  // Use local PostgreSQL
}
```

### Query Data
```typescript
// For Supabase
import { supabase } from '@/integrations/supabase/client';
const { data } = await supabase.from('table').select('*');

// For PostgreSQL
import { query } from '@/integrations/database/postgres';
const { rows } = await query('SELECT * FROM table');
```

## Documentation Files

- **[DATABASE_SETUP.md](./DATABASE_SETUP.md)** - Complete setup guide
- **[EXAMPLES.md](./src/integrations/database/EXAMPLES.md)** - Code examples
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and fixes

## Need Help?

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. View docker logs: `docker-compose logs -f`
3. Check pgAdmin: http://localhost:5050
4. Review database config: `src/integrations/database/config.ts`

## Switching Databases

To switch from local to Supabase:
1. Update `DATABASE_TYPE` in `.env`
2. Add Supabase credentials
3. Ensure migrations are applied
4. Restart dev server

No code changes needed!
