/**
 * MindGraph AI — 后端 API 客户端
 * 通过 SSE 流式获取生成进度和结果
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── API Headers (set from settings) ──
let _apiHeaders: Record<string, string> = {};

export function setApiHeaders(headers: Record<string, string>) {
  _apiHeaders = headers;
}

export interface ProgressEvent {
  type: "progress" | "result" | "error";
  phase: string;
  message: string;
  progress: number;
  data?: any;
}

type EventCallback = (event: ProgressEvent) => void;

async function sseRequest(
  endpoint: string,
  body: any,
  onEvent: EventCallback,
  signal?: AbortSignal
): Promise<void> {
  const resp = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ..._apiHeaders },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    let msg = "Unknown error";
    if (typeof err.detail === "string") {
      msg = err.detail;
    } else if (Array.isArray(err.detail)) {
      msg = err.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
    } else if (err.detail) {
      msg = JSON.stringify(err.detail);
    } else {
      msg = `HTTP ${resp.status}`;
    }
    throw new Error(msg);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("Response body is empty");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          onEvent(data as ProgressEvent);
        } catch {
          // skip malformed events
        }
      }
    }
  }
}

// ── Scene 1: Mind Map ──

export async function generateMindMap(
  text: string,
  maxDepth: number,
  onEvent: EventCallback,
  signal?: AbortSignal
): Promise<void> {
  return sseRequest(
    "/api/mindmap/generate",
    { text, max_depth: maxDepth },
    onEvent,
    signal
  );
}

export async function generateMindMapFromFile(
  file: File,
  maxDepth: number,
  onEvent: EventCallback,
  signal?: AbortSignal
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("max_depth", String(maxDepth));

  const resp = await fetch(`${BACKEND_URL}/api/mindmap/generate-from-file`, {
    method: "POST",
    headers: { ..._apiHeaders },
    body: formData,
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    let msg = "Unknown error";
    if (typeof err.detail === "string") {
      msg = err.detail;
    } else if (Array.isArray(err.detail)) {
      msg = err.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
    } else if (err.detail) {
      msg = JSON.stringify(err.detail);
    } else {
      msg = `HTTP ${resp.status}`;
    }
    throw new Error(msg);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("Response body is empty");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          onEvent(data as ProgressEvent);
        } catch {
          // skip
        }
      }
    }
  }
}

// ── Scene 2: Knowledge Graph ──

export async function generateKnowledgeGraph(
  keyword: string,
  maxNodes: number,
  onEvent: EventCallback,
  signal?: AbortSignal
): Promise<void> {
  return sseRequest(
    "/api/knowledge-graph/generate",
    { keyword, max_nodes: maxNodes },
    onEvent,
    signal
  );
}

export async function expandKnowledgeGraphNode(
  nodeId: string,
  nodeName: string,
  currentGraph: { entities: any[]; relations: any[] },
  maxNewNodes: number,
  onEvent: EventCallback,
  signal?: AbortSignal
): Promise<void> {
  return sseRequest(
    "/api/knowledge-graph/expand",
    {
      node_id: nodeId,
      node_name: nodeName,
      current_graph: currentGraph,
      max_new_nodes: maxNewNodes,
    },
    onEvent,
    signal
  );
}

export async function suggestGraphImprovements(
  currentGraph: { entities: any[]; relations: any[] },
  focus: string | null,
  onEvent: EventCallback,
  signal?: AbortSignal
): Promise<void> {
  return sseRequest(
    "/api/knowledge-graph/suggest",
    { current_graph: currentGraph, focus },
    onEvent,
    signal
  );
}
