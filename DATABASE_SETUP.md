# Database Setup Guide

This project supports both **Supabase** (cloud) and **local PostgreSQL** for development.

## Quick Start

### Option 1: Local PostgreSQL (Recommended for Development)

1. **Start PostgreSQL with Docker:**
   ```bash
   npm run db:setup
   ```
   
   This will:
   - Start PostgreSQL container (port 5432)
   - Start pgAdmin UI (port 5050)
   - Configure `.env` for local development
   - Apply database migrations

2. **Access your database:**
   - Connection string: `postgresql://postgres:postgres@localhost:5432/architecture_hub`
   - pgAdmin UI: http://localhost:5050 (admin@admin.com / admin)

3. **Stop when done:**
   ```bash
   npm run db:stop
   ```

### Option 2: Supabase (Production/Cloud)

1. **Set `DATABASE_TYPE=supabase` in `.env`:**
   ```
   DATABASE_TYPE=supabase
   SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your-key
   VITE_SUPABASE_PUBLISHABLE_KEY=your-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

2. **Migrations are auto-synced from `supabase/migrations/`**

## Environment Variables

### Local PostgreSQL
```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:password@localhost:5432/architecture_hub
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=architecture_hub
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

### Supabase
```env
DATABASE_TYPE=supabase
SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Database Commands

```bash
# Setup local PostgreSQL with Docker
npm run db:setup

# Stop PostgreSQL containers
npm run db:stop

# Reset database (removes data, restarts fresh)
npm run db:reset

# View logs
docker-compose logs -f postgres

# Connect to database via CLI
docker-compose exec postgres psql -U postgres -d architecture_hub
```

## Database Access

### Via Docker Exec
```bash
docker-compose exec postgres psql -U postgres -d architecture_hub
```

### Via Local CLI (if PostgreSQL installed)
```bash
psql postgresql://postgres:postgres@localhost:5432/architecture_hub
```

### Via pgAdmin UI
- URL: http://localhost:5050
- Email: admin@admin.com
- Password: admin

## Migrations

### For Local PostgreSQL
1. SQL files in `supabase/migrations/` are auto-applied on Docker startup
2. To apply new migrations manually:
   ```bash
   docker-compose exec postgres psql -U postgres -d architecture_hub -f /docker-entrypoint-initdb.d/migration-file.sql
   ```

### For Supabase
1. Create new migrations: `supabase migration new <name>`
2. Deploy: `supabase db push`

## Code Usage

### Check which database is active:
```typescript
import { getDatabaseConfig } from '@/integrations/database/config';

const config = getDatabaseConfig();
console.log(config.type); // 'postgres' or 'supabase'
console.log(config.isLocal); // true for local, false for Supabase
```

### Use the adapter:
```typescript
import { dbAdapter, isSupabase, isLocal } from '@/integrations/database/adapter';

if (isSupabase()) {
  const { supabase } = await import('@/integrations/supabase/client');
  // Use Supabase client
} else if (isLocal()) {
  const { query, queryOne } = await import('@/integrations/database/postgres');
  // Use PostgreSQL client
}
```

## Troubleshooting

### Port Already in Use
```bash
# Change port in docker-compose.yml or .env
POSTGRES_PORT=5433

# Or kill existing process
sudo lsof -ti:5432 | xargs kill -9
```

### Database Connection Failed
1. Check if containers are running: `docker-compose ps`
2. View logs: `docker-compose logs postgres`
3. Restart: `npm run db:reset`

### pgAdmin Can't Connect
1. Wait 10-15 seconds for PostgreSQL to be ready
2. In pgAdmin, create new server connection:
   - Hostname: `postgres` (Docker service name)
   - Port: `5432`
   - Username: `postgres`
   - Password: `postgres`

### Migrations Not Applied
```bash
# Manually apply migrations
docker-compose exec postgres bash -c 'for f in /docker-entrypoint-initdb.d/*.sql; do psql -U postgres -d architecture_hub -f "$f"; done'
```

## Security Notes

### Local Development
- Default credentials (postgres/postgres) are only for local development
- Change `POSTGRES_PASSWORD` in `.env` if using this in any networked environment

### Production (Supabase)
- Never commit `.env` with real Supabase keys
- Use environment secrets in your CI/CD pipeline
- Rotate keys regularly
- Use service role key only on secure servers

## Switching Between Databases

To switch from Supabase to Local:
1. Update `.env`: `DATABASE_TYPE=postgres`
2. Run: `npm run db:setup` (if PostgreSQL not running)
3. Run: `npm install` (to install pg driver if needed)
4. Restart development server: `npm run dev`

To switch from Local to Supabase:
1. Update `.env`: `DATABASE_TYPE=supabase`
2. Add Supabase credentials to `.env`
3. Restart development server: `npm run dev`

## Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [pgAdmin Documentation](https://www.pgadmin.org/docs/)
- [Supabase Documentation](https://supabase.com/docs)
- [Docker Documentation](https://docs.docker.com/)
