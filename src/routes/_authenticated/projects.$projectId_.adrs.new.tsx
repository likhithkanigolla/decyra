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

  useEffect(() => {
    if (form.title.trim().length < 3 && form.context.trim().length < 5) {
      setSimilarAdrs([]);
      return;
    }
    const timer = setTimeout(() => {
      similarFn({ data: { title: form.title, context: form.context, project_id: projectId } })
        .then((res) => {
          setSimilarAdrs(res.slice(0, 3));
        })
        .catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [form.title, form.context, projectId, similarFn]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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

      <div className="mt-6">
        {similarAdrs.length > 0 && (
          <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
            <div className="flex items-center gap-2 font-semibold mb-2">
              <AlertTriangle className="h-4 w-4" /> Similar ADRs already exist
            </div>
            <p className="mb-2 opacity-90">Please review these existing decisions in this project to avoid duplicates:</p>
            <ul className="list-disc list-inside space-y-1">
              {similarAdrs.map((a: any) => (
                <li key={a.id}>
                  <Link to="/adrs/$adrId" params={{ adrId: a.id }} target="_blank" className="font-mono hover:underline text-primary font-medium">
                    {a.full_id}
                  </Link>
                  <span className="ml-1 text-muted-foreground">— {a.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
