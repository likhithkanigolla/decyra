import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAdr, updateAdr } from "@/lib/api/decyra.functions";
import { AdrForm, DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/adrs/$adrId_/edit")({
  head: () => ({ meta: [{ title: "Edit ADR — Decyra" }] }),
  component: EditAdr,
});

function EditAdr() {
  const { adrId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getAdrFn = useServerFn(getAdr);
  const updateAdrFn = useServerFn(updateAdr);

  const { data } = useQuery({
    queryKey: ["adr", adrId],
    queryFn: () => getAdrFn({ data: { id: adrId } }),
  });

  const [form, setForm] = useState<AdrFormData>(DEFAULT_ADR_FORM);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.adr && !initialized) {
      const a = data.adr;
      setForm({
        title: a.title ?? "",
        tags: (a.tags ?? []).join(", "),
        context: a.context ?? "",
        decision: a.decision ?? "",
        consequences: a.consequences ?? "",
        alternatives: a.alternatives ?? "",
        design_changes: a.design_changes ?? DEFAULT_ADR_FORM.design_changes,
        major_impacts: a.major_impacts ?? DEFAULT_ADR_FORM.major_impacts,
        references_data: {
          pull_requests: a.references_data?.pull_requests ?? [],
          git_commits: a.references_data?.git_commits ?? [],
          design_docs: a.references_data?.design_docs ?? [],
          wiki_pages: a.references_data?.wiki_pages ?? [],
          external: a.references_data?.external ?? [],
        },
      });
      setInitialized(true);
    }
  }, [data, initialized]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      await updateAdrFn({
        data: { id: adrId, ...form, tags },
      });
      toast.success("ADR updated");
      qc.invalidateQueries({ queryKey: ["adr", adrId] });
      navigate({ to: "/adrs/$adrId", params: { adrId } });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button
        onClick={() => navigate({ to: "/adrs/$adrId", params: { adrId } })}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to ADR
      </button>

      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground">{data.adr.full_id}</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Edit ADR</h1>

      <AdrForm
        form={form}
        setForm={setForm}
        busy={busy}
        onSubmit={handleSubmit}
        onCancel={() => navigate({ to: "/adrs/$adrId", params: { adrId } })}
        submitLabel="Save changes"
      />
    </div>
  );
}
