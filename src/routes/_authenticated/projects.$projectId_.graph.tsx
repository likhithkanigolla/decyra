import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getProject,
  getProjectForGraph,
  addAdrRelationship,
  updateAdrRelationship,
  removeAdrRelationship,
  saveProjectGraphLayout,
} from "@/lib/api/decyra.functions";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import {
  ArrowLeft,
  GitBranch,
  Save,
  Plus,
  Trash2,
  ArrowLeftRight,
  ExternalLink,
  RotateCcw,
  X,
  Check,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$projectId_/graph")({
  head: () => ({ meta: [{ title: "Relationship Graph — Decyra" }] }),
  component: GraphPage,
});

const STATUS_COLORS: Record<"dark" | "light", Record<string, { border: string; bg: string; text: string }>> = {
  dark: {
    draft: { border: "#818cf8", bg: "rgba(129, 140, 248, 0.15)", text: "#a5b4fc" },
    under_review: { border: "#fbbf24", bg: "rgba(251, 191, 36, 0.15)", text: "#fde68a" },
    approved: { border: "#34d399", bg: "rgba(52, 211, 153, 0.15)", text: "#a7f3d0" },
    published: { border: "#60a5fa", bg: "rgba(96, 165, 250, 0.15)", text: "#bfdbfe" },
    superseded: { border: "#9ca3af", bg: "rgba(156, 163, 175, 0.15)", text: "#d1d5db" },
  },
  light: {
    draft: { border: "#4f46e5", bg: "rgba(79, 70, 229, 0.10)", text: "#4338ca" },
    under_review: { border: "#d97706", bg: "rgba(217, 119, 6, 0.10)", text: "#b45309" },
    approved: { border: "#059669", bg: "rgba(5, 150, 105, 0.10)", text: "#047857" },
    published: { border: "#2563eb", bg: "rgba(37, 99, 235, 0.10)", text: "#1d4ed8" },
    superseded: { border: "#64748b", bg: "rgba(100, 116, 139, 0.10)", text: "#475569" },
  },
};

export const REL_DEFINITIONS: Record<
  string,
  {
    label: string;
    description: (s: string, t: string) => string;
    colorDark: string;
    colorLight: string;
    animated?: boolean;
  }
> = {
  depends_on: {
    label: "depends on",
    description: (s, t) => `${s} requires and depends on ${t}`,
    colorDark: "#fbbf24",
    colorLight: "#d97706",
    animated: true,
  },
  supersedes: {
    label: "supersedes",
    description: (s, t) => `${s} replaces & obsoletes ${t} (Newer replaces Older)`,
    colorDark: "#f87171",
    colorLight: "#dc2626",
  },
  superseded_by: {
    label: "replaced by",
    description: (s, t) => `${s} is superseded & replaced by ${t} (Older replaced by Newer)`,
    colorDark: "#fb923c",
    colorLight: "#ea580c",
  },
  affects: {
    label: "affects",
    description: (s, t) => `${s} impacts and modifies aspects of ${t}`,
    colorDark: "#c084fc",
    colorLight: "#7c3aed",
  },
  conflicts_with: {
    label: "conflicts with",
    description: (s, t) => `${s} is mutually incompatible with ${t}`,
    colorDark: "#ef4444",
    colorLight: "#b91c1c",
  },
  related_to: {
    label: "related to",
    description: (s, t) => `${s} is conceptually related to ${t}`,
    colorDark: "#818cf8",
    colorLight: "#4f46e5",
  },
};

// Custom ADR Node with high-contrast light & dark styling and 4 connection handles
function AdrNode({ data }: { data: any }) {
  const navigate = useNavigate();
  const theme: "dark" | "light" = data.theme ?? "dark";
  const colors = STATUS_COLORS[theme][data.status] ?? STATUS_COLORS[theme].draft;

  return (
    <div
      className="relative group bg-card border-2 rounded-xl px-3 py-2.5 shadow-sm hover:shadow-md transition-all min-w-[170px] max-w-[210px]"
      style={{ borderColor: colors.border }}
    >
      {/* 4 Handles for dragging and receiving connections */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background hover:scale-150 transition-transform"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background hover:scale-150 transition-transform"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background hover:scale-150 transition-transform"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background hover:scale-150 transition-transform"
      />

      {/* Header with full ID and direct link */}
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <span className="text-[10px] font-mono font-bold" style={{ color: colors.text }}>
          {data.fullId}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate({ to: "/adrs/$adrId", params: { adrId: data.adrId } });
          }}
          className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 p-0.5 rounded transition-opacity"
          title="Open ADR page"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {/* Title */}
      <div className="text-xs font-semibold leading-tight text-foreground line-clamp-2 mb-1.5">
        {data.label}
      </div>

      {/* Status Badge */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[9px]">
        <span
          className="inline-flex items-center rounded-full px-1.5 py-0.5 font-bold uppercase tracking-wider"
          style={{ background: colors.bg, color: colors.text }}
        >
          {data.status?.replace("_", " ")}
        </span>
        <span className="text-muted-foreground/70">Drag dot</span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { adrNode: AdrNode };

interface RelModalState {
  isOpen: boolean;
  id?: string;
  sourceId: string;
  targetId: string;
  relType: string;
  isNew: boolean;
}

function GraphPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  });

  // Track theme switches in Decyra
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isLight = document.documentElement.classList.contains("light");
      setTheme(isLight ? "light" : "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-color-mode"] });
    return () => observer.disconnect();
  }, []);

  const getProjectFn = useServerFn(getProject);
  const getGraphFn = useServerFn(getProjectForGraph);
  const addRelFn = useServerFn(addAdrRelationship);
  const updateRelFn = useServerFn(updateAdrRelationship);
  const removeRelFn = useServerFn(removeAdrRelationship);
  const saveLayoutFn = useServerFn(saveProjectGraphLayout);

  const { data: projectData } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectFn({ data: { id: projectId } }),
  });

  const { data: graphData } = useQuery({
    queryKey: ["graph", projectId],
    queryFn: () => getGraphFn({ data: { project_id: projectId } }),
  });

  // Map of ADRs for easy lookup
  const adrsMap = useMemo(() => {
    const map = new Map<string, { id: string; full_id: string; title: string; status: string }>();
    for (const a of graphData?.adrs ?? []) {
      map.set(a.id, a);
    }
    return map;
  }, [graphData?.adrs]);

  // Initial nodes layout (uses saved project layout if available, or calculates default grid)
  const initialNodes = useMemo<Node[]>(() => {
    if (!graphData?.adrs) return [];
    const savedLayout = (graphData as any)?.graph_layout ?? {};

    return graphData.adrs.map((adr: any, idx: number) => {
      const savedPos = savedLayout[adr.id];
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const position = savedPos ? { x: savedPos.x, y: savedPos.y } : { x: col * 240 + 40, y: row * 140 + 40 };

      return {
        id: adr.id,
        type: "adrNode",
        position,
        data: {
          label: adr.title,
          fullId: adr.full_id,
          status: adr.status,
          adrId: adr.id,
          theme,
        },
      };
    });
  }, [graphData, theme]);

  // Initial edges with theme-aware colors and contrast-fixed labels
  const initialEdges = useMemo<Edge[]>(() => {
    if (!graphData?.relationships) return [];
    return graphData.relationships.map((r: any) => {
      const def = REL_DEFINITIONS[r.rel_type] ?? REL_DEFINITIONS.related_to;
      const color = theme === "dark" ? def.colorDark : def.colorLight;

      return {
        id: r.id,
        source: r.source_adr_id,
        target: r.target_adr_id,
        label: def.label,
        labelStyle: {
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "inherit",
          fill: theme === "dark" ? "#f1f5f9" : "#0f172a",
        },
        labelBgStyle: {
          fill: theme === "dark" ? "#1e293b" : "#ffffff",
          fillOpacity: 0.96,
          stroke: theme === "dark" ? "#334155" : "#cbd5e1",
          strokeWidth: 1.5,
          rx: 6,
          ry: 6,
        },
        labelBgPadding: [6, 4] as [number, number],
        style: { stroke: color, strokeWidth: 2 },
        animated: def.animated ?? false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 16,
          height: 16,
        },
      };
    });
  }, [graphData?.relationships, theme]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [hasUnsavedLayout, setHasUnsavedLayout] = useState(false);
  const [isSavingLayout, setIsSavingLayout] = useState(false);

  // Modal state for editing or creating relationship
  const [relModal, setRelModal] = useState<RelModalState | null>(null);
  const [isSavingRel, setIsSavingRel] = useState(false);

  useEffect(() => {
    setNodes(initialNodes);
    setHasUnsavedLayout(false);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Track node drag movements to enable saving
  const handleNodeDragStop = useCallback(() => {
    setHasUnsavedLayout(true);
  }, []);

  // Save node layout to database
  async function handleSaveLayout() {
    setIsSavingLayout(true);
    try {
      const layout: Record<string, { x: number; y: number }> = {};
      for (const node of nodes) {
        layout[node.id] = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
      }
      await saveLayoutFn({ data: { project_id: projectId, layout } });
      setHasUnsavedLayout(false);
      toast.success("Graph layout saved successfully!");
      qc.invalidateQueries({ queryKey: ["graph", projectId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save graph layout");
    } finally {
      setIsSavingLayout(false);
    }
  }

  // Reset nodes to clean grid layout
  function handleResetLayout() {
    if (!graphData?.adrs) return;
    const resetNodes = nodes.map((node, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      return {
        ...node,
        position: { x: col * 240 + 40, y: row * 140 + 40 },
      };
    });
    setNodes(resetNodes);
    setHasUnsavedLayout(true);
    toast.info("Layout rearranged into grid. Click 'Save Layout' to keep it.");
  }

  // Handle connection drag-and-drop between nodes
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) {
        toast.warning("An ADR cannot have a relationship with itself.");
        return;
      }
      setRelModal({
        isOpen: true,
        sourceId: connection.source,
        targetId: connection.target,
        relType: "depends_on",
        isNew: true,
      });
    },
    [],
  );

  // Handle clicking on an edge to edit or delete it
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const rel = graphData?.relationships?.find((r: any) => r.id === edge.id);
      if (!rel) return;
      setRelModal({
        isOpen: true,
        id: rel.id,
        sourceId: rel.source_adr_id,
        targetId: rel.target_adr_id,
        relType: rel.rel_type,
        isNew: false,
      });
    },
    [graphData?.relationships],
  );

  // Save or update relationship
  async function submitRelationship() {
    if (!relModal) return;
    setIsSavingRel(true);
    try {
      if (relModal.isNew) {
        await addRelFn({
          data: {
            source_adr_id: relModal.sourceId,
            target_adr_id: relModal.targetId,
            rel_type: relModal.relType as any,
          },
        });
        toast.success("Relationship created!");
      } else if (relModal.id) {
        await updateRelFn({
          data: {
            id: relModal.id,
            source_adr_id: relModal.sourceId,
            target_adr_id: relModal.targetId,
            rel_type: relModal.relType as any,
          },
        });
        toast.success("Relationship updated!");
      }
      setRelModal(null);
      qc.invalidateQueries({ queryKey: ["graph", projectId] });
      qc.invalidateQueries({ queryKey: ["adr-rels"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save relationship");
    } finally {
      setIsSavingRel(false);
    }
  }

  // Delete relationship
  async function deleteRelationship() {
    if (!relModal?.id) return;
    setIsSavingRel(true);
    try {
      await removeRelFn({ data: { id: relModal.id } });
      toast.success("Relationship deleted.");
      setRelModal(null);
      qc.invalidateQueries({ queryKey: ["graph", projectId] });
      qc.invalidateQueries({ queryKey: ["adr-rels"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete relationship");
    } finally {
      setIsSavingRel(false);
    }
  }

  // Swap relationship direction
  function swapDirection() {
    if (!relModal) return;
    setRelModal({
      ...relModal,
      sourceId: relModal.targetId,
      targetId: relModal.sourceId,
    });
  }

  const project = projectData?.project;
  const sourceAdr = relModal ? adrsMap.get(relModal.sourceId) : null;
  const targetAdr = relModal ? adrsMap.get(relModal.targetId) : null;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background text-foreground">
      {/* Top Header & Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            title="Back to project"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="h-4 w-4 text-primary shrink-0" />
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0">
              {project?.code}
            </span>
            <span className="font-semibold text-xs sm:text-sm truncate">{project?.name}</span>
            <span className="text-xs text-muted-foreground hidden md:inline shrink-0">— Architecture Graph</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              const allAdrs = graphData?.adrs ?? [];
              if (allAdrs.length < 2) {
                toast.warning("You need at least 2 ADRs to create a relationship.");
                return;
              }
              setRelModal({
                isOpen: true,
                sourceId: allAdrs[0].id,
                targetId: allAdrs[1].id,
                relType: "depends_on",
                isNew: true,
              });
            }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-background hover:bg-accent text-xs font-medium transition-colors"
          >
            <Plus className="h-3 w-3 text-primary" />
            Add Connection
          </button>

          <button
            onClick={handleResetLayout}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-background hover:bg-accent text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            title="Auto arrange nodes into a clean grid"
          >
            <RotateCcw className="h-3 w-3" />
            Auto Layout
          </button>

          <button
            onClick={handleSaveLayout}
            disabled={isSavingLayout || !hasUnsavedLayout}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium shadow-sm transition-all ${
              hasUnsavedLayout
                ? "bg-primary text-primary-foreground hover:opacity-90 ring-2 ring-primary/30"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
            }`}
            title="Save custom node positions"
          >
            <Save className="h-3 w-3" />
            {isSavingLayout ? "Saving…" : hasUnsavedLayout ? "Save Layout *" : "Layout Saved"}
          </button>
        </div>
      </div>

      {/* Legend & Direction Guidance Bar */}
      <div className="px-4 py-1.5 border-b border-border/60 bg-muted/30 flex items-center justify-between text-[11px] gap-3 overflow-x-auto shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Statuses:</span>
          {Object.entries(STATUS_COLORS[theme]).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: c.border }} />
              <span className="capitalize text-[11px]">{s.replace("_", " ")}</span>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Arrows (Source → Target):</span>
          {Object.entries(REL_DEFINITIONS).map(([type, def]) => {
            const color = theme === "dark" ? def.colorDark : def.colorLight;
            return (
              <span key={type} className="flex items-center gap-1" title={def.description("Source", "Target")}>
                <span className="w-2.5 h-0.5 inline-block rounded" style={{ background: color }} />
                <span className="font-medium text-[11px]" style={{ color }}>{def.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Empty State */}
      {graphData?.adrs?.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <GitBranch className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="text-base font-semibold">No ADRs in this project yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Create architecture decision records to map relationships, dependencies, and supersessions.
          </p>
          <Link
            to="/projects/$projectId/adrs/new"
            params={{ projectId }}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Create First ADR
          </Link>
        </div>
      )}

      {/* Interactive ReactFlow Graph Canvas */}
      {(graphData?.adrs?.length ?? 0) > 0 && (
        <div className="flex-1 min-h-0 relative w-full overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2.5}
            colorMode={theme}
          >
            <Background
              color={theme === "dark" ? "#334155" : "#cbd5e1"}
              gap={24}
              size={1}
            />
            <Controls className="!bg-card !border !border-border !shadow-md !rounded-lg !bottom-3 !left-3 scale-90 origin-bottom-left" />
            <MiniMap
              className="!w-32 !h-20 !bottom-3 !right-3 !bg-card !border !border-border !rounded-lg !shadow-md overflow-hidden"
              nodeColor={(n) => {
                const s = (n.data as any)?.status;
                return STATUS_COLORS[theme][s]?.border ?? "#6366f1";
              }}
              maskColor={theme === "dark" ? "rgba(15, 23, 42, 0.75)" : "rgba(241, 245, 249, 0.75)"}
            />
          </ReactFlow>

          {/* Quick instructions floating banner */}
          <div className="absolute bottom-3 left-16 z-10 bg-card/90 backdrop-blur border border-border px-2.5 py-1 rounded-lg shadow-sm text-[10px] text-muted-foreground flex items-center gap-1.5">
            <span className="font-semibold text-foreground">Tips:</span>
            <span>Drag dots to link • Click line to edit • Drag node to move</span>
          </div>
        </div>
      )}

      {/* Relationship Editor / Creator Modal */}
      {relModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold">
                  {relModal.isNew ? "Create ADR Connection" : "Edit ADR Connection"}
                </h3>
              </div>
              <button
                onClick={() => setRelModal(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Visual Direction Banner */}
            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                {/* Source ADR */}
                <div className="flex-1 min-w-0 bg-background p-2.5 rounded-lg border border-border">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">From (Source)</div>
                  <div className="font-mono text-xs font-bold text-primary truncate mt-0.5">
                    {sourceAdr?.full_id ?? "ADR A"}
                  </div>
                  <div className="text-xs truncate text-foreground/90 font-medium">{sourceAdr?.title}</div>
                </div>

                {/* Arrow & Swap Direction button */}
                <div className="flex flex-col items-center justify-center gap-1 shrink-0">
                  <button
                    onClick={swapDirection}
                    className="p-1.5 rounded-full bg-accent hover:bg-primary hover:text-primary-foreground text-foreground transition-colors"
                    title="Swap direction (reverses source and target)"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase">Arrow</span>
                </div>

                {/* Target ADR */}
                <div className="flex-1 min-w-0 bg-background p-2.5 rounded-lg border border-border">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">To (Target)</div>
                  <div className="font-mono text-xs font-bold text-primary truncate mt-0.5">
                    {targetAdr?.full_id ?? "ADR B"}
                  </div>
                  <div className="text-xs truncate text-foreground/90 font-medium">{targetAdr?.title}</div>
                </div>
              </div>

              {/* Plain English explanation of relationship direction */}
              <div className="text-xs font-medium text-foreground bg-primary/10 border border-primary/20 p-2.5 rounded-lg flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-primary">Meaning in Diagram:</div>
                  <div className="mt-0.5 text-foreground/90">
                    {REL_DEFINITIONS[relModal.relType]?.description(
                      sourceAdr?.full_id ?? "Source",
                      targetAdr?.full_id ?? "Target",
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Relationship Type Selection with Clear Meanings */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Relationship Type (Directional)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(REL_DEFINITIONS).map(([type, def]) => {
                  const selected = relModal.relType === type;
                  const color = theme === "dark" ? def.colorDark : def.colorLight;

                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setRelModal({ ...relModal, relType: type })}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        selected
                          ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary"
                          : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold capitalize flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                          {def.label}
                        </span>
                        {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        {type === "supersedes"
                          ? "Source replaces & obsoletes Target"
                          : type === "superseded_by"
                          ? "Source is obsoleted by Target"
                          : type === "depends_on"
                          ? "Source requires Target first"
                          : type === "affects"
                          ? "Source impacts Target"
                          : type === "conflicts_with"
                          ? "Incompatible with Target"
                          : "Contextually related"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-border gap-2">
              {!relModal.isNew && relModal.id ? (
                <button
                  type="button"
                  onClick={deleteRelationship}
                  disabled={isSavingRel}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Connection
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRelModal(null)}
                  className="px-3.5 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitRelationship}
                  disabled={isSavingRel}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 shadow-sm transition-opacity"
                >
                  <Check className="h-3.5 w-3.5" />
                  {isSavingRel ? "Saving…" : relModal.isNew ? "Create Connection" : "Update Connection"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
