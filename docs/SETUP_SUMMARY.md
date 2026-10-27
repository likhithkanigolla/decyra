# PostgreSQL Migration - Architecture Summary

## Overview

Decyra has transitioned to a 100% native PostgreSQL architecture:
- Supabase client libraries (`@supabase/supabase-js`) and directories have been completely removed.
- All database queries run via parameterized SQL queries with `pg`.
- Authentication is handled natively via HS256 JWTs with PBKDF2 password hashing.
- Migrations are stored in `/migrations` and automatically executed on startup.

## Architecture

- **PostgreSQL Client**: `src/integrations/database/postgres.ts`
- **Auth Middleware**: `src/integrations/database/auth-middleware.ts`
- **Auth Client Attacher**: `src/integrations/database/auth-attacher.ts`
- **Password & JWT Logic**: `src/integrations/database/local-auth.server.ts`
- **Migrations Engine**: `src/integrations/database/migrate.ts`
