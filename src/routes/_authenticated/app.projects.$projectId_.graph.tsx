import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProject, getProjectForGraph } from "@/lib/api/decyra.functions";
import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";

import { ArrowLeft, GitBranch } from "lucide-react";
import { StatusBadge } from "@/components/decyra/StatusBadge";

export const Route = createFileRoute("/_authenticated/app/projects/$projectId_/graph")({
  head: () => ({ meta: [{ title: "Relationship Graph — Decyra" }] }),
  component: GraphPage,
});

const STATUS_COLORS: Record<string, string> = {
  draft: "#6366f1",
  under_review: "#f59e0b",
  approved: "#10b981",
  published: "#3b82f6",
  superseded: "#6b7280",
};

const REL_COLORS: Record<string, string> = {
  depends_on: "#f59e0b",
  related_to: "#6366f1",
  supersedes: "#ef4444",
  superseded_by: "#ef4444",
  conflicts_with: "#dc2626",
  affects: "#8b5cf6",
};

// Custom ADR node
function AdrNode({ data }: { data: any }) {
  const navigate = useNavigate();
  const color = STATUS_COLORS[data.status] ?? "#6b7280";

  return (
    <div
      className="bg-card border-2 rounded-xl px-4 py-3 shadow-lg cursor-pointer hover:shadow-xl transition-shadow min-w-[180px] max-w-[240px]"
      style={{ borderColor: color }}
      onClick={() => navigate({ to: "/app/adrs/$adrId", params: { adrId: data.adrId } })}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/50 !w-2 !h-2" />
      <div className="text-[10px] font-mono font-bold opacity-60 mb-1" style={{ color }}>{data.fullId}</div>
      <div className="text-xs font-semibold leading-tight text-foreground">{data.label}</div>
      <div className="mt-2">
        <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
          style={{ background: `${color}20`, color }}>
          {data.status?.replace("_", " ")}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground/50 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes: NodeTypes = { adrNode: AdrNode };

function GraphPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();

  const getProjectFn = useServerFn(getProject);
  const getGraphFn = useServerFn(getProjectForGraph);

  const { data: projectData } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectFn({ data: { id: projectId } }),
  });

  const { data: graphData } = useQuery({
    queryKey: ["graph", projectId],
    queryFn: () => getGraphFn({ data: { project_id: projectId } }),
  });

  // Build nodes with automatic layout
  const initialNodes = useMemo<Node[]>(() => {
    if (!graphData?.adrs) return [];
    return graphData.adrs.map((adr: any, idx: number) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      return {
        id: adr.id,
        type: "adrNode",
        position: { x: col * 280 + 40, y: row * 160 + 40 },
        data: {
          label: adr.title,
          fullId: adr.full_id,
          status: adr.status,
          adrId: adr.id,
        },
      };
    });
  }, [graphData]);

  const initialEdges = useMemo<Edge[]>(() => {
    if (!graphData?.relationships) return [];
    return graphData.relationships.map((r: any) => ({
      id: r.id,
      source: r.source_adr_id,
      target: r.target_adr_id,
      label: r.rel_type.replace(/_/g, " "),
      labelStyle: { fontSize: 9, fontFamily: "inherit" },
      labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      style: { stroke: REL_COLORS[r.rel_type] ?? "#6366f1", strokeWidth: 1.5 },
      animated: r.rel_type === "depends_on",
      markerEnd: { type: "arrowclosed" as any, color: REL_COLORS[r.rel_type] ?? "#6366f1" },
    }));
  }, [graphData]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const project = projectData?.project;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <button
          onClick={() => navigate({ to: "/app/projects/$projectId", params: { projectId } })}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <GitBranch className="h-4 w-4 text-primary" />
        <div>
          <span className="font-mono text-xs text-muted-foreground mr-2">{project?.code}</span>
          <span className="font-semibold text-sm">{project?.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">— Relationship Graph</span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          {Object.entries(STATUS_COLORS).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />
              {s.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {graphData?.adrs?.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <GitBranch className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No ADRs in this project yet</p>
          <Link to="/app/projects/$projectId/adrs/new" params={{ projectId }}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
            Create first ADR
          </Link>
        </div>
      )}

      {/* Graph */}
      {(graphData?.adrs?.length ?? 0) > 0 && (
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.2}
            maxZoom={2}
            colorMode="system"
          >
            <Background color="var(--color-border)" gap={20} size={1} />
            <Controls className="!bg-card !border-border !shadow-md" />
            <MiniMap
              className="!bg-card !border-border !rounded-lg"
              nodeColor={(n) => STATUS_COLORS[(n.data as any)?.status] ?? "#6b7280"}
              maskColor="var(--color-background)"
            />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
