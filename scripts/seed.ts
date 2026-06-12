#!/usr/bin/env tsx
/**
 * Decyra — Sample Data Seeder
 *
 * Creates the SCDT (Smart City Digital Twin Platform) project with 5 ADRs
 * and realistic relationships.
 *
 * Usage:
 *   npm run seed
 *   npm run seed -- --project-only   (create project but skip ADRs)
 *   npm run seed -- --reset           (drop and recreate SCDT data)
 */
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? "architecture_hub",
  user: process.env.POSTGRES_USER ?? "postgres",
  password: process.env.POSTGRES_PASSWORD ?? "postgres",
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function query(sql: string, params?: any[]) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const projectOnly = args.includes("--project-only");
  const reset = args.includes("--reset");

  console.log("🌱  Decyra Seeder starting…\n");

  // Check for an admin user
  const adminRow = await query(
    "SELECT lu.id FROM local_users lu JOIN user_roles ur ON ur.user_id = lu.id WHERE ur.role = 'admin' LIMIT 1"
  );
  if (!adminRow.rows.length) {
    console.error("❌  No admin user found. Run `npm run create-admin` first.\n");
    process.exit(1);
  }
  const adminId: string = adminRow.rows[0].id;
  console.log(`✅  Admin user: ${adminId}`);

  // Reset if requested
  if (reset) {
    const existing = await query("SELECT id FROM projects WHERE code = 'SCDT'");
    if (existing.rows.length) {
      await query("DELETE FROM projects WHERE code = 'SCDT'");
      console.log("🗑️   Removed existing SCDT project\n");
    }
  }

  // Check if SCDT already exists
  const existingProject = await query("SELECT id FROM projects WHERE code = 'SCDT'");
  let projectId: string;

  if (existingProject.rows.length) {
    projectId = existingProject.rows[0].id;
    console.log(`ℹ️   SCDT project already exists (${projectId})`);
  } else {
    // Create project
    const proj = await query(
      `INSERT INTO projects (name, code, description, repo_url, branch, adr_path, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        "Smart City Digital Twin Platform",
        "SCDT",
        "A digital twin platform for smart city infrastructure, connecting IoT sensors, simulation engines, and data analytics for real-time urban management.",
        "https://github.com/company/smart-city-platform",
        "main",
        "docs/adr/scdt",
        adminId,
      ]
    );
    projectId = proj.rows[0].id;
    console.log(`✅  Created SCDT project: ${projectId}`);

    // Add admin as project_admin
    await query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'project_admin') ON CONFLICT DO NOTHING",
      [projectId, adminId]
    );
    console.log("✅  Added admin as project_admin");
  }

  if (projectOnly) {
    console.log("\n🌱  Done (--project-only mode)");
    await pool.end(); return;
  }

  // ── ADRs ──────────────────────────────────────────────────────────────────

  const adrs: Record<string, string> = {};

  async function createAdr(data: {
    title: string; context: string; decision: string;
    consequences: string; alternatives?: string; tags: string[];
    status?: string;
  }) {
    const existing = await query(
      "SELECT id, full_id FROM adrs WHERE project_id = $1 AND title = $2",
      [projectId, data.title]
    );
    if (existing.rows.length) {
      console.log(`  ⏭️   Skipping (exists): ${existing.rows[0].full_id}`);
      return existing.rows[0].id as string;
    }
    const row = await query(
      `INSERT INTO adrs (project_id, title, tags, context, decision, consequences, alternatives, author_id, status)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9::adr_status)
       RETURNING id, full_id`,
      [
        projectId, data.title, data.tags,
        data.context, data.decision, data.consequences,
        data.alternatives ?? "", adminId,
        data.status ?? "published",
      ]
    );
    const { id, full_id } = row.rows[0];
    console.log(`  ✅  ${full_id}: ${data.title}`);

    // If published, add a published_version record
    if ((data.status ?? "published") === "published") {
      await query(
        `INSERT INTO published_versions (adr_id, version_number, markdown, published_by)
         VALUES ($1, 1, $2, $3)`,
        [id, `# ${full_id}: ${data.title}\n\n## Context\n\n${data.context}\n\n## Decision\n\n${data.decision}\n\n## Consequences\n\n${data.consequences}`, adminId]
      );
    }

    return id as string;
  }

  console.log("\n📝  Creating sample ADRs…");

  adrs["adr001"] = await createAdr({
    title: "Adopt oneM2M for IoT Interoperability",
    tags: ["iot", "interoperability", "standards", "onem2m"],
    context: "The Smart City Digital Twin Platform integrates with hundreds of IoT devices from multiple vendors. Without a standard protocol, each integration requires custom adapters, creating vendor lock-in and significant maintenance overhead. We need a unified IoT communication standard.",
    decision: "We will adopt the **oneM2M** standard as the primary IoT communication protocol across all platform components. All IoT device integrations must expose a oneM2M-compatible interface. The platform will provide a oneM2M Resource Abstraction Layer (RAL) that translates device-specific protocols to oneM2M resources.",
    consequences: "**Positive:** Vendor-agnostic IoT integration, standardized data models, cross-platform interoperability, large ecosystem support.\n\n**Negative:** Learning curve for the team, some legacy devices may require protocol bridges.\n\n**Neutral:** Existing Zigbee/MQTT adapters must be refactored to expose oneM2M interfaces.",
    alternatives: "**MQTT only:** Simple but no standardized data model, leading to fragmented data schemas.\n\n**LwM2M:** Suitable for constrained devices but lacks the resource model richness of oneM2M.\n\n**Proprietary API:** Fast to implement initially but creates long-term vendor lock-in.",
    status: "published",
  });

  adrs["adr002"] = await createAdr({
    title: "Use PostgreSQL for Metadata Storage",
    tags: ["database", "postgresql", "storage", "metadata"],
    context: "The platform needs to store and query large volumes of structured metadata: device registrations, sensor configurations, spatial data, time-series aggregations, and digital twin state. We need a database that supports JSON, geospatial queries, and high write throughput.",
    decision: "We will use **PostgreSQL 15+** as the primary metadata store. The PostGIS extension will handle geospatial queries. TimescaleDB extension will handle time-series hypertables for sensor readings. We will NOT use PostgreSQL for raw real-time streaming — that goes through Kafka.",
    consequences: "**Positive:** Mature ACID compliance, excellent JSON/JSONB support, PostGIS for spatial queries, strong ecosystem.\n\n**Negative:** Horizontal scaling requires careful sharding strategy at scale. Vertical scaling has limits.\n\n**Follow-up:** Define a read replica strategy for analytics queries.",
    alternatives: "**MongoDB:** Better horizontal scaling but weaker ACID guarantees and geospatial support.\n\n**ClickHouse:** Excellent for analytics but poor for transactional metadata.\n\n**CockroachDB:** Distributed but added operational complexity for our scale.",
    status: "published",
  });

  adrs["adr003"] = await createAdr({
    title: "Introduce Redis Caching Layer",
    tags: ["caching", "redis", "performance", "infrastructure"],
    context: "Digital twin state queries are showing P95 latencies of 800ms+ under load. Analysis shows 70% of queries are for the same 500 active twins, which have state that changes at most every 10 seconds. We need a caching strategy to reduce database load and improve response times.",
    decision: "Introduce **Redis 7.x** as a distributed cache. All digital twin state reads will check Redis first (cache-aside pattern) with a 30-second TTL. State write operations will invalidate the cache entry. Redis Cluster mode will be used for HA. We will NOT cache spatial queries or user-specific filtered results.",
    consequences: "**Positive:** Expected P95 latency reduction from 800ms to <50ms for cached queries. Significant reduction in PostgreSQL read load.\n\n**Negative:** Cache invalidation complexity. Additional operational overhead. Introduces eventual consistency risk for reads during the 30s TTL window.\n\n**Follow-up:** Implement cache warming on deployment.",
    alternatives: "**CDN edge caching:** Not suitable for dynamic, user-context-sensitive data.\n\n**Application-level in-memory cache:** Works per-instance but not distributed — ineffective in multi-pod deployment.\n\n**PostgreSQL materialized views:** Lower latency than raw queries but 5-10s refresh lag.",
    status: "published",
  });

  adrs["adr004"] = await createAdr({
    title: "Migrate to Microservices Architecture",
    tags: ["architecture", "microservices", "migration", "scalability"],
    context: "The current monolithic platform is experiencing deployment bottlenecks — a change to the IoT adapter layer requires full platform deployment. Teams are stepping on each other's changes. Build times exceed 45 minutes. We need to decompose for independent deployability and team autonomy.",
    decision: "Decompose the monolith into the following bounded contexts: (1) **IoT Gateway Service** — device registration & protocol translation, (2) **Twin Engine Service** — digital twin state management, (3) **Analytics Service** — aggregations & reporting, (4) **Notification Service** — alerts & webhooks, (5) **API Gateway** — auth & routing. Services communicate via Kafka for events and gRPC for synchronous queries.",
    consequences: "**Positive:** Independent deployability, team autonomy, targeted scaling, faster builds per service.\n\n**Negative:** Distributed systems complexity, network latency between services, eventual consistency to manage, increased operational overhead (12-factor apps, observability).\n\n**Critical follow-up:** Implement distributed tracing (Jaeger/OpenTelemetry) before going to production.",
    alternatives: "**Modular monolith:** Maintain a single deployable but enforce module boundaries. Lower operational cost but doesn't solve team scaling.\n\n**Service-oriented architecture (SOA):** Similar decomposition but heavier ESB-based communication. Rejected due to vendor lock-in.",
    status: "approved",
  });

  adrs["adr005"] = await createAdr({
    title: "Use PyDEVS for Simulation Engine",
    tags: ["simulation", "pydevs", "digital-twin", "python"],
    context: "The digital twin platform requires a simulation engine capable of running discrete-event simulations of urban infrastructure systems (traffic, energy grids, water networks). The engine must support real-time coupling with live sensor data and provide a Python-friendly API for city planners.",
    decision: "We will use **PyDEVS** (Python Discrete EVent System Specification) as the simulation framework. Simulations are defined as DEVS atomic/coupled models. The Twin Engine Service will manage simulation lifecycle. Real-time sensor data feeds are injected via a dedicated Input Port Manager that maps oneM2M resource updates to DEVS input events.",
    consequences: "**Positive:** Formal DEVS theory provides mathematically rigorous simulation semantics. Python ecosystem access (NumPy, SciPy). Well-suited for hierarchical city system modeling.\n\n**Negative:** Python performance limitations for very large-scale simulations. Limited horizontal scaling — simulations are stateful. Smaller community than alternatives.\n\n**Follow-up:** Evaluate PyDEVS-RT for real-time simulation coupling with live IoT streams.",
    alternatives: "**AnyLogic:** Commercial, good tooling but expensive licensing and limited customization.\n\n**SimPy:** Simpler API but purely process-oriented, doesn't match DEVS theoretical foundations required by the research team.\n\n**Custom C++ engine:** Maximum performance but 6-12 month build time.",
    status: "under_review",
  });

  // ── Relationships ──────────────────────────────────────────────────────────

  console.log("\n🔗  Creating relationships…");

  async function addRel(sourceKey: string, targetKey: string, relType: string) {
    const sourceId = adrs[sourceKey];
    const targetId = adrs[targetKey];
    if (!sourceId || !targetId) return;
    await query(
      `INSERT INTO adr_relationships (source_adr_id, target_adr_id, rel_type, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_adr_id, target_adr_id, rel_type) DO NOTHING`,
      [sourceId, targetId, relType, adminId]
    );
    console.log(`  ✅  ${sourceKey} --[${relType}]--> ${targetKey}`);
  }

  await addRel("adr003", "adr002", "depends_on");     // Redis depends on PostgreSQL (both in data layer)
  await addRel("adr004", "adr001", "affects");         // Microservices affects IoT integration
  await addRel("adr004", "adr002", "affects");         // Microservices affects storage
  await addRel("adr004", "adr003", "affects");         // Microservices affects caching
  await addRel("adr005", "adr001", "depends_on");      // Simulation depends on IoT standard
  await addRel("adr005", "adr004", "related_to");      // Simulation related to microservices

  console.log("\n✅  Seeding complete!\n");
  console.log(`   Project: Smart City Digital Twin Platform (SCDT)`);
  console.log(`   ADRs:    5 created (SCDT-ADR-001 through SCDT-ADR-005)`);
  console.log(`   Rels:    6 relationships\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Seeder failed:", err);
  process.exit(1);
});
