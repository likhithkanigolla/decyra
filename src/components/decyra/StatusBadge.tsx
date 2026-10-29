const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  under_review: "bg-info/15 text-info border border-info/30",
  approved: "bg-success/15 text-success border border-success/30",
  published: "bg-primary/15 text-primary border border-primary/30",
  superseded: "bg-warning/15 text-warning border border-warning/30",
  rejected: "bg-destructive/15 text-destructive border border-destructive/30",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  published: "Published",
  superseded: "Superseded",
  rejected: "Rejected",
};

export function StatusBadge({
  status,
  currentVersion,
  userReviewDecision,
  className = "",
}: {
  status: string;
  currentVersion?: number;
  userReviewDecision?: "approve" | "request_changes" | null;
  className?: string;
}) {
  const isPublished = (currentVersion ?? 0) > 0 || status === "published";

  let label = LABELS[status] ?? status;
  let style = STATUS_STYLES[status] ?? "bg-muted text-muted-foreground";

  if (isPublished) {
    if (status === "rejected") {
      label = "Published | Rejected";
      style = "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30";
    } else {
      label = "Published | Approved";
      style = "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30";
    }
  } else {
    if (status === "approved") {
      label = "Approved (Unpublished)";
    } else if (status === "rejected") {
      label = "Rejected (Unpublished)";
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style} ${className}`}>
        {label}
      </span>
      {status === "under_review" && userReviewDecision && (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            userReviewDecision === "approve"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
          }`}
        >
          {userReviewDecision === "approve" ? "✓ You approved" : "✗ You requested changes"}
        </span>
      )}
    </div>
  );
}
