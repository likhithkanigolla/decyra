import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createAdr } from "@/lib/api/decyra.functions";
import { AdrForm, DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/projects/$projectId_/adrs/new")({
  head: () => ({ meta: [{ title: "New ADR — Decyra" }] }),
  component: NewAdr,
});

function NewAdr() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const createAdrFn = useServerFn(createAdr);

  const [form, setForm] = useState<AdrFormData>(DEFAULT_ADR_FORM);
  const [busy, setBusy] = useState(false);

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
        navigate({ to: "/app/adrs/$adrId", params: { adrId } });
      } else {
        navigate({ to: "/app/projects/$projectId", params: { projectId } });
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
        onClick={() => navigate({ to: "/app/projects/$projectId", params: { projectId } })}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to project
      </button>

      <h1 className="text-2xl font-semibold tracking-tight">New Architecture Decision Record</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Document an architectural decision. Fill in as much detail as you have — you can edit it later.
      </p>

      <div className="mt-6">
        <AdrForm
          form={form}
          setForm={setForm}
          busy={busy}
          onSubmit={handleSubmit}
          onCancel={() => navigate({ to: "/app/projects/$projectId", params: { projectId } })}
          submitLabel="Create draft"
        />
      </div>
    </div>
  );
}
