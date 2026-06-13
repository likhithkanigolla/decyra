import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createAdr, findSimilarAdrs } from "@/lib/api/decyra.functions";
import { AdrForm, DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId_/adrs/new")({
  head: () => ({ meta: [{ title: "New ADR — Decyra" }] }),
  component: NewAdr,
});

function NewAdr() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const createAdrFn = useServerFn(createAdr);
  const similarFn = useServerFn(findSimilarAdrs);

  const [form, setForm] = useState<AdrFormData>(DEFAULT_ADR_FORM);
  const [busy, setBusy] = useState(false);
  const [similarAdrs, setSimilarAdrs] = useState<any[]>([]);

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
      toast.success("ADR created as draft");
      // Navigate to the new ADR
      const adrId = (adr as any)?.id ?? (adr as any)?.adr?.id;
      if (adrId) {
        navigate({ to: "/adrs/$adrId", params: { adrId } });
      } else {
        navigate({ to: "/projects/$projectId", params: { projectId } });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create ADR");
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

      <h1 className="text-2xl font-semibold tracking-tight">New Architecture Decision Record</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Document an architectural decision. Fill in as much detail as you have — you can edit it later.
      </p>

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
