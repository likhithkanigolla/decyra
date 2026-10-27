# Database Integration

Decyra runs on native **PostgreSQL** with built-in JWT authentication and automated schema migrations.

## Configuration

Set PostgreSQL credentials in `.env`:

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/decyra

# Or discrete connection parameters:
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=decyra
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Secret used to sign HS256 local auth JWTs
POSTGRES_JWT_SECRET=your-secret-key-change-in-production
```

## Architecture

- **Database Client**: Native `pg` connection pool with query helpers (`query`, `queryOne`) in `src/integrations/database/postgres.ts`.
- **Authentication**: Local PBKDF2 password hashing with HS256 JWT generation in `src/integrations/database/local-auth.server.ts`.
- **Middleware**:
  - Client: `attachAuth` attaches Bearer token from localStorage to all server function requests.
  - Server: `requireAuth` validates the JWT token and injects the user context into server function handlers.
- **Migrations**: Automated startup runner in `src/integrations/database/migrate.ts` executing SQL migrations from the `migrations/` directory.
