"""
URL Content Fetcher — 抓取网页文本内容
"""

import logging
from typing import Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


async def fetch_url(url: str, timeout: int = 15) -> str:
    """
    抓取网页并提取正文

    Args:
        url: 网页 URL
        timeout: 超时秒数

    Returns:
        提取的文本内容 (≤ 16000 chars)
    """
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers=HEADERS,
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")

    # Remove script/style/nav/footer
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()

    text = soup.get_text("\n", strip=True)

    # Clean up excessive whitespace
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    text = "\n".join(lines)

    # Truncate to reasonable length for Hy3 context
    if len(text) > 16000:
        text = text[:16000] + "\n\n[内容已截断...]"

    logger.info(f"Fetched URL '{url[:60]}': {len(text)} chars")
    return text


async def fetch_title(url: str, timeout: int = 10) -> Optional[str]:
    """抓取网页标题"""
    try:
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=True, headers=HEADERS
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        return soup.title.string.strip() if soup.title else None
    except Exception:
        return None
