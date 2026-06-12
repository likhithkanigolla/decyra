const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  under_review: "bg-info/15 text-info border border-info/30",
  approved: "bg-success/15 text-success border border-success/30",
  published: "bg-primary/15 text-primary border border-primary/30",
  superseded: "bg-warning/15 text-warning border border-warning/30",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  published: "Published",
  superseded: "Superseded",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
