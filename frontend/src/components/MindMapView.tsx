"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

interface MindMapViewProps {
  rawMarkdown: string | null;
}

export default function MindMapView({ rawMarkdown }: MindMapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<Markmap | null>(null);
  const [scale, setScale] = useState(1);

  // Render markmap when markdown changes
  useEffect(() => {
    if (!svgRef.current || !rawMarkdown) return;

    const transformer = new Transformer();
    const { root } = transformer.transform(rawMarkdown);

    // Clean previous
    if (mmRef.current) {
      mmRef.current.destroy();
      mmRef.current = null;
    }
    svgRef.current.innerHTML = "";

    mmRef.current = Markmap.create(
      svgRef.current,
      {
        autoFit: true,
        duration: 500,
        maxWidth: 280,
        paddingX: 16,
        spacingVertical: 8,
        spacingHorizontal: 60,
        initialExpandLevel: 3,
      },
      root
    );

    setScale(1);
  }, [rawMarkdown]);

  // ── Controls ──

  const handleZoomIn = useCallback(() => {
    if (mmRef.current) {
      mmRef.current.rescale(1.2);
      setScale((s) => Math.min(s * 1.2, 3));
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mmRef.current) {
      mmRef.current.rescale(1 / 1.2);
      setScale((s) => Math.max(s / 1.2, 0.2));
    }
  }, []);

  const handleFit = useCallback(() => {
    if (mmRef.current) {
      mmRef.current.fit();
      setScale(1);
    }
  }, []);

  const _expandAll = useCallback(() => {
    if (!svgRef.current || !rawMarkdown) return;
    // Destroy old instance first
    if (mmRef.current) {
      mmRef.current.destroy();
      mmRef.current = null;
    }
    const transformer = new Transformer();
    const { root } = transformer.transform(rawMarkdown);
    svgRef.current.innerHTML = "";
    // Ensure minimum dimensions to avoid d3 error
    svgRef.current.setAttribute("width", "2000");
    svgRef.current.setAttribute("height", "1500");
    mmRef.current = Markmap.create(svgRef.current, {
      autoFit: false,
      duration: 0,
      maxWidth: 280,
      paddingX: 16,
      spacingVertical: 8,
      spacingHorizontal: 60,
      initialExpandLevel: 99,
    }, root);
    // Fit viewBox to content so everything is visible at native size
    mmRef.current.fit();
  }, [rawMarkdown]);

  const _restoreInteractive = useCallback(() => {
    if (!svgRef.current || !rawMarkdown) return;
    if (mmRef.current) {
      mmRef.current.destroy();
      mmRef.current = null;
    }
    const transformer = new Transformer();
    const { root } = transformer.transform(rawMarkdown);
    svgRef.current.innerHTML = "";
    svgRef.current.setAttribute("width", "100%");
    svgRef.current.setAttribute("height", "100%");
    mmRef.current = Markmap.create(svgRef.current, {
      autoFit: true,
      duration: 300,
      maxWidth: 280,
      paddingX: 16,
      spacingVertical: 8,
      spacingHorizontal: 60,
      initialExpandLevel: 3,
    }, root);
  }, [rawMarkdown]);

  const handleExportSVG = useCallback(() => {
    if (!svgRef.current) return;

    // Expand all nodes first
    _expandAll();

    // Wait for render then download
    setTimeout(() => {
      if (!svgRef.current) return;
      const svgStr = new XMLSerializer().serializeToString(svgRef.current);
      const fullSvg = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' + svgStr;
      const blob = new Blob([fullSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mindmap.svg";
      a.click();
      URL.revokeObjectURL(url);

      // Restore interactive view
      setTimeout(() => _restoreInteractive(), 200);
    }, 500);
  }, [_expandAll, _restoreInteractive]);

  const handleExportPDF = useCallback(() => {
    if (!svgRef.current) return;

    // Expand all nodes
    _expandAll();

    // Use browser native print — most reliable way for complex SVG
    setTimeout(() => {
      window.print();

      // Restore interactive view after print dialog closes
      setTimeout(() => _restoreInteractive(), 800);
    }, 600);
  }, [_expandAll, _restoreInteractive]);

  // ── Empty State ──

  if (!rawMarkdown) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-3 opacity-30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3.75 6A2.25 2.25 0 016 3.75h1.5a.75.75 0 01.75.75v1.5a.75.75 0 01-.75.75H6a2.25 2.25 0 00-2.25 2.25v1.5A.75.75 0 013.75 9h1.5a.75.75 0 01.75.75v1.5a.75.75 0 01-.75.75H3.75A2.25 2.25 0 001.5 14.25v1.5a.75.75 0 01-.75.75h1.5m16.5-6h-1.5a.75.75 0 01-.75-.75v-1.5a.75.75 0 01.75-.75h1.5A2.25 2.25 0 0020.25 9v1.5a.75.75 0 01-.75.75H18a.75.75 0 00-.75.75v1.5a.75.75 0 00.75.75h1.5m-16.5 0h16.5"
            />
          </svg>
          <p>输入文本后点击"生成思维导图"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Toolbar */}
      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/90 shadow-sm
                     border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-bold"
          title="缩小"
        >
          −
        </button>
        <span
          className="w-12 h-8 flex items-center justify-center rounded-lg bg-white/90 shadow-sm
                     border border-gray-200 text-xs text-gray-500 font-mono"
        >
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/90 shadow-sm
                     border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-bold"
          title="放大"
        >
          +
        </button>
        <button
          onClick={handleFit}
          className="px-3 h-8 flex items-center justify-center rounded-lg bg-white/90 shadow-sm
                     border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium"
          title="适应屏幕"
        >
          适配
        </button>
        <button
          onClick={_expandAll}
          className="px-3 h-8 flex items-center justify-center rounded-lg bg-white/90 shadow-sm
                     border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium"
          title="展开全部节点"
        >
          展开
        </button>
        <button
          onClick={handleExportSVG}
          className="px-3 h-8 flex items-center gap-1.5 rounded-lg bg-indigo-600 shadow-sm
                     text-white hover:bg-indigo-700 text-xs font-semibold transition-colors"
          title="导出 SVG"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          导出 SVG
        </button>
        <button
          onClick={handleExportPDF}
          className="px-3 h-8 flex items-center gap-1.5 rounded-lg bg-rose-600 shadow-sm
                     text-white hover:bg-rose-700 text-xs font-semibold transition-colors"
          title="导出 PDF"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          导出 PDF
        </button>
      </div>

      {/* Markmap SVG container */}
      <div ref={containerRef} className="flex-1 w-full overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      {/* Hint */}
      <div className="absolute bottom-3 left-3 text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
        滚轮缩放 | 拖拽平移 | 点击节点折叠/展开
      </div>
    </div>
  );
}
