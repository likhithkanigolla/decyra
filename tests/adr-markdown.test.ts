import { describe, it, expect } from "vitest";
import {
  generateAdrMarkdown,
  parseAdrMarkdown,
  extractAdrIdentifier,
  inspectAdrIdentifier,
} from "@/lib/adr-markdown";

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
    expect(md).toContain(
      "## Context\n\nWe need an independent local setup without cloud dependencies.",
    );
    expect(md).toContain(
      "## Decision\n\nRun local PostgreSQL via docker compose and custom adapter.",
    );
    expect(md).toContain("## Design Changes");
    expect(md).toContain("### API Changes\n\nAdded Postgres server functions.");
    expect(md).toContain("## Major Impacts");
    expect(md).toContain(
      "### Operational Impact\n\nZero external network dependency for local testing.",
    );
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

  describe("extractAdrIdentifier & bracketed title handling", () => {
    it("extracts clean title when H1 has [ProjectCode-ADR-XXX] format", () => {
      const parsed = parseAdrMarkdown(
        "# [DEC-ADR-001]: Choose PostgreSQL Database\n\n## Context\nContext text\n\n## Decision\nDecision text\n\n## Consequences\nConsequences text",
      );
      expect(parsed.title).toBe("Choose PostgreSQL Database");
    });

    it("extracts ADR identifier when format is in H1 with brackets", () => {
      const id = extractAdrIdentifier(
        "0001.md",
        "# [DEC-ADR-001]: Choose PostgreSQL Database\n\n## Context\nContext",
        "DEC",
      );
      expect(id).toEqual({
        projectCode: "DEC",
        adrNumber: 1,
        fullId: "DEC-ADR-001",
        cleanTitle: "Choose PostgreSQL Database",
      });
    });

    it("extracts ADR identifier when format is in H1 without brackets", () => {
      const id = extractAdrIdentifier(
        "0002.md",
        "# DEC-ADR-002: Switch to React 19\n\n## Context\nContext",
        "DEC",
      );
      expect(id).toEqual({
        projectCode: "DEC",
        adrNumber: 2,
        fullId: "DEC-ADR-002",
        cleanTitle: "Switch to React 19",
      });
    });

    it("extracts ADR identifier when format is in filename with brackets", () => {
      const id = extractAdrIdentifier(
        "[DEC-ADR-003].md",
        "# Setup Docker Environment\n\n## Context\nContext",
        "DEC",
      );
      expect(id).toEqual({
        projectCode: "DEC",
        adrNumber: 3,
        fullId: "DEC-ADR-003",
        cleanTitle: "Setup Docker Environment",
      });
    });

    it("extracts ADR identifier when format is in filename without brackets", () => {
      const id = extractAdrIdentifier(
        "dec-adr-004-redis-cache.md",
        "# Setup Redis Cache\n\n## Context\nContext",
        "DEC",
      );
      expect(id).toEqual({
        projectCode: "DEC",
        adrNumber: 4,
        fullId: "DEC-ADR-004",
        cleanTitle: "Setup Redis Cache",
      });
    });

    it("rejects non-ADR files such as README.md", () => {
      const id = extractAdrIdentifier(
        "README.md",
        "# My Project\n\n## Context\nSome readme content",
        "DEC",
      );
      expect(id).toBeNull();
    });

    it("rejects ADR files belonging to another project code", () => {
      const id = extractAdrIdentifier(
        "0001.md",
        "# [OTHER-ADR-001]: Another Project ADR\n\n## Context\nContext",
        "DEC",
      );
      expect(id).toBeNull();
    });

    it("handles lowercase filenames and strips Title: prefix correctly", () => {
      const id = extractAdrIdentifier(
        "dm-adr-004.md",
        "# DM-ADR-004: Title: Tenant Registration API Migration\n\n## Context\nContext",
        "DM",
      );
      expect(id).toEqual({
        projectCode: "DM",
        adrNumber: 4,
        fullId: "DM-ADR-004",
        cleanTitle: "Tenant Registration API Migration",
      });
    });

    it("prioritizes filename over stale body H1 and cleans title", () => {
      const id = extractAdrIdentifier(
        "dm-adr-003.md",
        "# DM-ADR-001: Adopt Event-Driven Architecture\n\n## Context\nContext",
        "DM",
      );
      expect(id).toEqual({
        projectCode: "DM",
        adrNumber: 3,
        fullId: "DM-ADR-003",
        cleanTitle: "Adopt Event-Driven Architecture",
      });
    });

    it("provides human-readable reasons in inspectAdrIdentifier", () => {
      const inspectFail1 = inspectAdrIdentifier("README.md", "# Documentation", "DM");
      expect(inspectFail1.success).toBe(false);
      if (!inspectFail1.success) {
        expect(inspectFail1.reason).toContain("Not an ADR file");
      }

      const inspectFail2 = inspectAdrIdentifier("tad-adr-001.md", "# TAD-ADR-001: Migration", "DM");
      expect(inspectFail2.success).toBe(false);
      if (!inspectFail2.success) {
        expect(inspectFail2.reason).toContain("does not match current project 'DM'");
      }

      const inspectSuccess = inspectAdrIdentifier("dm-adr-002.md", "# DM-ADR-002: Kafka", "DM");
      expect(inspectSuccess.success).toBe(true);
    });
  });
});
