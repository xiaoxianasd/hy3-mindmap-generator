"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  Edge,
  MarkerType,
  Panel,
  useReactFlow,
  BaseEdge,
  getBezierPath,
  EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { toSvg, toPng } from "html-to-image";

// ── Types ──

interface KGEntity {
  id: string;
  name: string;
  category: string;
}

interface KGRelation {
  source: string;
  target: string;
  relation: string;
}

interface KnowledgeGraph {
  entities: KGEntity[];
  relations: KGRelation[];
}

interface KnowledgeGraphViewProps {
  graph: KnowledgeGraph | null;
  onNodeExpand: (nodeId: string, nodeName: string, currentGraph: KnowledgeGraph) => void;
  onRequestSuggestion: (currentGraph: KnowledgeGraph, focus: string | null) => void;
  expanding: boolean;
  suggestions: Array<{
    suggestion_type: string;
    description: string;
    proposed_change?: Record<string, any>;
  }> | null;
  onApplySuggestion: (suggestion: any) => void;
}

// ── Category Colors ──

const CATEGORY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  concept:     { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  person:      { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" },
  method:      { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  tool:        { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  event:       { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b5" },
};

const DEFAULT_STYLE = { bg: "#f3f4f6", border: "#9ca3af", text: "#374151" };

// ── Dagre Layout ──

function layoutGraph(entities: KGEntity[], relations: KGRelation[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 70, ranksep: 100, marginx: 40, marginy: 40 });

  for (const e of entities) {
    g.setNode(e.id, { width: 160, height: 50 });
  }

  for (const r of relations) {
    g.setEdge(r.source, r.target);
  }

  dagre.layout(g);

  const nodes: Node[] = entities.map((e) => {
    const pos = g.node(e.id);
    const style = CATEGORY_STYLES[e.category] || DEFAULT_STYLE;
    return {
      id: e.id,
      type: "default",
      position: { x: pos.x - 80, y: pos.y - 25 },
      data: {
        label: (
          <div
            className="px-3 py-2 rounded-xl border-2 text-center text-sm font-medium cursor-pointer
                       transition-shadow hover:shadow-md min-w-[100px]"
            style={{
              backgroundColor: style.bg,
              borderColor: style.border,
              color: style.text,
            }}
          >
            <div>{e.name}</div>
            <div className="text-[10px] opacity-60 mt-0.5">{e.category}</div>
          </div>
        ),
        entity: e,
      },
      style: { background: "transparent", border: "none" },
    };
  });

  const edges: Edge[] = relations.map((r, i) => ({
    id: `${r.source}-${r.target}-${i}`,
    source: r.source,
    target: r.target,
    type: "floating",
    label: r.relation,
    labelStyle: { fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#94a3b8" },
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
    animated: false,
  }));

  return { nodes, edges };
}

// ── Floating Edge (smooth curve with label on hover) ──

function FloatingEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, label, style, markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const [hovered, setHovered] = useState(false);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: hovered ? 2.5 : 1.5,
          stroke: hovered ? "#6366f1" : (style?.stroke as string || "#94a3b8"),
          transition: "stroke 0.2s, stroke-width 0.2s",
          cursor: "pointer",
        }}
        markerEnd={markerEnd}
      />
      {/* Invisible wider stroke for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={15}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {label && (
        <foreignObject
          width={120}
          height={24}
          x={(sourceX + targetX) / 2 - 60}
          y={(sourceY + targetY) / 2 - 12}
          className="overflow-visible pointer-events-none"
          style={{ opacity: hovered ? 1 : 0.6, transition: "opacity 0.2s" }}
        >
          <div
            className="text-[11px] text-center text-gray-600 bg-white/90 rounded-full px-2 py-0.5
                       border border-gray-200 shadow-sm truncate mx-auto"
            style={{ maxWidth: 120 }}
          >
            {typeof label === "string" ? label : ""}
          </div>
        </foreignObject>
      )}
    </>
  );
}

const edgeTypes = { floating: FloatingEdge };

// ═══════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════

export default function KnowledgeGraphView({
  graph,
  onNodeExpand,
  onRequestSuggestion,
  expanding,
  suggestions,
  onApplySuggestion,
}: KnowledgeGraphViewProps) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const prevEntityCountRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Apply layout when graph changes ──
  useEffect(() => {
    if (!graph || graph.entities.length === 0) return;

    const isExpand = graph.entities.length > prevEntityCountRef.current;
    prevEntityCountRef.current = graph.entities.length;

    const { nodes: newNodes, edges: newEdges } = layoutGraph(graph.entities, graph.relations);
    setNodes(newNodes);
    setEdges(newEdges);

    // Fit view for initial loads
    setTimeout(() => fitView({ padding: 0.3, duration: 400 }), 100);
  }, [graph, setNodes, setEdges, fitView]);

  // ── Connections (user draws edges) ──
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "floating",
            label: "新关系",
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#f59e0b" },
            style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "5 3" },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // ── Node Click → Expand ──
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (expanding) return;
      const entity = node.data?.entity as KGEntity | undefined;
      if (!entity) return;

      // Toggle expand — only expand each node once
      if (expandedNodes.has(entity.id)) return;

      setExpandedNodes((prev) => new Set(prev).add(entity.id));

      // Build current graph state
      const currentGraph: KnowledgeGraph = {
        entities: nodes.map((n) => n.data?.entity).filter(Boolean) as KGEntity[],
        relations: edges.map((e) => ({
          source: e.source,
          target: e.target,
          relation: typeof e.label === "string" ? e.label : "",
        })),
      };

      onNodeExpand(entity.id, entity.name, currentGraph);
    },
    [expanding, expandedNodes, nodes, edges, onNodeExpand]
  );

  // ── Suggestion Panel ──

  const handleSuggest = useCallback(() => {
    const currentGraph: KnowledgeGraph = {
      entities: nodes.map((n) => n.data?.entity).filter(Boolean) as KGEntity[],
      relations: edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: typeof e.label === "string" ? e.label : "",
      })),
    };
    onRequestSuggestion(currentGraph, null);
    setShowSuggestions(true);
  }, [nodes, edges, onRequestSuggestion]);

  // ── Export ──

  const handleExportSVG = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      const dataUrl = await toSvg(containerRef.current, { backgroundColor: "#ffffff" });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "knowledge-graph.svg";
      a.click();
    } catch (e) {
      console.error("SVG export failed:", e);
    }
  }, []);

  const handleExportPDF = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      const dataUrl = await toPng(containerRef.current, { backgroundColor: "#ffffff" });
      const printWin = window.open("", "_blank", "width=1200,height=800");
      if (!printWin) { alert("请允许弹出窗口"); return; }
      printWin.document.write(`
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Knowledge Graph</title>
        <style>*{margin:0;padding:0}body{display:flex;justify-content:center;align-items:center;min-height:100vh}
        img{max-width:100%;max-height:100vh;object-fit:contain}</style></head>
        <body><img src="${dataUrl}" onload="window.print()"></body></html>
      `);
      printWin.document.close();
    } catch (e) {
      console.error("PDF export failed:", e);
    }
  }, []);

  // ── Empty State ──

  if (!graph || graph.entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
          </svg>
          <p>输入主题关键词后点击"生成知识图谱"</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        edgeTypes={edgeTypes}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.15}
        maxZoom={3}
        defaultEdgeOptions={{
          type: "floating",
        }}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          style={{ border: "1px solid #e5e7eb", borderRadius: 8 }}
        />

        {/* Top toolbar */}
        <Panel position="top-right" className="flex gap-2">
          <button
            onClick={handleExportSVG}
            className="px-3 py-2 rounded-xl bg-white/95 shadow-sm border border-gray-200
                       text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
            title="导出 SVG"
          >
            SVG
          </button>
          <button
            onClick={handleExportPDF}
            className="px-3 py-2 rounded-xl bg-white/95 shadow-sm border border-gray-200
                       text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
            title="导出 PDF"
          >
            PDF
          </button>
          <button
            onClick={handleSuggest}
            disabled={expanding}
            className="px-4 py-2 rounded-xl bg-white/95 shadow-sm border border-gray-200
                       text-sm font-medium text-amber-600 hover:bg-amber-50
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            💡 AI 建议
          </button>
        </Panel>

        {/* Bottom hint */}
        <Panel position="bottom-center" className="text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
          点击节点展开子图 | 拖拽节点自由移动 | 右键连接节点 | 滚轮缩放
        </Panel>
      </ReactFlow>

      {/* Suggestions Side Panel */}
      {showSuggestions && suggestions && suggestions.length > 0 && (
        <div className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-2xl border-l border-gray-200
                        overflow-y-auto z-20 rounded-l-xl">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">💡 AI 改进建议</h3>
              <button
                onClick={() => setShowSuggestions(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              {suggestions.map((s, i) => (
                <div key={i} className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-700">
                      {s.suggestion_type === "add_entity" && "添加实体"}
                      {s.suggestion_type === "add_relation" && "添加关系"}
                      {s.suggestion_type === "merge_entities" && "合并实体"}
                      {s.suggestion_type === "refine_label" && "优化标签"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{s.description}</p>
                  {s.proposed_change && (
                    <button
                      onClick={() => {
                        onApplySuggestion(s);
                        setShowSuggestions(false);
                      }}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800
                                 bg-indigo-50 px-3 py-1 rounded-lg hover:bg-indigo-100 transition-colors"
                    >
                      应用此建议
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
