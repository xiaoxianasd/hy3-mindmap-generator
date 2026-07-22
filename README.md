# MindGraph AI

**基于腾讯混元 Hy3 大模型的知识图谱 & 思维导图自动生成器**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Hy3](https://img.shields.io/badge/Powered%20by-Hy3-6366f1.svg)](https://github.com/Tencent-Hunyuan/Hy3)
[![Next.js](https://img.shields.io/badge/frontend-Next.js%2016-black)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688)](https://fastapi.tiangolo.com)

---

## 项目简介

MindGraph AI 是一个**端到端的知识可视化工具**，利用腾讯混元 Hy3 大模型将任意文本或主题关键词转化为：

- **📝 交互式思维导图**（场景一）：粘贴长文本/上传文件 → 分层思维导图，支持展开全部、缩放、导出 SVG/PDF
- **🕸️ 动态知识图谱**（场景二）：输入关键词 → 实体关系图谱，支持节点下钻扩展、手动编辑、AI 建议补全、导出 SVG/PDF

### 核心特性

| 特性 | 说明 |
|---|---|
| 可调节深度 | 思维导图支持 1-20 层深度，滑块 + 数字输入自由调节 |
| 多格式导出 | 思维导图：SVG + PDF（浏览器打印）；知识图谱：SVG + PDF（截图） |
| 全部展开 | 一键展开思维导图所有节点，便于全局概览 |
| 前端配置 API | 无需修改后端 `.env`，在页面设置面板直接配置 API Key / Base URL / Model |
| 深度保证 | 后端自动检测生成深度不足时，追加 Hy3 调用展开子分支 |
| AI 建议 | 知识图谱支持用户手动编辑后，Hy3 分析并给出改进建议（添加实体/关系/合并/优化） |

---

## Demo 演示

| 场景 | 流程 |
|------|------|
| **场景一** | 粘贴技术文档/上传 PDF → 生成思维导图 → 展开全部节点 → 缩放/折叠 → 导出 SVG / PDF |
| **场景二** | 输入关键词 → 生成知识图谱 → 点击节点下钻扩展 → 手动编辑 → AI 建议补全 → 导出 SVG / PDF |

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│               前端 (Next.js 16 + TypeScript)           │
│                                                       │
│  ┌──────────────┐  ┌────────────────┐                │
│  │  InputPanel  │  │  MindMapView   │ ← markmap      │
│  │  + Settings  │  │  展开/缩放/导出  │    (SVG+PDF)    │
│  │  文本/文件    │  └────────────────┘                │
│  │  关键词输入   │  ┌────────────────┐                │
│  └──────────────┘  │ KnowledgeGraph │ ← ReactFlow    │
│                     │  下钻/编辑/导出  │    (dagre 布局)│
│                     └────────────────┘                │
└──────────────────────┬───────────────────────────────┘
                       │ SSE + X-Hy3-* Headers
┌──────────────────────┴───────────────────────────────┐
│               后端 (Python FastAPI)                    │
│                                                       │
│  ┌──────────────────────────────────────────────────┐│
│  │  /api/mindmap/generate       文本 → 思维导图      ││
│  │  /api/knowledge-graph/generate  关键词 → 图谱     ││
│  │  /api/knowledge-graph/expand   节点 → 下钻扩展    ││
│  │  /api/knowledge-graph/suggest  编辑 → AI 建议     ││
│  └──────────────────────┬───────────────────────────┘│
│  ┌──────────────────────┴───────────────────────────┐│
│  │              Hy3 API Client                       ││
│  │  • reasoning_effort 动态切换 (no_think/high)      ││
│  │  • Structured Output (JSON Schema)                ││
│  │  • 256K 长上下文 + Prompt Cache                   ││
│  │  • 前端 Headers 动态配置 API 参数                  ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 20+
- Hy3 API Key（[TokenHub](https://tokenhub.tencentmaas.com) 申请）

### 1. 安装依赖（仅首次）

双击 `install.bat`，或手动执行：

```bash
# 后端依赖
cd backend
pip install -r requirements.txt

# 前端依赖
cd ../frontend
npm install
```

### 2. 配置 API Key

编辑 `backend/.env`，填入你的 Hy3 API Key：

```
HY3_API_KEY=你的API密钥
HY3_BASE_URL=https://tokenhub.tencentmaas.com/v1
HY3_MODEL=hy3
```

> 也可在启动后点击页面右上角 ⚙️ 齿轮图标，在前端配置（自动保存到浏览器本地存储）。

### 3. 启动

双击 `start.bat`，等待两个服务窗口启动后，浏览器访问 **http://localhost:3000**。

- 前端页面: http://localhost:3000
- 后端接口: http://localhost:8000

按任意键可停止所有服务。

##  Hy3 在系统中的角色

| Hy3 核心能力 | 在 MindGraph AI 中的使用 |
|---|---|
| **Structured Output** (JSON Schema) | 强制输出结构化的 Markdown 大纲（思维导图）和实体关系列表（知识图谱），确保前端可直接渲染 |
| **256K 长上下文** | 一次性加载完整的论文摘要/技术文档（高达 12 万字符），无需手动分块 |
| **reasoning_effort** 快慢思考 | 规划阶段用 `no_think` 快速响应；节点扩展和深度不足时的补充调用确保层级完整 |
| **Prompt Cache** (X-Session-ID) | 系统提示词跨请求复用，多轮追问和节点下钻场景降低输入成本 |
| **OpenAI 兼容协议** | 通过标准 `openai` Python SDK 调用，零学习成本 |

### Hy3 承担的具体任务

1. **文本 → 思维导图**：分析文本逻辑结构，输出 Markdown 层级大纲（# → ## → ### → ...）
2. **深度保证**：生成后自动检测最大深度，不足时追加调用展开叶子节点
3. **关键词 → 知识图谱**：生成领域核心实体（概念/人物/方法/工具/事件）及其语义关系
4. **节点下钻扩展**：针对图谱中的特定节点，生成更深层的关联子图
5. **图谱质量审核**：分析用户手动编辑后的图谱，给出改进建议

---

##  项目结构

```
mindgraph-ai/
├── package.json              # 根配置，npm start 一键启动
├── start.bat                 # Windows 一键启动脚本
├── start.sh                  # Linux/macOS 一键启动脚本
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── routes.py             # FastAPI 路由 + SSE 端点
│   │   ├── core/
│   │   │   ├── hy3_client.py         # Hy3 API 封装（支持 Headers 动态配置）
│   │   │   └── orchestrator.py       # 核心编排（4 流程 + 深度保证）
│   │   ├── tools/
│   │   │   ├── document.py           # PDF/DOCX/TXT/MD 解析器
│   │   │   └── web_fetch.py          # URL 内容抓取
│   │   ├── models/
│   │   │   └── schemas.py            # Pydantic 数据模型
│   │   └── main.py                   # FastAPI 入口
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── layout.tsx             # 根布局
│       │   ├── page.tsx               # 主页面（模式切换 + 状态管理 + 设置）
│       │   └── globals.css            # 全局样式 + 打印 CSS
│       ├── components/
│       │   ├── InputPanel.tsx          # 输入面板（文本/文件/关键词 + 深度滑块）
│       │   ├── MindMapView.tsx         # 思维导图（markmap + 展开/缩放/导出）
│       │   ├── KnowledgeGraphView.tsx  # 知识图谱（ReactFlow + dagre + 导出）
│       │   ├── SettingsModal.tsx       # API 设置面板
│       │   └── ProgressOverlay.tsx     # 加载进度遮罩
│       └── lib/
│           └── api.ts                 # SSE API 客户端（含 Headers 传递）
├── demos/                              # Demo GIF
└── README.md
```

---

## CodeBuddy 协作说明

本项目使用 CodeBuddy作为 AI 编程助手协助开发。以下是主要协作代码块：

| 模块 | 文件 | CodeBuddy 贡献 |
|------|------|---------------|
| 前端主页 | `frontend/src/app/page.tsx` | 完整生成：模式切换、状态管理、设置面板集成 |
| 思维导图 | `frontend/src/components/MindMapView.tsx` | 完整生成：markmap 集成、展开全部、SVG/PDF 导出 |
| 知识图谱 | `frontend/src/components/KnowledgeGraphView.tsx` | 完整生成：ReactFlow + dagre、节点下钻、SVG/PDF 导出 |
| 输入面板 | `frontend/src/components/InputPanel.tsx` | 完整生成：双模式输入、文件上传、深度滑块 (1-20) |
| 设置面板 | `frontend/src/components/SettingsModal.tsx` | 完整生成：API Key/URL/Model 前端配置、localStorage 持久化 |
| API 客户端 | `frontend/src/lib/api.ts` | 完整生成：SSE 流式解析、Headers 传递、错误格式化 |
| Hy3 Client | `backend/app/core/hy3_client.py` | 完整生成：API 封装、结构化输出、Prompt Cache、Headers 动态配置 |
| Orchestrator | `backend/app/core/orchestrator.py` | 完整生成：4 大编排流程、JSON Schema、深度保证循环 |
| API Routes | `backend/app/api/routes.py` | 完整生成：SSE 端点、文件上传、Headers 注入、错误处理 |
| 文档解析 | `backend/app/tools/document.py` | 完整生成：PDF/DOCX/TXT 多格式解析 |
| 进度组件 | `frontend/src/components/ProgressOverlay.tsx` | 完整生成：环形进度条动画 |
| 打印 CSS | `frontend/src/app/globals.css` | 完整生成：@media print 规则，隐藏 UI、A4 横版布局 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **AI 引擎** | 腾讯混元 Hy3 (OpenAI 兼容 API) |
| **后端框架** | Python FastAPI + SSE |
| **前端框架** | Next.js 16 + TypeScript + Tailwind CSS v4 |
| **思维导图** | markmap (markmap-lib + markmap-view) |
| **知识图谱** | ReactFlow (@xyflow/react) + dagre 布局 |
| **图谱导出** | html-to-image |
| **文档解析** | PyPDF2 + python-docx |

---

## 📄 License

Apache 2.0 — 与 Hy3 模型保持一致。
