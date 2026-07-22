"""
Document Parser — 支持 PDF / DOCX / TXT / Markdown
"""

import logging
from pathlib import Path
from typing import Optional
from io import BytesIO

logger = logging.getLogger(__name__)

# Lazy imports
pypdf = None
docx = None


def _ensure_pypdf():
    global pypdf
    if pypdf is None:
        from pypdf import PdfReader as _PdfReader
        pypdf = _PdfReader


def _ensure_docx():
    global docx
    if docx is None:
        from docx import Document as _Document
        docx = _Document


async def parse_file(file_path: str) -> str:
    """
    解析文件内容为纯文本

    Args:
        file_path: 文件路径

    Returns:
        提取的文本内容
    """
    suffix = Path(file_path).suffix.lower()

    if suffix == ".pdf":
        return await _parse_pdf(file_path)
    elif suffix in (".docx", ".doc"):
        return await _parse_docx(file_path)
    elif suffix in (".txt", ".md", ".markdown"):
        return await _parse_text(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


async def parse_bytes(filename: str, data: bytes) -> str:
    """
    从内存解析文件内容

    Args:
        filename: 原始文件名 (用于判断类型)
        data: 文件二进制内容

    Returns:
        提取的文本内容
    """
    suffix = Path(filename).suffix.lower()

    if suffix == ".pdf":
        return _parse_pdf_bytes(data)
    elif suffix in (".docx", ".doc"):
        return _parse_docx_bytes(data)
    elif suffix in (".txt", ".md", ".markdown"):
        return data.decode("utf-8", errors="replace")
    elif suffix in (".html", ".htm"):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(data, "lxml")
        return soup.get_text("\n", strip=True)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


async def _parse_pdf(path: str) -> str:
    _ensure_pypdf()
    reader = pypdf(str(path))
    texts = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            texts.append(t)
    return "\n\n".join(texts)


def _parse_pdf_bytes(data: bytes) -> str:
    _ensure_pypdf()
    reader = pypdf(BytesIO(data))
    texts = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            texts.append(t)
    return "\n\n".join(texts)


async def _parse_docx(path: str) -> str:
    _ensure_docx()
    doc = docx(str(path))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _parse_docx_bytes(data: bytes) -> str:
    _ensure_docx()
    doc = docx(BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


async def _parse_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8", errors="replace")
