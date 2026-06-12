import { createFileRoute, Link } from "@tanstack/react-router";
import { GitBranch, Workflow, ShieldCheck, Network } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Decyra — Architecture Decision Records, governed" },
      { name: "description", content: "Decyra is the governance layer for your ADRs: review, approve, and publish architecture decisions with full traceability." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground font-bold">D</div>
            <span className="font-semibold tracking-tight">Decyra</span>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/app" className="text-muted-foreground hover:text-foreground">Open app</Link>
            <Link to="/auth" className="inline-flex h-9 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground hover:opacity-90">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-20 pb-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Architecture Governance Platform
          </div>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight md:text-6xl">
            Architecture decisions,<br />
            <span className="text-primary">governed and traceable.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Decyra is the governance layer on top of your ADR repositories. Author, review,
            approve, and publish architecture decisions across every project — with immutable
            published versions and a complete approval trail.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/auth" className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90">Get started</Link>
            <Link to="/app" className="inline-flex h-11 items-center rounded-md border border-border bg-card px-5 text-sm font-medium hover:bg-accent">Open dashboard</Link>
          </div>
        </div>

        <div className="mt-24 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Workflow, title: "Structured ADRs", desc: "Context, decision, consequences, alternatives, design changes & impacts in one form." },
            { icon: ShieldCheck, title: "Approval workflow", desc: "Configurable rules per project. Interns submit, engineers review, project admins publish." },
            { icon: GitBranch, title: "Git-backed publishing", desc: "Published versions are immutable snapshots, ready to commit to your repository." },
            { icon: Network, title: "Relationship graph", desc: "Trace supersedes, depends-on and conflicts across every decision." },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
