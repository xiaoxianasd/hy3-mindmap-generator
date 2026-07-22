"use client";

import React, { useState, useCallback, useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";

import InputPanel from "@/components/InputPanel";
import MindMapView from "@/components/MindMapView";
import KnowledgeGraphView from "@/components/KnowledgeGraphView";
import ProgressOverlay from "@/components/ProgressOverlay";
import SettingsModal from "@/components/SettingsModal";
import {
  generateMindMap,
  generateMindMapFromFile,
  generateKnowledgeGraph,
  expandKnowledgeGraphNode,
  suggestGraphImprovements,
  ProgressEvent,
  setApiHeaders,
} from "@/lib/api";

type Mode = "mindmap" | "knowledge-graph";

// ── Defaults ──
const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://tokenhub.tencentmaas.com/v1",
  model: "hy3",
};

function loadSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem("mindgraph-settings");
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ── Types from API ──

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

interface KGSuggestion {
  suggestion_type: string;
  description: string;
  proposed_change?: Record<string, any>;
}

// ── Prompt Cache key (constant across sessions) ──
const SESSION_ID = "mindgraph-" + (typeof window !== "undefined" ? "browser" : "server");

export default function Home() {
  // ── Mode ──
  const [mode, setMode] = useState<Mode>("mindmap");

  // ── Shared loading / progress ──
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressVal, setProgressVal] = useState(0);

  // ── Scene 1: Mind Map results ──
  const [rawMarkdown, setRawMarkdown] = useState<string | null>(null);

  // ── Scene 2: Knowledge Graph results ──
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [suggestions, setSuggestions] = useState<KGSuggestion[] | null>(null);

  // ── API Settings ──
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleSaveSettings = useCallback((s: typeof DEFAULT_SETTINGS) => {
    setSettings(s);
    localStorage.setItem("mindgraph-settings", JSON.stringify(s));
    setApiHeaders({
      "X-Hy3-Api-Key": s.apiKey,
      "X-Hy3-Base-Url": s.baseUrl,
      "X-Hy3-Model": s.model,
    });
  }, []);

  // Init headers on mount
  React.useEffect(() => {
    const s = loadSettings();
    setApiHeaders({
      "X-Hy3-Api-Key": s.apiKey,
      "X-Hy3-Base-Url": s.baseUrl,
      "X-Hy3-Model": s.model,
    });
  }, []);

  // Abort controller for cancellation
  const abortRef = useRef<AbortController | null>(null);

  // ── SSE Helper ──
  const handleProgress = useCallback((event: ProgressEvent) => {
    setProgressMsg(event.message);
    setProgressVal(event.progress);

    if (event.type === "result" && event.data) {
      // Data will be handled by each specific handler
    }
    if (event.type === "error") {
      setLoading(false);
      setExpanding(false);
    }
  }, []);

  // ═══════════════════════════════════════════
  //  Scene 1 Handlers
  // ═══════════════════════════════════════════

  const handleGenerateMindMap = useCallback(
    async (text: string, depth: number) => {
      setLoading(true);
      setProgressMsg("正在分析文本结构...");
      setProgressVal(0);
      abortRef.current = new AbortController();

      try {
        await generateMindMap(
          text,
          depth,
          (event) => {
            handleProgress(event);
            if (event.type === "result" && event.data) {
              setRawMarkdown(event.data.raw_markdown || "");
              setLoading(false);
            }
            if (event.type === "error") {
              setLoading(false);
            }
          },
          abortRef.current.signal
        );
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("MindMap generation failed:", err);
        }
        setLoading(false);
      }
    },
    [handleProgress]
  );

  const handleGenerateMindMapFromFile = useCallback(
    async (file: File, depth: number) => {
      setLoading(true);
      setProgressMsg("正在解析文件...");
      setProgressVal(0);
      abortRef.current = new AbortController();

      try {
        await generateMindMapFromFile(
          file,
          depth,
          (event) => {
            handleProgress(event);
            if (event.type === "result" && event.data) {
              setRawMarkdown(event.data.raw_markdown || "");
              setLoading(false);
            }
            if (event.type === "error") {
              setLoading(false);
            }
          },
          abortRef.current.signal
        );
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("MindMap file generation failed:", err);
        }
        setLoading(false);
      }
    },
    [handleProgress]
  );

  // ═══════════════════════════════════════════
  //  Scene 2 Handlers
  // ═══════════════════════════════════════════

  const handleGenerateKG = useCallback(
    async (keyword: string, maxNodes: number) => {
      setLoading(true);
      setProgressMsg("正在分析关键词...");
      setProgressVal(0);
      setGraph(null);
      setSuggestions(null);
      abortRef.current = new AbortController();

      try {
        await generateKnowledgeGraph(
          keyword,
          maxNodes,
          (event) => {
            handleProgress(event);
            if (event.type === "result" && event.data) {
              setGraph({
                entities: event.data.entities || [],
                relations: event.data.relations || [],
              });
              setLoading(false);
            }
            if (event.type === "error") {
              setLoading(false);
            }
          },
          abortRef.current.signal
        );
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("KG generation failed:", err);
        }
        setLoading(false);
      }
    },
    [handleProgress]
  );

  // ── Node Expand ──

  const handleNodeExpand = useCallback(
    async (nodeId: string, nodeName: string, currentGraph: KnowledgeGraph) => {
      if (!graph) return;
      setExpanding(true);
      setProgressMsg(`正在扩展节点: ${nodeName}...`);

      try {
        await expandKnowledgeGraphNode(
          nodeId,
          nodeName,
          currentGraph,
          8,
          (event) => {
            setProgressMsg(event.message);
            setProgressVal(event.progress);
            if (event.type === "result" && event.data) {
              const newEntities: KGEntity[] = event.data.new_entities || [];
              const newRelations: KGRelation[] = event.data.new_relations || [];

              // Merge into existing graph, avoid duplicates by id
              const existingIds = new Set(currentGraph.entities.map((e) => e.id));
              const mergedEntities = [
                ...currentGraph.entities,
                ...newEntities.filter((e) => !existingIds.has(e.id)),
              ];
              const mergedRelations = [
                ...currentGraph.relations,
                ...newRelations,
              ];

              setGraph({
                entities: mergedEntities,
                relations: mergedRelations,
              });
              setExpanding(false);
            }
            if (event.type === "error") {
              setExpanding(false);
            }
          }
        );
      } catch (err: any) {
        console.error("Node expansion failed:", err);
        setExpanding(false);
      }
    },
    [graph]
  );

  // ── AI Suggestions ──

  const handleRequestSuggestion = useCallback(
    async (currentGraph: KnowledgeGraph, focus: string | null) => {
      setProgressMsg("正在分析图谱质量...");

      try {
        await suggestGraphImprovements(
          currentGraph,
          focus,
          (event) => {
            if (event.type === "result" && event.data) {
              setSuggestions(event.data.suggestions || []);
            }
          }
        );
      } catch (err: any) {
        console.error("Suggestion failed:", err);
      }
    },
    []
  );

  const handleApplySuggestion = useCallback(
    (suggestion: KGSuggestion) => {
      if (!graph || !suggestion.proposed_change) return;

      const change = suggestion.proposed_change;

      if (suggestion.suggestion_type === "add_entity" && change.name) {
        const newId = `ne${graph.entities.length + 1}`;
        const newEntity: KGEntity = {
          id: newId,
          name: change.name,
          category: change.category || "concept",
        };
        setGraph({
          ...graph,
          entities: [...graph.entities, newEntity],
        });
      } else if (suggestion.suggestion_type === "add_relation" && change.source && change.target) {
        const newRelation: KGRelation = {
          source: change.source,
          target: change.target,
          relation: change.relation || "关联",
        };
        setGraph({
          ...graph,
          relations: [...graph.relations, newRelation],
        });
      } else if (suggestion.suggestion_type === "merge_entities" && change.keep && change.remove) {
        // Merge: remove target, redirect all its relations to keep
        const newRelations = graph.relations
          .filter((r) => r.source !== change.remove && r.target !== change.remove)
          .map((r) => ({
            ...r,
            source: r.source === change.remove ? change.keep : r.source,
            target: r.target === change.remove ? change.keep : r.target,
          }));
        setGraph({
          entities: graph.entities.filter((e) => e.id !== change.remove),
          relations: newRelations,
        });
      }

      setSuggestions(null);
    },
    [graph]
  );

  // ═══════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════

  return (
    <div className="flex flex-col h-screen">
      {/* Header + Mode Switch */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-800">
              🧠 MindGraph AI
            </h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              Powered by Hy3
            </span>
          </div>

          {/* Mode Tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setMode("mindmap")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                ${mode === "mindmap"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
                }`}
            >
              📝 思维导图
            </button>
            <button
              onClick={() => setMode("knowledge-graph")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                ${mode === "knowledge-graph"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
                }`}
            >
              🕸️ 知识图谱
            </button>
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100
                       hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
            title="API 设置"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Input area (40%) */}
        <div className="flex-[4] min-h-0 px-4 py-4 overflow-auto">
          <InputPanel
            mode={mode}
            onGenerateMindMap={handleGenerateMindMap}
            onGenerateMindMapFromFile={handleGenerateMindMapFromFile}
            onGenerateKG={handleGenerateKG}
            loading={loading}
          />
        </div>

        {/* Visualization area (60%) */}
        <div className="flex-[6] min-h-0 border-t border-gray-200">
          {mode === "mindmap" ? (
            <MindMapView rawMarkdown={rawMarkdown} />
          ) : (
            <ReactFlowProvider>
              <KnowledgeGraphView
                graph={graph}
                onNodeExpand={handleNodeExpand}
                onRequestSuggestion={handleRequestSuggestion}
                expanding={expanding}
                suggestions={suggestions}
                onApplySuggestion={handleApplySuggestion}
              />
            </ReactFlowProvider>
          )}
        </div>
      </div>

      {/* Progress Overlay */}
      <ProgressOverlay
        message={progressMsg}
        progress={progressVal}
        visible={loading || expanding}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
