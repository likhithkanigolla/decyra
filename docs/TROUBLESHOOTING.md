# Troubleshooting Guide

## Common Issues and Solutions

### 1. PostgreSQL Container Won't Start

**Problem**: `docker-compose up` fails or container exits immediately

**Solutions**:
```bash
# Check container status
docker-compose ps

# View detailed logs
docker-compose logs postgres

# Rebuild containers
docker-compose down -v
npm run db:setup

# Check if port is in use
lsof -i :5432
```

**If port is in use**:
```bash
# Kill process using port 5432
sudo lsof -ti:5432 | xargs kill -9

# Or change port in .env
POSTGRES_PORT=5433
```

---

### 2. Connection Refused Error

**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Solutions**:
```bash
# Ensure containers are running
docker-compose ps

# Start if not running
docker-compose up -d postgres

# Wait a few seconds for PostgreSQL to initialize
sleep 5

# Test connection
docker-compose exec postgres pg_isready -U postgres
```

---

### 3. "Database Does Not Exist" Error

**Problem**: `ERROR: database "decyra" does not exist`

**Solutions**:
```bash
# Create database manually
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE decyra;"

# Or reset everything
npm run db:reset
```

---

### 4. pgAdmin Can't Connect to Database

**Problem**: Connection error in pgAdmin UI

**Solutions**:

1. In pgAdmin, add new server with:
   - **Name**: decyra
   - **Host name/address**: `postgres` (not localhost!)
   - **Port**: `5432`
   - **Username**: `postgres`
   - **Password**: `postgres`

2. If still failing:
   ```bash
   # Check if postgres container is running on pgAdmin's network
   docker-compose logs
   docker network ls
   docker network inspect <network_name>
   ```

---

### 5. Migrations Not Applying

**Problem**: SQL migrations in `migrations/` not being applied

**Solutions**:

```bash
# View migration status
docker compose exec postgres psql -U postgres -d decyra -c "SELECT * FROM migrations;"

# Run migrations using the migration script
npm run db:migrate
```

---

### 6. "DATABASE_TYPE Not Set" Error

**Problem**: `Error: Missing database configuration`

**Solutions**:
```bash
# Check .env file exists
ls -la .env

# Ensure DATABASE_TYPE is set
grep DATABASE_TYPE .env

# If missing, set it
echo "DATABASE_TYPE=postgres" >> .env

# Or create from example
cp .env.example .env
```

---

### 7. Authentication or JWT Errors

**Problem**: JWT token verification fails or 401 Unauthorized

**Solutions**:

```bash
# Verify POSTGRES_JWT_SECRET is set in .env
grep POSTGRES_JWT_SECRET .env

# If password was forgotten, reset it via CLI:
npm run reset-password <email-or-username> <new-password>
```

---

### 8. Port Conflicts

**Problem**: "Port already in use" error

**Solutions**:

For PostgreSQL (5432):
```bash
lsof -i :5432
sudo lsof -ti:5432 | xargs kill -9
```

For pgAdmin (5050):
```bash
lsof -i :5050
sudo lsof -ti:5050 | xargs kill -9
```

Or change in `.env` or `docker-compose.yml`:
```env
POSTGRES_PORT=5433
PGADMIN_PORT=5051
```

---

### 9. Volume Permission Issues

**Problem**: `permission denied` when writing to database

**Solutions**:
```bash
# Fix permissions
sudo chown -R 999:999 postgres_data/

# Or reset with proper permissions
docker-compose down -v
npm run db:setup
```

---

### 10. Container Out of Memory

**Problem**: Database queries are slow or containers crash

**Solutions**:

1. **Increase Docker resources**:
   - Docker Desktop: Settings → Resources → Memory

2. **Check running processes**:
   ```bash
   docker stats
   ```

3. **Clear cache and restart**:
   ```bash
   docker-compose down -v
   npm run db:setup
   ```

---

### 11. TypeScript "Cannot Find Module" Error

**Problem**: `Cannot find module '@/integrations/database/postgres'`

**Solutions**:

```bash
# Install dependencies
npm install

# Ensure pg and @types/pg are installed
npm list pg
npm list @types/pg

# If missing, install them
npm install pg @types/pg
```

---

### 12. Data Lost After Reset

**Problem**: Running `npm run db:reset` deleted all data

**Solutions**:

This is expected behavior because `db:reset` cleans volumes. To avoid data loss:

1. **Use backups**:
   ```bash
   # Backup PostgreSQL
   docker compose exec postgres pg_dump -U postgres decyra > backup.sql
   
   # Restore from backup
   docker compose exec postgres psql -U postgres decyra < backup.sql
   ```

2. **Don't use `db:reset` in production**

---

### 13. Docker Daemon Not Running

**Problem**: `Cannot connect to Docker daemon`

**Solutions**:
```bash
# Start Docker Desktop (macOS)
open /Applications/Docker.app

# Or on Linux
sudo systemctl start docker

# Verify Docker is running
docker ps
```

---

### 14. Slow Performance on M1/M2 Mac

**Problem**: Docker containers are very slow on Apple Silicon

**Solutions**:

1. **Use native PostgreSQL** instead of Docker:
   ```bash
   brew install postgresql
   brew services start postgresql
   createdb decyra
   ```

2. **Or use Rosetta**:
   ```yaml
   # In docker-compose.yml
   services:
     postgres:
       platform: linux/amd64
   ```

3. **Increase Docker resources**:
   - Docker Desktop → Settings → Resources → Increase Memory

---

## Getting More Help

1. **Check logs**:
   ```bash
   docker compose logs -f postgres
   ```

2. **Enter database directly**:
   ```bash
   docker compose exec postgres psql -U postgres -d decyra
   ```

3. **Check PostgreSQL status**:
   ```bash
   docker compose exec postgres pg_isready -U postgres
   ```

4. **View all Docker containers**:
   ```bash
   docker ps -a
   docker compose ps
   ```

5. **Environmental debugging**:
   ```bash
   # Check environment variables
   env | grep DATABASE
   env | grep POSTGRES
   ```

---

## Still Stuck?

1. Check [DATABASE_SETUP.md](./DATABASE_SETUP.md)
2. Review [EXAMPLES.md](./src/integrations/database/EXAMPLES.md)
3. Check [config.ts](./src/integrations/database/config.ts)
4. View [docker-compose.yml](./docker-compose.yml)
