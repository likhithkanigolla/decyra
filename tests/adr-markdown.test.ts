import { describe, it, expect } from "vitest";
import { generateAdrMarkdown, parseAdrMarkdown } from "@/lib/adr-markdown";

describe("adr-markdown", () => {
  const sampleAdr = {
    full_id: "DEC-001",
    title: "Use PostgreSQL for Local Mode",
    status: "accepted",
    tags: ["database", "postgres", "architecture"],
    context: "We need an independent local setup without cloud dependencies.",
    decision: "Run local PostgreSQL via docker compose and custom adapter.",
    consequences: "Simpler offline development and automated CI testing.",
    alternatives: "SQLite was considered but lacks JSON operators parity.",
    design_changes: {
      api_changes: "Added Postgres server functions.",
      workflow_changes: "Developers run docker compose up.",
      service_changes: "Direct pg pool instead of HTTP client.",
      infrastructure_changes: "Postgres 18 alpine container.",
      data_model_changes: "Local users and auth compat shim.",
    },
    major_impacts: {
      operational: "Zero external network dependency for local testing.",
      testing: "Fast integration tests.",
      security: "Encrypted passwords with PBKDF2.",
      documentation: "Updated readme setup instructions.",
      scalability: "Connection pooling limits concurrency.",
    },
    references_data: {
      pull_requests: ["https://github.com/org/repo/pull/1"],
      git_commits: ["abc1234"],
      design_docs: ["https://docs.example.com/adr-001"],
      wiki_pages: ["https://wiki.example.com/architecture"],
      external: ["https://postgresql.org"],
    },
  };

  it("generates markdown document from ADR data", () => {
    const md = generateAdrMarkdown(sampleAdr);

    expect(md).toContain("# DEC-001: Use PostgreSQL for Local Mode");
    expect(md).toContain("**Status:** accepted");
    expect(md).toContain("**Tags:** database, postgres, architecture");
    expect(md).toContain("## Context\n\nWe need an independent local setup without cloud dependencies.");
    expect(md).toContain("## Decision\n\nRun local PostgreSQL via docker compose and custom adapter.");
    expect(md).toContain("## Design Changes");
    expect(md).toContain("### API Changes\n\nAdded Postgres server functions.");
    expect(md).toContain("## Major Impacts");
    expect(md).toContain("### Operational Impact\n\nZero external network dependency for local testing.");
    expect(md).toContain("## References");
    expect(md).toContain("- https://github.com/org/repo/pull/1");
  });

  it("handles minimal ADR data without crashing", () => {
    const minimal = {
      full_id: "MIN-001",
      title: "Minimal Title",
      status: "draft",
    };
    const md = generateAdrMarkdown(minimal);
    expect(md).toContain("# MIN-001: Minimal Title");
    expect(md).toContain("**Status:** draft");
  });

  it("parses generated markdown back into structured ADR data", () => {
    const md = generateAdrMarkdown(sampleAdr);
    const parsed = parseAdrMarkdown(md);

    expect(parsed.title).toBe("Use PostgreSQL for Local Mode");
    expect(parsed.tags).toEqual(["database", "postgres", "architecture"]);
    expect(parsed.context).toBe(sampleAdr.context);
    expect(parsed.decision).toBe(sampleAdr.decision);
    expect(parsed.consequences).toBe(sampleAdr.consequences);
    expect(parsed.alternatives).toBe(sampleAdr.alternatives);
    expect(parsed.design_changes.api_changes).toBe(sampleAdr.design_changes.api_changes);
    expect(parsed.design_changes.workflow_changes).toBe(sampleAdr.design_changes.workflow_changes);
    expect(parsed.major_impacts.operational).toBe(sampleAdr.major_impacts.operational);
    expect(parsed.major_impacts.security).toBe(sampleAdr.major_impacts.security);
    expect(parsed.references_data.pull_requests).toEqual(sampleAdr.references_data.pull_requests);
    expect(parsed.references_data.git_commits).toEqual(sampleAdr.references_data.git_commits);
  });

  it("returns default empty structure when parsing empty or whitespace markdown", () => {
    const parsed = parseAdrMarkdown("   \n\n  ");
    expect(parsed.title).toBe("");
    expect(parsed.tags).toEqual([]);
    expect(parsed.context).toBe("");
    expect(parsed.decision).toBe("");
    expect(parsed.design_changes.api_changes).toBe("");
    expect(parsed.references_data.pull_requests).toEqual([]);
  });
});
