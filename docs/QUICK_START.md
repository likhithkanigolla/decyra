# Quick Reference

## Start Here

### First Time Setup
```bash
npm install
npm run db:setup
npm run dev
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm run db:setup` | Start PostgreSQL with Docker |
| `npm run db:stop` | Stop PostgreSQL containers |
| `npm run db:reset` | Delete all data and restart fresh |
| `npm run create-admin` | Create the initial administrator |
| `npm run reset-password` | Reset a user password via CLI |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm test` | Run test suite |

## Database Access

### PostgreSQL
- **Connection**: `postgresql://postgres:postgres@localhost:5432/decyra`
- **CLI**: `docker compose exec postgres psql -U postgres -d decyra`

## Environment Variables

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/decyra
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=decyra
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_JWT_SECRET=your-secret-key
```

## Code Patterns

### Query Data
```typescript
import { query, queryOne } from '@/integrations/database/postgres';

// Fetch multiple rows
const { rows } = await query('SELECT * FROM projects WHERE owner_id = $1', [userId]);

// Fetch single row
const adr = await queryOne('SELECT * FROM adrs WHERE id = $1', [adrId]);
```
