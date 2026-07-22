"""
MindGraph API Routes — FastAPI 路由 + SSE 流式推送
"""

import json
import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.core.hy3_client import configure_from_headers
from app.core.orchestrator import get_orchestrator
from app.models.schemas import (
    MindMapRequest, MindMapResponse,
    KGGenerateRequest, KnowledgeGraph,
    KGExpandRequest, KGExpandResponse,
    KGSuggestRequest, KGSuggestResponse,
    ProgressEvent, ErrorResponse,
)
from app.tools.document import parse_bytes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# ── Helpers ──

def _apply_headers(req: Request):
    """将前端传来的 API 配置 headers 应用到 Hy3Client"""
    configure_from_headers(dict(req.headers))

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


async def sse_generator(gen):
    """将 AsyncGenerator[ProgressEvent] 转为 SSE 事件流"""
    async for event in gen:
        yield {
            "event": event.type,
            "data": event.model_dump_json(),
        }


# ═══════════════════════════════════════════
#  Scene 1: Mind Map
# ═══════════════════════════════════════════

@router.post("/mindmap/generate")
async def generate_mindmap(body: MindMapRequest, req: Request):
    """
    长文本 → 思维导图 (SSE 流式)

    输入: { text: "...", max_depth: 4 }
    输出: SSE 事件流, 最终事件包含 MindMapResponse
    """
    _apply_headers(req)
    session_id = str(uuid.uuid4())
    orch = get_orchestrator()
    gen = orch.generate_mindmap(body, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))


@router.post("/mindmap/generate-from-file")
async def generate_mindmap_from_file(
    file: UploadFile = File(...),
    max_depth: int = Form(4),
    req: Request = None,
):
    """
    文件上传 → 思维导图 (SSE 流式)

    支持 PDF / DOCX / TXT / Markdown
    """
    if req: _apply_headers(req)
    # Save and parse
    raw = await file.read()
    try:
        text = await parse_bytes(file.filename or "upload", raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if len(text.strip()) < 50:
        raise HTTPException(status_code=400, detail="文档内容过短，请提供更丰富的文本")

    req = MindMapRequest(text=text, max_depth=max_depth)
    session_id = str(uuid.uuid4())
    orch = get_orchestrator()
    gen = orch.generate_mindmap(req, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))


# ═══════════════════════════════════════════
#  Scene 2: Knowledge Graph
# ═══════════════════════════════════════════

@router.post("/knowledge-graph/generate")
async def generate_knowledge_graph(body: KGGenerateRequest, req: Request):
    """
    关键词 → 知识图谱 (SSE 流式)

    输入: { keyword: "...", max_nodes: 15 }
    输出: SSE 事件流, 最终事件包含 KnowledgeGraph
    """
    _apply_headers(req)
    session_id = str(uuid.uuid4())
    orch = get_orchestrator()
    gen = orch.generate_knowledge_graph(body, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))


@router.post("/knowledge-graph/expand")
async def expand_knowledge_graph_node(body: KGExpandRequest, req: Request):
    """
    节点下钻 → 扩展子图 (SSE 流式)

    输入: { node_id: "...", node_name: "...", current_graph: {...}, max_new_nodes: 8 }
    输出: SSE 事件流, 最终事件包含 KGExpandResponse
    """
    _apply_headers(req)
    session_id = str(uuid.uuid4())
    orch = get_orchestrator()
    gen = orch.expand_node(body, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))


@router.post("/knowledge-graph/suggest")
async def suggest_graph_improvements(body: KGSuggestRequest, req: Request):
    """
    用户编辑后 → AI 改进建议 (SSE 流式)

    输入: { current_graph: {...}, focus?: "节点名" }
    输出: SSE 事件流, 最终事件包含 KGSuggestResponse
    """
    _apply_headers(req)
    session_id = str(uuid.uuid4())
    orch = get_orchestrator()
    gen = orch.suggest_improvements(body, session_id=session_id)
    return EventSourceResponse(sse_generator(gen))


# ═══════════════════════════════════════════
#  File Upload Helper
# ═══════════════════════════════════════════

@router.post("/upload/parse")
async def upload_and_parse(file: UploadFile = File(...)):
    """
    上传文件并解析为纯文本 (用于后续生成)

    返回: { "filename": "...", "text": "...", "char_count": 123 }
    """
    raw = await file.read()
    try:
        text = await parse_bytes(file.filename or "upload", raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "filename": file.filename,
        "text": text,
        "char_count": len(text),
    }


# ═══════════════════════════════════════════
#  Health Check
# ═══════════════════════════════════════════

@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "MindGraph AI"}
