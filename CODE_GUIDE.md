# MindGraph AI — 代码实现详解

> 适合想深入理解本项目架构、数据流和关键实现细节的开发者。

---

## 目录

1. [整体架构](#1-整体架构)
2. [后端：Hy3Client 封装](#2-后端hy3client-封装)
3. [后端：Orchestrator 核心编排](#3-后端orchestrator-核心编排)
4. [后端：API 路由与 SSE](#4-后端api-路由与-sse)
5. [前端：SSE 客户端](#5-前端sse-客户端)
6. [前端：全局状态管理 page.tsx](#6-前端全局状态管理-pagetsx)
7. [前端：MindMapView 思维导图](#7-前端mindmapview-思维导图)
8. [前端：KnowledgeGraphView 知识图谱](#8-前端knowledgegraphview-知识图谱)
9. [前端：InputPanel + SettingsModal](#9-前端inputpanel--settingsmodal)

---

## 1. 整体架构

```
浏览器 (Next.js)                  后端 (FastAPI)                 AI (Hy3)
┌──────────────────┐  SSE+Headers  ┌──────────────────┐  OpenAI SDK  ┌──────────┐
│ page.tsx (状态)   │ ──────────→  │ routes.py (路由)   │ ──────────→ │ TokenHub │
│   ↓              │              │   ↓              │              └──────────┘
│ api.ts (通信)     │              │ orchestrator.py  │
│   ↓              │              │ (编排逻辑)        │
│ MindMapView /    │              │   ↓              │
│ KnowledgeGraph   │              │ hy3_client.py    │
│   View           │              │ (API 封装)        │
└──────────────────┘              └──────────────────┘
```

**核心设计思想：**
- 前端只负责展示和用户交互，所有 AI 调用逻辑在后端
- 前后端通过 **SSE (Server-Sent Events)** 单向流式通信，后端推送进度事件
- API 配置（Key/URL/Model）通过 HTTP Headers 从前端传给后端，支持运行时动态切换
- 每个请求生成唯一 `session_id`，利用 Hy3 的 Prompt Cache 降低重复系统提示词的输入成本

---

## 2. 后端：Hy3Client 封装

**文件：** `backend/app/core/hy3_client.py`

### 2.1 为什么需要这一层

Hy3 的 API 是 OpenAI 兼容的，但有两个特有功能需要封装：
1. **快慢思考模式**：通过 `extra_body={"chat_template_kwargs": {"reasoning_effort": "no_think/low/high"}}` 控制
2. **Prompt Cache**：通过 `extra_body={"prompt_cache_key": "..."}` 配合 `extra_headers={"X-Session-ID": "..."}` 激活

如果不封装，每次调用都要手动拼这些参数，容易出错。

### 2.2 chat() — 通用对话

```python
def chat(self, messages, *, reasoning_effort="no_think", json_schema=None,
         session_id=None, prompt_cache_key=None) -> str:
```

**关键代码（行 70-98）：**

```python
# 1. 快慢思考通过 extra_body 传入
extra_body = {"chat_template_kwargs": {"reasoning_effort": reasoning_effort}}

# 2. Prompt Cache 需要两个字段配合
if prompt_cache_key:
    extra_body["prompt_cache_key"] = prompt_cache_key
if session_id:
    extra_headers["X-Session-ID"] = session_id

# 3. 结构化输出走 OpenAI 标准 response_format，strict=True 确保严格符合 Schema
if json_schema is not None:
    kwargs["response_format"] = {
        "type": "json_schema",
        "json_schema": {"name": "structured_output", "schema": json_schema, "strict": True},
    }
```

### 2.3 chat_with_json() — 结构化输出

```python
def chat_with_json(self, messages, json_schema, *, reasoning_effort="no_think",
                   session_id=None) -> dict:
```

这个方法基于 `chat()` 增加了 JSON 解析和容错处理（行 138-149）：

```python
try:
    return json.loads(raw)
except json.JSONDecodeError:
    # 容错：Hy3 偶尔会把 JSON 包在 ```json ... ``` 里
    if "```json" in raw:
        block = raw.split("```json")[1].split("```")[0].strip()
        return json.loads(block)
```

### 2.4 前端 Headers 动态配置（行 157-179）

这是一个重要的设计：允许用户在前端 UI 里切换 API Key，不用重启后端。

```python
_custom_config: dict = {}

def configure_from_headers(headers: dict):
    """路由层在每个请求开始时调用，读取 X-Hy3-* headers"""
    global _custom_config
    _custom_config = {}
    if headers.get("x-hy3-api-key"):
        _custom_config["api_key"] = headers["x-hy3-api-key"]
    if headers.get("x-hy3-base-url"):
        _custom_config["base_url"] = headers["x-hy3-base-url"]
    if headers.get("x-hy3-model"):
        _custom_config["model"] = headers["x-hy3-model"]

def get_hy3_client() -> Hy3Client:
    """如果有 _custom_config，就重新创建实例；否则复用单例"""
    if _custom_config or _hy3_client is None:
        _hy3_client = Hy3Client(**_custom_config)
        _custom_config = {}
    return _hy3_client
```

**数据流：** 前端 SettingsModal 保存 → localStorage + setApiHeaders() → fetch 带 Headers → 后端 _apply_headers() 读取 → configure_from_headers() → get_hy3_client() 用新配置重建

---

## 3. 后端：Orchestrator 核心编排

**文件：** `backend/app/core/orchestrator.py`

这是整个系统的大脑，负责把用户需求分解成 Hy3 API 调用序列。

### 3.1 四大流程总览

| 流程 | 方法 | 触发场景 |
|------|------|---------|
| 文本→思维导图 | `generate_mindmap()` | 场景一 |
| 关键词→知识图谱 | `generate_knowledge_graph()` | 场景二 |
| 节点下钻扩展 | `expand_node()` | 场景二点击节点 |
| AI 改进建议 | `suggest_improvements()` | 场景二编辑后 |

每个方法都是 `AsyncGenerator[ProgressEvent, None]`，通过 `yield ProgressEvent(...)` 逐步推送进度，上层路由用 SSE 转发给前端。

### 3.2 思维导图生成（行 157-268）——深度保证机制

这是最复杂的流程，核心挑战是 **Hy3 不总是生成请求的深度**。

**第一阶段：初始生成**

```python
# 行 181-192：System Prompt 强调深度要求
system_prompt = (
    f"核心要求：必须恰好使用 {req.max_depth} 级标题层级"
    f"（从 # 到 {'#' * req.max_depth}），每一级都必须有节点。\n\n"
    f"1. 必须严格覆盖 {req.max_depth} 层深度"
    f"6. 最深层级（第 N 层）也必须有至少 3 个叶子节点"
)

# 行 200-208：调用 Hy3 结构化输出
result = self.hy3.chat_with_json(
    messages=[{"role": "system", "content": system_prompt},
              {"role": "user", "content": f"请将以下内容转化为思维导图大纲：\n\n{text}"}],
    json_schema=MINDMAP_SCHEMA,  # 只要一个 markdown 字段
    reasoning_effort="no_think",
)
```

**第二阶段：深度检查 + 补充循环（行 225-258）**

```python
current_depth = self._count_max_depth(raw_md)  # 统计当前最大 # 数
retries = 0
while current_depth < req.max_depth and retries < 2:
    retries += 1
    # 构造"请扩展"的 prompt，带上当前已经生成的内容
    expand_prompt = (
        f"当前思维导图大纲如下，但层级深度不足"
        f"（当前最深 {current_depth} 层，需要恰好 {req.max_depth} 层）：\n\n"
        f"{raw_md}\n\n"
        f"请在现有结构基础上，对每个最底层的叶子节点向下展开..."
    )
    # 再次调用 Hy3
    result2 = self.hy3.chat_with_json(...)
    raw_md = result2.get("markdown", raw_md)
    current_depth = self._count_max_depth(raw_md)
```

**设计思路：** 不信任 LLM 一次就能输出完美结果，用"检查→重试"模式保证输出质量。最多重试 2 次防止死循环。

**第三阶段：Markdown → 树解析（行 285-322）**

```python
def _parse_markdown_to_tree(self, markdown: str) -> MindMapNode:
    # 用栈来维护层级关系
    stack: list[tuple[int, MindMapNode]] = []
    for line in markdown.split("\n"):
        level = 0
        for ch in line:
            if ch == "#": level += 1
            else: break
        node = MindMapNode(id=..., label=line[level:].strip(), children=[])
        if level == 1:
            root = node  # # 开头的行是根节点
            stack = [(1, root)]
        else:
            while stack and stack[-1][0] >= level:
                stack.pop()  # 回退到父级
            stack[-1][1].children.append(node)
            stack.append((level, node))
    return root
```

**算法：** 遍历每行，用 `level`（# 的数量）判断层级。栈顶始终是当前节点的父节点——当遇到同层或上层标题时，弹栈回退到正确的父节点。

### 3.3 知识图谱生成（行 340-409）

相比思维导图简单许多，因为 KG_SCHEMA 是扁平结构（entities 数组 + relations 数组），没有递归。

```python
system_prompt = (
    f"生成 {req.max_nodes} 个左右的实体节点\n"
    "实体类型 category 必须是: concept(概念), person(人物), method(方法/算法), "
    "tool(工具/技术), event(事件)\n"
    "每个实体 id 用 e1, e2, e3... 格式\n"
)
result = self.hy3.chat_with_json(messages=[...], json_schema=KG_SCHEMA,
                                  reasoning_effort="high")
```

### 3.4 节点扩展（行 413-499）——上下文注入

把当前图谱序列化为文本注入 Prompt：

```python
existing_entities_desc = "\n".join(
    f"- {e.id}: {e.name} [{e.category}]" for e in req.current_graph.entities)
existing_relations_desc = "\n".join(
    f"- {r.source} → {r.target}: {r.relation}" for r in req.current_graph.relations)
```

**设计要点：** 把当前图谱状态完整传给 Hy3，让它知道"已有哪些节点"，避免重复生成。新节点 id 用 `ne1, ne2...` 格式区分已有节点。

### 3.5 JSON Schema 设计

四个 Schema 都遵循 OpenAI strict 模式的要求：
- `"additionalProperties": False` —— 不允许多余字段
- `"required"` —— 明确必填字段
- 无 `$ref` / `$defs` —— 避免递归 Schema 兼容性问题

**MINDMAP_SCHEMA（最简洁）：**
```json
{"type": "object", "properties": {"markdown": {"type": "string"}},
 "required": ["markdown"], "additionalProperties": false}
```
只让 Hy3 输出一个 markdown 字符串，后端自己解析为树。这样避免了递归 Schema 在 strict 模式下的兼容性问题（实际开发中曾因 `$defs` 导致 504 超时）。

---

## 4. 后端：API 路由与 SSE

**文件：** `backend/app/api/routes.py`

### 4.1 Headers 注入（行 31-33）

```python
def _apply_headers(req: Request):
    configure_from_headers(dict(req.headers))
```

每个业务端点第一行都调用这个函数，把前端的 API 配置注入到 Hy3Client。

### 4.2 SSE 生成器（行 39-45）

```python
async def sse_generator(gen):
    async for event in gen:
        yield {"event": event.type, "data": event.model_dump_json()}
```

将 Python 的 `AsyncGenerator[ProgressEvent]` 转换为 SSE 格式。FastAPI 的 `EventSourceResponse` 自动处理 HTTP 长连接和 `text/event-stream` Content-Type。

### 4.3 生成端点示例（行 52-64）

```python
@router.post("/mindmap/generate")
async def generate_mindmap(body: MindMapRequest, req: Request):
    _apply_headers(req)
    session_id = str(uuid.uuid4())
    orch = get_orchestrator()
    gen = orch.generate_mindmap(body, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))
```

**流程：** 读 Headers 配置 → 生成 session_id → 调用编排器 → 返回 SSE 流

### 4.4 文件上传端点（行 67-93）

```python
@router.post("/mindmap/generate-from-file")
async def generate_mindmap_from_file(file: UploadFile = File(...),
                                      max_depth: int = Form(4), req: Request = None):
    raw = await file.read()
    text = await parse_bytes(file.filename or "upload", raw)  # 前端解析
    body = MindMapRequest(text=text, max_depth=max_depth)
    gen = orch.generate_mindmap(body, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))
```

**设计：** 文件在前端上传，后端解析为文本后，复用 `generate_mindmap` 流程。

---

## 5. 前端：SSE 客户端

**文件：** `frontend/src/lib/api.ts`

### 5.1 Headers 全局管理（行 8-13）

```typescript
let _apiHeaders: Record<string, string> = {};

export function setApiHeaders(headers: Record<string, string>) {
  _apiHeaders = headers;
}
```

一个简单的模块级变量 + setter。页面初始化时从 localStorage 读取并调用 `setApiHeaders()`，后续所有 fetch 都自动带上。

### 5.2 SSE 流式解析（行 25-77）

```typescript
async function sseRequest(endpoint, body, onEvent, signal) {
  const resp = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ..._apiHeaders },
    body: JSON.stringify(body),
    signal,
  });
  // ...
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";  // 保留不完整的最后一行

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim());
        onEvent(data);  // 回调给调用方处理
      }
    }
  }
}
```

**关键细节——buffer 处理：** SSE 数据是流式到达的，`reader.read()` 可能返回不完整的行。用 `buffer` 缓存不完整行，下次拼接继续处理。`lines.pop()` 取出最后一个可能不完整的片段放回 buffer。

### 5.3 错误处理（行 38-51）

```typescript
if (!resp.ok) {
  const err = await resp.json().catch(() => ({ detail: resp.statusText }));
  let msg = "Unknown error";
  if (typeof err.detail === "string") {
    msg = err.detail;                        // fastapi 通常错误
  } else if (Array.isArray(err.detail)) {
    msg = err.detail.map(d => d.msg).join("; ");  // Pydantic 验证错误
  }
  throw new Error(msg);
}
```

FastAPI 的验证错误 `detail` 是数组格式 `[{loc, msg, type}]`，需要特殊处理才能显示可读的错误信息。

---

## 6. 前端：全局状态管理 page.tsx

**文件：** `frontend/src/app/page.tsx`

### 6.1 状态设计（行 68-84）

```typescript
const [mode, setMode] = useState<"mindmap" | "knowledge-graph">("mindmap");
const [loading, setLoading] = useState(false);
const [progressMsg, setProgressMsg] = useState("");
const [progressVal, setProgressVal] = useState(0);
const [rawMarkdown, setRawMarkdown] = useState<string | null>(null);  // 场景一结果
const [graph, setGraph] = useState<KnowledgeGraph | null>(null);      // 场景二结果
const [settings, setSettings] = useState(loadSettings);               // API 配置
```

**设计：** 两种模式共用 `loading` / `progressMsg` / `progressVal`，但结果存储在不同的 state 中。切换模式不会丢失之前生成的结果。

### 6.2 API 配置持久化（行 30-38, 89-107）

```typescript
function loadSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const raw = localStorage.getItem("mindgraph-settings");
  return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
}

// 页面挂载时初始化 + 保存时更新
React.useEffect(() => {
  const s = loadSettings();
  setApiHeaders({"X-Hy3-Api-Key": s.apiKey, ...});
}, []);

const handleSaveSettings = (s) => {
  setSettings(s);
  localStorage.setItem("mindgraph-settings", JSON.stringify(s));
  setApiHeaders({"X-Hy3-Api-Key": s.apiKey, ...});
};
```

### 6.3 场景一回调（行 130-161）

```typescript
const handleGenerateMindMap = async (text: string, depth: number) => {
  setLoading(true);
  await generateMindMap(text, depth, (event) => {
    handleProgress(event);              // 更新进度条
    if (event.type === "result") {
      setRawMarkdown(event.data.raw_markdown);  // 存结果
      setLoading(false);
    }
    if (event.type === "error") setLoading(false);
  }, abortRef.current.signal);
};
```

**设计：** `onEvent` 回调函数在 SSE 流中每收到一条数据就被调用一次。`type: "progress"` 更新进度文字，`type: "result"` 存最终结果。

### 6.4 节点扩展 + 合并（行 240-286）

```typescript
const handleNodeExpand = async (nodeId, nodeName, currentGraph) => {
  await expandKnowledgeGraphNode(nodeId, nodeName, currentGraph, 8, (event) => {
    if (event.type === "result") {
      // 合并新节点，去重已有 id
      const existingIds = new Set(currentGraph.entities.map(e => e.id));
      const mergedEntities = [
        ...currentGraph.entities,
        ...newEntities.filter(e => !existingIds.has(e.id)),
      ];
      setGraph({ entities: mergedEntities, relations: [...currentGraph.relations, ...newRelations] });
    }
  });
};
```

**关键：** 去重用 `Set`（O(1) 查找），新节点只添加不重复的。关系全部追加不做去重。

### 6.5 AI 建议应用（行 312-357）

支持四种建议类型的自动应用：
- `add_entity`：创建新实体加入 entities 数组
- `add_relation`：创建新关系加入 relations 数组
- `merge_entities`：删除被合并实体，把它的所有关系重定向到保留实体
- `refine_label`：留给用户手动处理

---

## 7. 前端：MindMapView 思维导图

**文件：** `frontend/src/components/MindMapView.tsx`

### 7.1 渲染机制（行 17-43）

```typescript
useEffect(() => {
  if (!svgRef.current || !rawMarkdown) return;

  const transformer = new Transformer();
  const { root } = transformer.transform(rawMarkdown);  // Markdown → 数据树

  if (mmRef.current) mmRef.current.destroy();  // 清理旧实例
  svgRef.current.innerHTML = "";

  mmRef.current = Markmap.create(svgRef.current, {
    autoFit: true, duration: 500, maxWidth: 280,
    initialExpandLevel: 3,  // 初始展开 3 层
  }, root);
}, [rawMarkdown]);
```

**markmap 工作原理：**
1. `Transformer.transform(markdown)` 把 `# ## ###` 格式的文本解析为嵌套数据结构
2. `Markmap.create(svg, options, root)` 渲染到 SVG 元素，生成交互式思维导图
3. 导图本身是 d3.js 驱动的，支持缩放、拖拽、节点点击折叠

### 7.2 展开全部（行 71-95）

```typescript
const _expandAll = () => {
  // 1. 销毁旧实例
  if (mmRef.current) mmRef.current.destroy();

  // 2. 设置最小尺寸防止 d3 zoom 报错
  svgRef.current.setAttribute("width", "2000");
  svgRef.current.setAttribute("height", "1500");

  // 3. 重新创建，initialExpandLevel: 99 强制全展开
  mmRef.current = Markmap.create(svgRef.current, {
    autoFit: false, duration: 0, initialExpandLevel: 99,
  }, root);

  // 4. fit() 让 viewBox 适配内容
  mmRef.current.fit();
};
```

**设计：** 展开全部和普通渲染是两个不同的 markmap 实例。`_expandAll()` 销毁旧实例→创建全展开实例，`_restoreInteractive()` 恢复可交互版本。导出时也是这个模式：展开→导出→恢复。

### 7.3 SVG 导出（行 119-141）

```typescript
const handleExportSVG = () => {
  _expandAll();  // 先展开全部节点
  setTimeout(() => {
    const svgStr = new XMLSerializer().serializeToString(svgRef.current);  // 序列化
    const fullSvg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE svg PUBLIC "...">\n' + svgStr;  // 添加 XML 声明
    const blob = new Blob([fullSvg], { type: "image/svg+xml;charset=utf-8" });
    // 下载...
    setTimeout(() => _restoreInteractive(), 200);  // 恢复交互视图
  }, 500);  // 等待渲染完成
};
```

### 7.4 PDF 导出（行 143-156）

```typescript
const handleExportPDF = () => {
  _expandAll();  // 展开全部
  setTimeout(() => {
    window.print();  // 浏览器原生打印 → 用户选"另存为 PDF"
    setTimeout(() => _restoreInteractive(), 800);
  }, 600);
};
```

**设计：** 不折腾 Canvas/jsPDF，直接用浏览器打印。配合 `globals.css` 中的 `@media print` 规则隐藏 UI、A4 横版布局。

---

## 8. 前端：KnowledgeGraphView 知识图谱

**文件：** `frontend/src/components/KnowledgeGraphView.tsx`

### 8.1 Dagre 自动布局（行 72-129）

```typescript
function layoutGraph(entities, relations): { nodes, edges } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 70, ranksep: 100 });  // 从上到下

  for (const e of entities) {
    g.setNode(e.id, { width: 160, height: 50 });
  }
  for (const r of relations) {
    g.setEdge(r.source, r.target);
  }

  dagre.layout(g);  // 计算每个节点的坐标

  // 把 dagre 计算结果转为 ReactFlow Node 格式
  const nodes = entities.map(e => {
    const pos = g.node(e.id);
    return {
      id: e.id,
      position: { x: pos.x - 80, y: pos.y - 25 },  // 居中偏移
      data: { label: <div styled-by-category>{e.name}</div>, entity: e },
    };
  });
  // ...
}
```

**算法：** dagre 是分层图布局算法。设置 `rankdir: "TB"`（从上到下），`nodesep` 控制同层节点间距，`ranksep` 控制层间距。dagre 计算每个节点的 `(x, y)` 后又做了一个偏移 (`-width/2, -height/2`)，因为 dagre 返回的是中心点而 ReactFlow 期望左上角。

### 8.2 分类着色（行 60-68）

```typescript
const CATEGORY_STYLES = {
  concept: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },  // 蓝色
  person:  { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" },  // 粉色
  method:  { bg: "#d1fae5", border: "#10b981", text: "#065f46" },  // 绿色
  tool:    { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },  // 黄色
  event:   { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b3" },  // 紫色
};
```

五种实体类型用不同颜色区分，直观展示知识图谱的结构。

### 8.3 FloatingEdge 自定义边（行 133-187）

```typescript
function FloatingEdge({ sourceX, sourceY, targetX, targetY, label, ... }) {
  const [edgePath] = getBezierPath({ ... });  // ReactFlow 计算贝塞尔曲线
  const [hovered, setHovered] = useState(false);

  return (
    <>
      <BaseEdge path={edgePath} style={{ strokeWidth: hovered ? 2.5 : 1.5 }} />
      {/* 透明的宽路径用于扩大 hover 检测区域 */}
      <path d={edgePath} stroke="transparent" strokeWidth={15} onMouseEnter={...} />
      {/* 关系标签悬浮在外层 */}
      {label && <foreignObject ...>{label}</foreignObject>}
    </>
  );
}
```

**设计：** ReactFlow 边的 hover 检测只作用于实际路径（1.5px 宽），很难点到。加一条透明的宽路径（15px）作为 hover 热区。关系标签用 `foreignObject` 渲染 HTML（支持圆角、阴影等 CSS 效果）。

### 8.4 节点点击展开（行 246-270）

```typescript
const onNodeClick = (_event, node) => {
  if (expanding) return;                              // 防止重复点击
  const entity = node.data?.entity;
  if (!entity || expandedNodes.has(entity.id)) return; // 每个节点只展开一次

  setExpandedNodes(prev => new Set(prev).add(entity.id));

  // 构造当前图谱快照
  const currentGraph = {
    entities: nodes.map(n => n.data?.entity).filter(Boolean),
    relations: edges.map(e => ({ source: e.source, target: e.target, relation: e.label })),
  };
  onNodeExpand(entity.id, entity.name, currentGraph);  // 调用 parent 回调
};
```

**关键：** `expandedNodes` Set 记录已展开的节点，防止重复展开。每次点击把当前完整图谱状态传给 parent，由 parent 调用 API 扩展。

---

## 9. 前端：InputPanel + SettingsModal

### 9.1 深度选择器（行 113-143）

```tsx
<input type="range" min={1} max={15} value={depth} />
<input type="number" min={1} max={20} value={depth}
  onChange={e => setDepth(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
```

**设计：** 滑块 + 数字输入的组合——滑块提供直观的快速选择（1-15），数字输入支持精确输入（1-20）。`Math.max(1, Math.min(20, ...))` 做边界夹持，防止用户输入非法值。

### 9.2 双模式切换（行 62-182）

同一个 `InputPanel` 组件根据 `mode` prop 渲染不同的表单：
- `mode === "mindmap"`：textarea + 文件上传 + 深度选择器
- `mode === "knowledge-graph"`：关键词输入框 + 节点数量滑块

**设计：** 而不是两个独立组件——因为 UI 布局（卡片容器、提交按钮）完全一致，只是中间的表单项不同。用条件渲染复用外层结构。

### 9.3 SettingsModal（行 1-95）

```tsx
const handleSave = () => {
  onSave({ apiKey, baseUrl, model });  // 回调给 parent → localStorage + setApiHeaders()
  setSaved(true);
  setTimeout(() => { setSaved(false); onClose(); }, 800);  // 显示"已保存"0.8 秒后关闭
};
```

**设计：** 保存后按钮短暂变绿显示"✓ 已保存"（视觉反馈），然后自动关闭弹窗。API Key 用 `type="password"` 掩码显示。

---

## 附录：关键技术决策

| 决策 | 原因 |
|------|------|
| Markdown 而非递归 JSON 做思维导图 | 递归 `$defs` Schema 导致 Hy3 strict 模式 504 超时；Markdown 是线性字符串，Schema 极简，速度快 10 倍 |
| SSE 而非 WebSocket | 数据流是单向的（后端→前端），SSE 比 WebSocket 更轻量，原生支持自动重连 |
| 前端配置 API Key 而非 `.env` | 方便演示（不同用户不同 Key）、方便调试（随时切换）、Key 存在浏览器本地不经过服务器 |
| Dagre 而非 D3-force 做图谱布局 | 知识图谱需要稳定的层级结构，dagre 的分层布局比力导向图更可预测 |
| `window.print()` 而非 jsPDF 做 PDF | markmap SVG 含 `foreignObject`，Canvas 渲染会 taint；浏览器原生打印最可靠 |
| 深度保证用循环重试而非一次搞定 | LLM 输出不可控，检查→重试模式比调 prompt 更有效 |