from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ── Scene 1: Mind Map (Text → Hierarchical Tree) ──

class MindMapRequest(BaseModel):
    text: str = Field(..., description="输入文本，如论文摘要或技术文档")
    max_depth: int = Field(default=4, ge=1, le=20, description="思维导图最大深度")


class MindMapNode(BaseModel):
    id: str
    label: str
    children: list["MindMapNode"] = Field(default_factory=list)
    detail: Optional[str] = Field(None, description="节点补充说明")


class MindMapResponse(BaseModel):
    tree: MindMapNode
    raw_markdown: str = Field("", description="用于渲染思维导图的 markdown 格式")


# ── Scene 2: Knowledge Graph (Keyword → Entity-Relation Graph) ──

class KGGenerateRequest(BaseModel):
    keyword: str = Field(..., description="主题关键词，如'量子计算'")
    max_nodes: int = Field(default=15, ge=5, le=50, description="图最大节点数")


class KGEntity(BaseModel):
    id: str
    name: str
    category: str = Field("concept", description="实体类型: concept | person | method | tool | event")


class KGRelation(BaseModel):
    source: str  # entity id
    target: str  # entity id
    relation: str  # 关系描述


class KnowledgeGraph(BaseModel):
    entities: list[KGEntity]
    relations: list[KGRelation]


class KGExpandRequest(BaseModel):
    node_id: str
    node_name: str
    current_graph: KnowledgeGraph
    max_new_nodes: int = Field(default=8, ge=3, le=20)


class KGExpandResponse(BaseModel):
    new_entities: list[KGEntity]
    new_relations: list[KGRelation]  # 可能连接到已有节点也可能是新节点间的关系


# ── User Edit → AI Suggestion ──

class KGSuggestRequest(BaseModel):
    current_graph: KnowledgeGraph  # 用户修改后的完整图谱
    focus: Optional[str] = Field(None, description="用户关注的节点名称，不传则全局建议")


class KGSuggestion(BaseModel):
    suggestion_type: str = Field(..., description="add_entity | add_relation | merge_entities | refine_label")
    description: str  # 用自然语言描述的建议
    proposed_change: Optional[dict] = Field(None, description="具体的修改动作")


class KGSuggestResponse(BaseModel):
    suggestions: list[KGSuggestion]


# ── Common ──

class ProgressEvent(BaseModel):
    type: str  # "progress" | "result" | "error"
    phase: str  # "parsing" | "generating" | "done"
    message: str
    progress: float = 0.0  # 0-1
    data: Optional[dict] = None


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
