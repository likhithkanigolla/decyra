import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createAdr, findSimilarAdrs, getAdr, addAdrRelationship } from "@/lib/api/decyra.functions";
import { AdrForm, DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { getErrorMessage } from "@/lib/utils";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle, GitBranch } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId_/adrs/new")({
  validateSearch: (search: Record<string, unknown>): { supersedes?: string } => ({
    supersedes: typeof search.supersedes === "string" ? search.supersedes : undefined,
  }),
  head: () => ({ meta: [{ title: "New ADR — Decyra" }] }),
  component: NewAdr,
});

function NewAdr() {
  const { projectId } = Route.useParams();
  const { supersedes } = Route.useSearch();
  const navigate = useNavigate();
  const createAdrFn = useServerFn(createAdr);
  const similarFn = useServerFn(findSimilarAdrs);
  const getAdrFn = useServerFn(getAdr);
  const addRelFn = useServerFn(addAdrRelationship);

  const [form, setForm] = useState<AdrFormData>(DEFAULT_ADR_FORM);
  const [busy, setBusy] = useState(false);
  const [similarAdrs, setSimilarAdrs] = useState<any[]>([]);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [supersededAdr, setSupersededAdr] = useState<any>(null);

  useEffect(() => {
    if (supersedes) {
      getAdrFn({ data: { id: supersedes } })
        .then((res) => {
          if (res?.adr) {
            setSupersededAdr(res.adr);
            setForm((prev) => ({
              ...prev,
              context:
                prev.context && prev.context !== DEFAULT_ADR_FORM.context
                  ? prev.context
                  : `Supersedes ${res.adr.full_id} ("${res.adr.title}").\n\n`,
            }));
          }
        })
        .catch(console.error);
    }
  }, [supersedes, getAdrFn]);

  async function executeCreation() {
    setBusy(true);
    setShowSimilarModal(false);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const adr = await createAdrFn({
        data: {
          project_id: projectId,
          title: form.title,
          tags,
          context: form.context,
          decision: form.decision,
          consequences: form.consequences,
          alternatives: form.alternatives,
          design_changes: form.design_changes,
          major_impacts: form.major_impacts,
          references_data: form.references_data,
        },
      });
      const adrId = (adr as any)?.id ?? (adr as any)?.adr?.id;

      if (adrId && supersedes) {
        try {
          await addRelFn({
            data: {
              source_adr_id: adrId,
              target_adr_id: supersedes,
              rel_type: "supersedes",
            },
          });
        } catch (e) {
          console.error("Failed to link supersedes relationship:", e);
        }
      }

      toast.success(supersedes ? "Superseding ADR created" : "ADR created as draft");
      if (adrId) {
        navigate({ to: "/adrs/$adrId", params: { adrId } });
      } else {
        navigate({ to: "/projects/$projectId", params: { projectId } });
      }
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to create ADR"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Please enter an ADR title");
      return;
    }

    setBusy(true);
    try {
      // Check for genuinely similar ADRs only on submit
      const similar = await similarFn({
        data: {
          project_id: projectId,
          title: form.title,
          context: form.context,
          decision: form.decision,
        },
      });

      if (similar && similar.length > 0) {
        setSimilarAdrs(similar);
        setShowSimilarModal(true);
        setBusy(false);
        return;
      }
    } catch (err) {
      console.error("Similarity check error:", err);
    }

    await executeCreation();
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button
        onClick={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to project
      </button>

      <h1 className="text-2xl font-semibold tracking-tight">
        {supersededAdr ? `Supersede ${supersededAdr.full_id}` : "New Architecture Decision Record"}
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        {supersededAdr
          ? `Document a new decision that replaces ${supersededAdr.full_id} while preserving its historical record.`
          : "Document an architectural decision. Fill in as much detail as you have — you can edit it later."}
      </p>

      {supersededAdr && (
        <div className="mt-4 rounded-lg border border-primary/40 bg-primary/10 p-3.5 text-xs flex items-start gap-2.5">
          <GitBranch className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-foreground">
              Superseding {supersededAdr.full_id}: {supersededAdr.title}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              This new decision will be linked as superseding {supersededAdr.full_id}. When created, {supersededAdr.full_id} will transition to Superseded status.
            </p>
          </div>
        </div>
      )}

      {/* Similarity Confirmation Modal */}
      {showSimilarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-base">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>Similar Architectural Decisions Exist</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We found existing decision(s) in this project that share keywords or architectural scope with what you wrote. Please review them to avoid duplicate decisions:
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-2.5">
              {similarAdrs.map((a: any) => (
                <div key={a.id} className="p-2.5 rounded-md border border-border/60 bg-card hover:border-primary/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to="/adrs/$adrId"
                      params={{ adrId: a.id }}
                      target="_blank"
                      className="font-mono text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {a.full_id}
                    </Link>
                    {a.reason && (
                      <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                        {a.reason}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-medium text-foreground mt-0.5">{a.title}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => setShowSimilarModal(false)}
                className="h-8.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Review & Edit
              </button>
              <button
                type="button"
                onClick={executeCreation}
                disabled={busy}
                className="h-8.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy ? "Creating…" : "Proceed & Create Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6">
        <AdrForm
          form={form}
          setForm={setForm}
          busy={busy}
          onSubmit={handleSubmit}
          onCancel={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
          submitLabel="Create draft"
        />
      </div>
    </div>
  );
}
