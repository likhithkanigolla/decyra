/**
 * Generates Markdown from an ADR object.
 * Used when publishing an ADR — the markdown is stored and committed to Git.
 */

export function generateAdrMarkdown(adr: any): string {
  const dc = adr.design_changes ?? {};
  const mi = adr.major_impacts ?? {};
  const refs = adr.references_data ?? {};
  const date = new Date().toISOString().split("T")[0];

  const section = (title: string, body: string) =>
    body?.trim() ? `\n## ${title}\n\n${body.trim()}\n` : "";

  const subsection = (title: string, body: string) =>
    body?.trim() ? `\n### ${title}\n\n${body.trim()}\n` : "";

  const refList = (title: string, items: string[]) =>
    items?.length ? `\n### ${title}\n\n${items.map((r) => `- ${r}`).join("\n")}\n` : "";

  const designSection = [
    subsection("API Changes", dc.api_changes),
    subsection("Workflow Changes", dc.workflow_changes),
    subsection("Service Changes", dc.service_changes),
    subsection("Infrastructure Changes", dc.infrastructure_changes),
    subsection("Data Model Changes", dc.data_model_changes),
  ].join("");

  const impactsSection = [
    subsection("Operational Impact", mi.operational),
    subsection("Testing Impact", mi.testing),
    subsection("Security Impact", mi.security),
    subsection("Documentation Impact", mi.documentation),
    subsection("Scalability Impact", mi.scalability),
  ].join("");

  const refsSection = [
    refList("Pull Requests", refs.pull_requests),
    refList("Git Commits", refs.git_commits),
    refList("Design Documents", refs.design_docs),
    refList("Wiki Pages", refs.wiki_pages),
    refList("External References", refs.external),
  ].join("");

  const tags = (adr.tags ?? []).length ? `\n**Tags:** ${(adr.tags as string[]).join(", ")}\n` : "";

  let md = `# ${adr.full_id}: ${adr.title}\n`;
  md += `\n**Status:** ${adr.status}\n`;
  md += `**Date:** ${date}\n`;
  md += tags;
  md += section("Context", adr.context);
  md += section("Decision", adr.decision);
  md += section("Consequences", adr.consequences);
  md += section("Alternatives Considered", adr.alternatives);
  if (designSection.trim()) md += `\n## Design Changes\n${designSection}`;
  if (impactsSection.trim()) md += `\n## Major Impacts\n${impactsSection}`;
  if (refsSection.trim()) md += `\n## References\n${refsSection}`;

  return md;
}

function normalizeSectionKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function extractMarkdownSection(markdown: string, heading: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let active: string | null = null;
  const buffer: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (active && normalizeSectionKey(active) === normalizeSectionKey(heading)) {
        return buffer.join("\n").trim();
      }
      active = match[1].trim();
      buffer.length = 0;
      continue;
    }

    if (active && normalizeSectionKey(active) === normalizeSectionKey(heading)) {
      buffer.push(line);
    }
  }

  if (active && normalizeSectionKey(active) === normalizeSectionKey(heading)) {
    return buffer.join("\n").trim();
  }

  return "";
}

function extractSubsectionValues(body: string, mapping: Record<string, string>) {
  const result: Record<string, string> = {};
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let active: string | null = null;
  const buffer: string[] = [];

  for (const line of lines) {
    const match = line.match(/^###\s+(.+?)\s*$/);
    if (match) {
      if (active) {
        const normalized = normalizeSectionKey(active);
        result[mapping[normalized] ?? normalized] = buffer.join("\n").trim();
      }
      active = match[1].trim();
      buffer.length = 0;
      continue;
    }

    if (active) {
      buffer.push(line);
    }
  }

  if (active) {
    const normalized = normalizeSectionKey(active);
    result[mapping[normalized] ?? normalized] = buffer.join("\n").trim();
  }

  return result;
}

function extractReferenceListSection(markdown: string, heading: string) {
  const section = extractMarkdownSection(markdown, heading);
  const groups: Record<string, string[]> = {};
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  let active: string | null = null;
  const buffer: string[] = [];

  for (const line of lines) {
    const match = line.match(/^###\s+(.+?)\s*$/);
    if (match) {
      if (active) {
        const items = buffer
          .map((item) => item.trim())
          .filter((item) => item.startsWith("- ") || item.startsWith("* "))
          .map((item) => item.replace(/^[-*]\s*/, "").trim())
          .filter(Boolean);
        if (items.length) {
          groups[normalizeSectionKey(active)] = items;
        }
      }
      active = match[1].trim();
      buffer.length = 0;
      continue;
    }

    if (active) {
      buffer.push(line);
    }
  }

  if (active) {
    const items = buffer
      .map((item) => item.trim())
      .filter((item) => item.startsWith("- ") || item.startsWith("* "))
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    if (items.length) {
      groups[normalizeSectionKey(active)] = items;
    }
  }

  return groups;
}

export function parseAdrMarkdown(markdown: string) {
  const content = markdown.replace(/\r\n/g, "\n").trim();
  if (!content) {
    return {
      title: "",
      tags: [],
      context: "",
      decision: "",
      consequences: "",
      alternatives: "",
      design_changes: {
        api_changes: "",
        workflow_changes: "",
        service_changes: "",
        infrastructure_changes: "",
        data_model_changes: "",
      },
      major_impacts: {
        operational: "",
        testing: "",
        security: "",
        documentation: "",
        scalability: "",
      },
      references_data: {
        pull_requests: [],
        git_commits: [],
        design_docs: [],
        wiki_pages: [],
        external: [],
      },
    };
  }

  const titleMatch = content.match(/^#\s+(.+?)\s*$/m);
  const tagsMatch = content.match(/\*\*Tags:\*\*\s*([^\n]+)/i);
  const tags = (tagsMatch?.[1] ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const designValues = extractSubsectionValues(extractMarkdownSection(content, "Design Changes"), {
    api_changes: "api_changes",
    workflow_changes: "workflow_changes",
    service_changes: "service_changes",
    infrastructure_changes: "infrastructure_changes",
    data_model_changes: "data_model_changes",
  });

  const impactValues = extractSubsectionValues(extractMarkdownSection(content, "Major Impacts"), {
    operational_impact: "operational",
    testing_impact: "testing",
    security_impact: "security",
    documentation_impact: "documentation",
    scalability_impact: "scalability",
  });

  const referenceValues = extractReferenceListSection(content, "References");

  return {
    title:
      titleMatch?.[1]
        ?.replace(/^(?:\[[^\]]+\]\s*-\s*|\[[^\]]+\]\s*|[A-Z0-9-]+\s*-\s*)?ADR-\d+:\s*/i, "")
        ?.trim() ?? "",
    tags,
    context: extractMarkdownSection(content, "Context"),
    decision: extractMarkdownSection(content, "Decision"),
    consequences: extractMarkdownSection(content, "Consequences"),
    alternatives: extractMarkdownSection(content, "Alternatives Considered"),
    design_changes: {
      api_changes: designValues.api_changes ?? "",
      workflow_changes: designValues.workflow_changes ?? "",
      service_changes: designValues.service_changes ?? "",
      infrastructure_changes: designValues.infrastructure_changes ?? "",
      data_model_changes: designValues.data_model_changes ?? "",
    },
    major_impacts: {
      operational: impactValues.operational ?? "",
      testing: impactValues.testing ?? "",
      security: impactValues.security ?? "",
      documentation: impactValues.documentation ?? "",
      scalability: impactValues.scalability ?? "",
    },
    references_data: {
      pull_requests: referenceValues.pull_requests ?? [],
      git_commits: referenceValues.git_commits ?? [],
      design_docs: referenceValues.design_documents ?? referenceValues.design_docs ?? [],
      wiki_pages: referenceValues.wiki_pages ?? [],
      external: referenceValues.external_references ?? referenceValues.external ?? [],
    },
  };
}
