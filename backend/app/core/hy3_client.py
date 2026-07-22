"""
Hy3 API Client — 封装腾讯混元 Hy3 大模型 API 调用
支持:
  - 快慢思考模式 (no_think / low / high)
  - 结构化输出 (JSON Schema)
  - Prompt Cache (X-Session-ID)
  - Function Calling (预留)
"""

import json
import logging
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from openai import OpenAI

# Load .env from backend directory (belt-and-suspenders)
_env_path = Path(__file__).parent.parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

logger = logging.getLogger(__name__)


class Hy3Client:
    """Hy3 大模型 API 统一封装 (OpenAI 兼容协议)"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.api_key = api_key or ""
        self.base_url = base_url or "https://tokenhub.tencentmaas.com/v1"
        self.model = model or "hy3"

        if not self.api_key:
            raise ValueError("API Key 未配置，请在前端设置面板中填写 API Key。")

        # Force direct connection (bypass system/env proxy), extend timeout for long Hy3 responses
        http_client = httpx.Client(trust_env=False, timeout=180.0)
        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            http_client=http_client,
        )
        logger.info(f"Hy3Client initialized: model={self.model}, base_url={self.base_url}")

    def chat(
        self,
        messages: list[dict],
        *,
        reasoning_effort: str = "no_think",
        temperature: float = 0.9,
        top_p: float = 1.0,
        max_tokens: int = 8192,
        json_schema: Optional[dict] = None,
        session_id: Optional[str] = None,
        prompt_cache_key: Optional[str] = None,
    ) -> str:
        """
        通用对话调用

        Args:
            messages: 对话消息列表
            reasoning_effort: 思考模式 — "no_think" | "low" | "high"
            temperature: 采样温度
            top_p: nucleus 采样
            max_tokens: 最大输出 token
            json_schema: 传入 JSON Schema dict 启用结构化输出
            session_id: X-Session-ID，用于 Prompt Cache
            prompt_cache_key: Prompt Cache 键

        Returns:
            模型回复文本 (若启用 json_schema 则为 JSON 字符串)
        """
        extra_body = {
            "chat_template_kwargs": {"reasoning_effort": reasoning_effort}
        }
        if prompt_cache_key:
            extra_body["prompt_cache_key"] = prompt_cache_key

        extra_headers = {}
        if session_id:
            extra_headers["X-Session-ID"] = session_id

        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "extra_body": extra_body,
            "extra_headers": extra_headers if extra_headers else None,
        }

        if json_schema is not None:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "structured_output",
                    "schema": json_schema,
                    "strict": True,
                },
            }

        # Remove None-valued kwargs
        kwargs = {k: v for k, v in kwargs.items() if v is not None}

        logger.debug(f"Hy3 chat request: model={self.model}, reasoning={reasoning_effort}, "
                      f"tokens={max_tokens}, has_schema={json_schema is not None}")

        response = self.client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content or ""

        return content

    def chat_with_json(
        self,
        messages: list[dict],
        json_schema: dict,
        *,
        reasoning_effort: str = "no_think",
        session_id: Optional[str] = None,
    ) -> dict:
        """
        调用并解析 JSON 结构化输出

        Args:
            messages: 对话消息
            json_schema: JSON Schema 定义
            reasoning_effort: 思考模式
            session_id: 会话 ID (用于 Prompt Cache)

        Returns:
            解析后的 dict
        """
        raw = self.chat(
            messages=messages,
            reasoning_effort=reasoning_effort,
            json_schema=json_schema,
            max_tokens=16384,
            session_id=session_id,
        )
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse JSON from Hy3 response, raw preview: {raw[:500]}")
            # Attempt to extract JSON from markdown code blocks
            if "```json" in raw:
                block = raw.split("```json")[1].split("```")[0].strip()
                return json.loads(block)
            if "```" in raw:
                block = raw.split("```")[1].split("```")[0].strip()
                return json.loads(block)
            raise ValueError(f"Hy3 returned unparseable response: {raw[:200]}")


# ── Singleton with header override support ──

_hy3_client: Optional[Hy3Client] = None
_custom_config: dict = {}


def configure_from_headers(headers: dict):
    """根据前端传来的 headers 覆盖 API 配置（仅当值非空时）"""
    global _custom_config
    _custom_config = {}
    api_key = headers.get("x-hy3-api-key", "").strip()
    base_url = headers.get("x-hy3-base-url", "").strip()
    model = headers.get("x-hy3-model", "").strip()
    if api_key:
        _custom_config["api_key"] = api_key
    if base_url:
        _custom_config["base_url"] = base_url
    if model:
        _custom_config["model"] = model


def get_hy3_client() -> Hy3Client:
    """获取 Hy3Client（必须由前端 headers 提供 API Key）"""
    global _hy3_client, _custom_config
    if not _custom_config.get("api_key"):
        raise ValueError("API Key 未配置，请在前端设置面板中填写 API Key。")
    _hy3_client = Hy3Client(**_custom_config)
    return _hy3_client
