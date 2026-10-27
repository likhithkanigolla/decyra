# Local Development Guide

Decyra runs completely on **native PostgreSQL** with built-in JWT authentication.

## Quick Start (3 Steps)

### Step 1: Start PostgreSQL
```bash
npm run db:setup
```

This starts:
- PostgreSQL database on port 5432
- Automatically runs migrations from `/migrations`

### Step 2: Create Admin Account
```bash
npm run create-admin
```

Creates your initial administrator account.

### Step 3: Start Development Server
```bash
npm run dev
```

Visit the application at http://localhost:3000 (or http://localhost:5173).

## Authentication

Decyra uses self-contained JWT authentication:
- Password hashing using standard PBKDF2 (SHA-256)
- Signed HS256 tokens using `POSTGRES_JWT_SECRET`
- Recovery key generation for account recovery
- Admin CLI for password resets: `npm run reset-password <email> <newPassword>`

## Database Access

- Direct PostgreSQL connection: `postgresql://postgres:postgres@localhost:5432/decyra`
- Interactive CLI: `docker compose exec postgres psql -U postgres -d decyra`
