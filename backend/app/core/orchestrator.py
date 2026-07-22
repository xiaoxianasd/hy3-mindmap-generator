"""
MindGraph Orchestrator — 核心编排逻辑

负责:
  - Scene 1: 长文本 → 思维导图层级树
  - Scene 2: 关键词 → 知识图谱 (实体+关系)
  - Scene 2b: 节点下钻 → 扩展图谱
  - Scene 2c: 用户编辑 → AI 建议/补全
"""

import logging
import uuid
from typing import AsyncGenerator

from app.core.hy3_client import get_hy3_client
from app.models.schemas import (
    MindMapRequest, MindMapNode, MindMapResponse,
    KGGenerateRequest, KGEntity, KGRelation, KnowledgeGraph,
    KGExpandRequest, KGExpandResponse,
    KGSuggestRequest, KGSuggestion, KGSuggestResponse,
    ProgressEvent,
)

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════
#  JSON Schemas for Hy3 Structured Output
# ═══════════════════════════════════════════════════════════

MINDMAP_SCHEMA = {
    "type": "object",
    "properties": {
        "markdown": {
            "type": "string",
            "description": "Markdown 格式的思维导图大纲，用 # ## ### #### 表示层级"
        },
    },
    "required": ["markdown"],
    "additionalProperties": False,
}


KG_SCHEMA = {
    "type": "object",
    "properties": {
        "entities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": ["concept", "person", "method", "tool", "event"],
                    },
                },
                "required": ["id", "name", "category"],
                "additionalProperties": False,
            },
        },
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "relation": {"type": "string"},
                },
                "required": ["source", "target", "relation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["entities", "relations"],
    "additionalProperties": False,
}


EXPAND_SCHEMA = {
    "type": "object",
    "properties": {
        "new_entities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": ["concept", "person", "method", "tool", "event"],
                    },
                },
                "required": ["id", "name", "category"],
                "additionalProperties": False,
            },
        },
        "new_relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "relation": {"type": "string"},
                },
                "required": ["source", "target", "relation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["new_entities", "new_relations"],
    "additionalProperties": False,
}


SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "suggestion_type": {
                        "type": "string",
                        "enum": ["add_entity", "add_relation", "merge_entities", "refine_label"],
                    },
                    "description": {"type": "string"},
                    "proposed_change": {"type": "object"},
                },
                "required": ["suggestion_type", "description"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


# ═══════════════════════════════════════════════════════════
#  Orchestrator
# ═══════════════════════════════════════════════════════════

class MindGraphOrchestrator:
    """MindGraph 核心编排器"""

    def __init__(self):
        pass

    @property
    def hy3(self):
        return get_hy3_client()

    # ── Scene 1: Text → Mind Map ──

    async def generate_mindmap(
        self, req: MindMapRequest, session_id: str = ""
    ) -> AsyncGenerator[ProgressEvent, None]:
        """
        从长文本生成思维导图

        Args:
            req: 包含文本和最大深度
            session_id: 会话 ID 用于 Prompt Cache

        Yields:
            ProgressEvent 流式进度事件
        """
        yield ProgressEvent(
            type="progress", phase="parsing",
            message="正在分析文本结构...", progress=0.1,
        )

        text = req.text.strip()

        # Truncate if needed (Hy3 256K context — plenty of room)
        if len(text) > 120000:
            text = text[:120000] + "\n\n[已截断超长文本...]"

        system_prompt = (
            "你是一位知识结构化专家。请将用户提供的文本内容转化为 Markdown 格式的思维导图大纲。\n\n"
            f"核心要求：必须恰好使用 {req.max_depth} 级标题层级（从 # 到 {'#' * req.max_depth}），每一级都必须有节点。\n\n"
            "规则：\n"
            f"1. 必须严格覆盖 {req.max_depth} 层深度。例如 max_depth=5 则需要 # → ## → ### → #### → ##### 五个层级\n"
            "2. 每个节点文字不超过 25 个字，简洁明了\n"
            "3. 根节点（#）应为全文的核心主题\n"
            "4. 同级节点按逻辑分组排列，保持语义独立性\n"
            "5. 每个父节点下至少有 2 个子节点\n"
            "6. 最深层级（第 N 层）也必须有至少 3 个叶子节点\n\n"
            "请严格按 JSON Schema 输出，markdown 字段中只输出 Markdown 格式大纲。"
        )

        yield ProgressEvent(
            type="progress", phase="generating",
            message="Hy3 正在生成思维导图层级结构...", progress=0.3,
        )

        try:
            result = self.hy3.chat_with_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"请将以下内容转化为思维导图大纲（Markdown 格式）：\n\n{text}"},
                ],
                json_schema=MINDMAP_SCHEMA,
                reasoning_effort="no_think",  # 快速响应，结构化输出足够约束
                session_id=session_id,
            )
        except Exception as e:
            logger.error(f"Hy3 mindmap generation failed: {e}")
            yield ProgressEvent(
                type="error", phase="generating",
                message=f"生成失败: {str(e)}", progress=0.0,
            )
            return

        yield ProgressEvent(
            type="progress", phase="generating",
            message="思维导图生成完成，正在格式化...", progress=0.85,
        )

        raw_md = result.get("markdown", "")

        # ── Depth enforcement: if generated depth < requested, expand ──
        current_depth = self._count_max_depth(raw_md)
        retries = 0
        while current_depth < req.max_depth and retries < 2:
            retries += 1
            logger.info(f"Mindmap depth {current_depth} < requested {req.max_depth}, expanding (retry {retries})...")

            yield ProgressEvent(
                type="progress", phase="generating",
                message=f"正在补充第 {current_depth + 1} 层细节...", progress=0.5 + retries * 0.15,
            )

            expand_prompt = (
                f"当前思维导图大纲如下，但层级深度不足（当前最深 {current_depth} 层，需要恰好 {req.max_depth} 层）：\n\n"
                f"{raw_md}\n\n"
                f"请在现有结构基础上，对每个最底层的叶子节点向下展开，增加 {'#' * (current_depth + 1)} 甚至 "
                f"{'#' * req.max_depth} 级别的子节点，使整个大纲达到恰好 {req.max_depth} 层深度。"
                f"保持原有节点不变，只在叶子节点下添加新的子层级。"
            )

            try:
                result2 = self.hy3.chat_with_json(
                    messages=[
                        {"role": "system", "content": expand_prompt},
                        {"role": "user", "content": f"请将以上大纲扩展到 {req.max_depth} 层深度，补充更细粒度的子节点。"},
                    ],
                    json_schema=MINDMAP_SCHEMA,
                    reasoning_effort="no_think",
                    session_id=session_id,
                )
                raw_md = result2.get("markdown", raw_md)
                current_depth = self._count_max_depth(raw_md)
            except Exception as e:
                logger.warning(f"Depth expansion failed: {e}")
                break  # Keep the best result we have

        # Parse markdown headings into tree
        tree = self._parse_markdown_to_tree(raw_md)

        yield ProgressEvent(
            type="result", phase="done",
            message="思维导图已就绪",
            progress=1.0,
            data=MindMapResponse(tree=tree, raw_markdown=raw_md).model_dump(),
        )

    def _count_max_depth(self, markdown: str) -> int:
        """统计 Markdown 中的最大标题深度"""
        max_depth = 0
        for line in markdown.strip().split("\n"):
            line = line.strip()
            if line.startswith("#"):
                depth = 0
                for ch in line:
                    if ch == "#":
                        depth += 1
                    else:
                        break
                max_depth = max(max_depth, depth)
        return max_depth

    def _parse_markdown_to_tree(self, markdown: str) -> MindMapNode:
        """从 Markdown 大纲解析为树结构"""
        root_id = str(uuid.uuid4())[:8]
        root = MindMapNode(id=root_id, label="Root", children=[])

        stack: list[tuple[int, MindMapNode]] = []  # (level, node)

        for line in markdown.strip().split("\n"):
            line = line.strip()
            if not line or not line.startswith("#"):
                continue

            # Count heading level
            level = 0
            for ch in line:
                if ch == "#":
                    level += 1
                else:
                    break
            label = line[level:].strip()
            if not label:
                continue

            node = MindMapNode(id=str(uuid.uuid4())[:8], label=label, children=[])

            if level == 1:
                # Root node — replace placeholder
                root = MindMapNode(id=str(uuid.uuid4())[:8], label=label, children=[])
                stack = [(1, root)]
            elif stack:
                # Pop until we find a parent at level-1
                while stack and stack[-1][0] >= level:
                    stack.pop()
                if stack:
                    stack[-1][1].children.append(node)
                stack.append((level, node))

        return root

    def _build_tree_node(self, data: dict, depth: int = 0) -> MindMapNode:
        """递归构建树节点"""
        node_id = str(uuid.uuid4())[:8]
        children = [
            self._build_tree_node(c, depth + 1)
            for c in data.get("children", [])
        ]
        return MindMapNode(
            id=node_id,
            label=data.get("label", ""),
            children=children,
            detail=data.get("detail"),
        )

    # ── Scene 2a: Keyword → Knowledge Graph ──

    async def generate_knowledge_graph(
        self, req: KGGenerateRequest, session_id: str = ""
    ) -> AsyncGenerator[ProgressEvent, None]:
        """
        从主题关键词生成知识图谱

        Args:
            req: 包含关键词和最大节点数
            session_id: 会话 ID

        Yields:
            ProgressEvent 流
        """
        yield ProgressEvent(
            type="progress", phase="parsing",
            message=f"正在分析关键词: {req.keyword}...", progress=0.1,
        )

        system_prompt = (
            "你是一位知识图谱专家。请根据用户给出的主题关键词，构建该领域的知识图谱。\n\n"
            "规则：\n"
            f"1. 生成 {req.max_nodes} 个左右的实体节点\n"
            "2. 实体类型 category 必须是: concept(概念), person(人物), method(方法/算法), tool(工具/技术), event(事件)\n"
            "3. 关系 relation 用简洁中文描述（如'核心组件'、'提出者'、'应用领域'、'依赖关系'等）\n"
            "4. 每个实体 id 用 e1, e2, e3... 格式\n"
            "5. 图谱应覆盖该领域的核心概念、关键人物、重要方法、代表性工具\n"
            "6. 关系应有逻辑，形成有意义的网络结构而非简单的列表\n\n"
            "请严格按 JSON Schema 输出。"
        )

        yield ProgressEvent(
            type="progress", phase="generating",
            message=f"Hy3 正在构建'{req.keyword}'的知识图谱...", progress=0.3,
        )

        try:
            result = self.hy3.chat_with_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"请为主题'{req.keyword}'构建知识图谱。"},
                ],
                json_schema=KG_SCHEMA,
                reasoning_effort="high",
                session_id=session_id,
            )
        except Exception as e:
            logger.error(f"Hy3 KG generation failed: {e}")
            yield ProgressEvent(
                type="error", phase="generating",
                message=f"生成失败: {str(e)}", progress=0.0,
            )
            return

        entities = [
            KGEntity(id=e["id"], name=e["name"], category=e.get("category", "concept"))
            for e in result.get("entities", [])
        ]
        relations = [
            KGRelation(source=r["source"], target=r["target"], relation=r["relation"])
            for r in result.get("relations", [])
        ]

        kg = KnowledgeGraph(entities=entities, relations=relations)

        yield ProgressEvent(
            type="result", phase="done",
            message=f"知识图谱生成完成: {len(entities)} 个实体, {len(relations)} 条关系",
            progress=1.0,
            data=kg.model_dump(),
        )

    # ── Scene 2b: Node → Expand ──

    async def expand_node(
        self, req: KGExpandRequest, session_id: str = ""
    ) -> AsyncGenerator[ProgressEvent, None]:
        """
        点击节点后展开——补充该节点的关联子图

        Args:
            req: 包含目标节点和当前完整图
            session_id: 会话 ID

        Yields:
            ProgressEvent 流，结果中的新节点/关系需要合并到原图
        """
        yield ProgressEvent(
            type="progress", phase="parsing",
            message=f"正在深入分析节点: {req.node_name}...", progress=0.1,
        )

        # Serialize current graph context
        existing_entities_desc = "\n".join(
            f"- {e.id}: {e.name} [{e.category}]"
            for e in req.current_graph.entities
        )
        existing_relations_desc = "\n".join(
            f"- {r.source} → {r.target}: {r.relation}"
            for r in req.current_graph.relations
        )

        system_prompt = (
            "你是一位知识图谱专家。用户正在探索知识图谱的某个节点，需要你为该节点生成更详细的关联子图。\n\n"
            "规则：\n"
            f"1. 围绕节点'{req.node_name}'（ID: {req.node_id}），生成 {req.max_new_nodes} 个左右的新实体\n"
            "2. 新实体与目标节点直接相关，且可能彼此相关\n"
            "3. 新实体 id 使用 ne1, ne2, ne3... 格式\n"
            "4. 关系可以连接到已有实体（用已有实体 id）也可以在新实体之间\n"
            "5. 不要重复已有图谱中存在的实体\n\n"
            "请严格按 JSON Schema 输出。"
        )

        user_msg = (
            f"目标节点: {req.node_name} (ID: {req.node_id})\n\n"
            f"当前图谱已有实体:\n{existing_entities_desc}\n\n"
            f"当前图谱已有关系:\n{existing_relations_desc}\n\n"
            f"请为'{req.node_name}'生成更深层次的关联子图。"
        )

        yield ProgressEvent(
            type="progress", phase="generating",
            message=f"Hy3 正在扩展'{req.node_name}'的关联信息...", progress=0.3,
        )

        try:
            result = self.hy3.chat_with_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                json_schema=EXPAND_SCHEMA,
                reasoning_effort="high",
                session_id=session_id,
            )
        except Exception as e:
            logger.error(f"Hy3 node expansion failed: {e}")
            yield ProgressEvent(
                type="error", phase="generating",
                message=f"扩展失败: {str(e)}", progress=0.0,
            )
            return

        new_entities = [
            KGEntity(id=e["id"], name=e["name"], category=e.get("category", "concept"))
            for e in result.get("new_entities", [])
        ]
        new_relations = [
            KGRelation(source=r["source"], target=r["target"], relation=r["relation"])
            for r in result.get("new_relations", [])
        ]

        yield ProgressEvent(
            type="result", phase="done",
            message=f"节点'{req.node_name}'扩展完成: +{len(new_entities)} 实体, +{len(new_relations)} 关系",
            progress=1.0,
            data=KGExpandResponse(
                new_entities=new_entities,
                new_relations=new_relations,
            ).model_dump(),
        )

    # ── Scene 2c: User Edit → AI Suggestion ──

    async def suggest_improvements(
        self, req: KGSuggestRequest, session_id: str = ""
    ) -> AsyncGenerator[ProgressEvent, None]:
        """
        用户手动修改图谱后，请求 AI 给出改进建议

        Args:
            req: 包含用户当前图谱状态
            session_id: 会话 ID

        Yields:
            ProgressEvent 流，结果为建议列表
        """
        yield ProgressEvent(
            type="progress", phase="parsing",
            message="正在分析当前图谱结构...", progress=0.1,
        )

        entities_desc = "\n".join(
            f"- {e.id}: {e.name} [{e.category}]"
            for e in req.current_graph.entities
        )
        relations_desc = "\n".join(
            f"- {r.source} → {r.target}: {r.relation}"
            for r in req.current_graph.relations
        )

        focus_line = f"\n\n用户当前关注的节点: {req.focus}" if req.focus else ""

        system_prompt = (
            "你是一位知识图谱质量审核专家。请检查用户的知识图谱，给出改进建议。\n\n"
            "建议类型 suggestion_type:\n"
            "- add_entity: 建议添加缺失的重要实体\n"
            "- add_relation: 建议补充实体间的关系\n"
            "- merge_entities: 发现可能重复的实体，建议合并\n"
            "- refine_label: 建议优化某个实体或关系的标签\n\n"
            "规则：\n"
            "1. 只给出有实际价值的建议，不要凑数\n"
            "2. proposed_change 字段给出具体的修改动作（如要添加的实体名/关系等）\n"
            "3. 建议应有助于完善图谱的逻辑性和完整性\n\n"
            "请严格按 JSON Schema 输出。"
        )

        user_msg = (
            f"当前图谱实体:\n{entities_desc}\n\n"
            f"当前图谱关系:\n{relations_desc}"
            f"{focus_line}\n\n"
            "请分析并给出改进建议。"
        )

        yield ProgressEvent(
            type="progress", phase="generating",
            message="Hy3 正在分析图谱质量，生成改进建议...", progress=0.3,
        )

        try:
            result = self.hy3.chat_with_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                json_schema=SUGGEST_SCHEMA,
                reasoning_effort="high",
                session_id=session_id,
            )
        except Exception as e:
            logger.error(f"Hy3 suggestion failed: {e}")
            yield ProgressEvent(
                type="error", phase="generating",
                message=f"生成建议失败: {str(e)}", progress=0.0,
            )
            return

        suggestions = [
            KGSuggestion(
                suggestion_type=s["suggestion_type"],
                description=s["description"],
                proposed_change=s.get("proposed_change"),
            )
            for s in result.get("suggestions", [])
        ]

        yield ProgressEvent(
            type="result", phase="done",
            message=f"生成 {len(suggestions)} 条改进建议",
            progress=1.0,
            data=KGSuggestResponse(suggestions=suggestions).model_dump(),
        )


# ── Singleton ──

_orchestrator: MindGraphOrchestrator | None = None


def get_orchestrator() -> MindGraphOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = MindGraphOrchestrator()
    return _orchestrator
