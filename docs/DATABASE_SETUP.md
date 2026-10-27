# Database Setup Guide

Decyra runs on native **PostgreSQL 18** using Docker or an external PostgreSQL instance.

## Quick Start

1. **Start PostgreSQL with Docker:**
   ```bash
   npm run db:setup
   ```
   
   This will:
   - Start the PostgreSQL container (port 5432)
   - Apply database migrations from `/migrations`

2. **Access your database:**
   - Connection string: `postgresql://postgres:postgres@localhost:5432/decyra`

3. **Stop containers when done:**
   ```bash
   npm run db:stop
   ```

## Environment Variables

Configure your database credentials in `.env`:

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/decyra
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=decyra
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_JWT_SECRET=your-secret-key-change-in-production
```

## Running Migrations

Migrations are stored in the `/migrations` directory and are automatically applied on server startup.

To run migrations manually:
```bash
npm run db:migrate
```

## Creating the First Admin

Run the interactive admin bootstrap script:
```bash
npm run create-admin
```
