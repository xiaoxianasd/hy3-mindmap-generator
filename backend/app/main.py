"""
MindGraph AI — FastAPI Application Entry Point
基于腾讯混元 Hy3 大模型的知识图谱 & 思维导图自动生成器
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend directory
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router

# ── Logging ──

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── App ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("MindGraph AI backend starting...")
    yield
    logger.info("MindGraph AI backend shutting down...")


app = FastAPI(
    title="MindGraph AI",
    description="基于腾讯混元 Hy3 的知识图谱 & 思维导图自动生成器",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — 允许前端跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境请限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


# ── Entry ──

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
