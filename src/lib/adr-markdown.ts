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
