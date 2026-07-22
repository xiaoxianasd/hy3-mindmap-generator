"use client";

import React, { useState, useRef } from "react";

interface InputPanelProps {
  mode: "mindmap" | "knowledge-graph";
  onGenerateMindMap: (text: string, depth: number) => void;
  onGenerateMindMapFromFile: (file: File, depth: number) => void;
  onGenerateKG: (keyword: string, maxNodes: number) => void;
  loading: boolean;
}

export default function InputPanel({
  mode,
  onGenerateMindMap,
  onGenerateMindMapFromFile,
  onGenerateKG,
  loading,
}: InputPanelProps) {
  // ── Mind Map inputs ──
  const [textInput, setTextInput] = useState("");
  const [depth, setDepth] = useState(4);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Knowledge Graph inputs ──
  const [keyword, setKeyword] = useState("");
  const [maxNodes, setMaxNodes] = useState(15);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setUploadedFile(file);
  };

  const handleSubmit = () => {
    if (mode === "mindmap") {
      if (uploadedFile) {
        onGenerateMindMapFromFile(uploadedFile, depth);
      } else if (textInput.trim()) {
        onGenerateMindMap(textInput.trim(), depth);
      }
    } else {
      if (keyword.trim()) {
        onGenerateKG(keyword.trim(), maxNodes);
      }
    }
  };

  const canSubmit =
    mode === "mindmap"
      ? !!textInput.trim() || !!uploadedFile
      : !!keyword.trim();

  // ── Placeholder examples ──
  const mindmapPlaceholder = `Abstract

Recent advances in large language models (LLMs) have demonstrated remarkable capabilities in natural language understanding and generation. However, these models face significant challenges including hallucination, reasoning errors, and context window limitations. This paper surveys three key approaches to addressing these challenges: retrieval-augmented generation (RAG), chain-of-thought (CoT) prompting, and mixture-of-experts (MoE) architectures. We analyze the trade-offs between computational efficiency and output quality, and propose a hybrid framework combining RAG with dynamic expert routing.`;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        {mode === "mindmap" ? (
          <>
            {/* Text Area */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                粘贴长文本
              </label>
              <textarea
                className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg resize-none
                           focus:ring-2 focus:ring-indigo-400 focus:border-transparent
                           text-sm text-gray-800 placeholder:text-gray-400"
                placeholder={mindmapPlaceholder}
                value={textInput}
                onChange={(e) => {
                  setTextInput(e.target.value);
                  if (e.target.value) setUploadedFile(null);
                }}
                disabled={loading}
              />
            </div>

            {/* OR divider */}
            <div className="flex items-center gap-3">
              <hr className="flex-1 border-gray-200" />
              <span className="text-xs text-gray-400 font-medium uppercase">or</span>
              <hr className="flex-1 border-gray-200" />
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                上传文件（PDF / DOCX / TXT / MD）
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md,.markdown"
                onChange={handleFileChange}
                className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4
                           file:rounded-lg file:border-0 file:text-sm file:font-medium
                           file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100
                           file:cursor-pointer"
                disabled={loading}
              />
              {uploadedFile && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ 已选择: {uploadedFile.name}
                </p>
              )}
            </div>

            {/* Depth selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                思维导图深度:
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="flex-1 accent-indigo-500"
                  disabled={loading}
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={depth}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                    setDepth(v);
                  }}
                  className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center
                             focus:ring-2 focus:ring-indigo-400"
                  disabled={loading}
                />
                <span className="text-sm text-gray-500">层</span>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Keyword Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                输入主题关键词
              </label>
              <input
                type="text"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-emerald-400 focus:border-transparent
                           text-sm text-gray-800 placeholder:text-gray-400"
                placeholder="例如: 量子计算、机器学习、区块链、CRISPR基因编辑..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                disabled={loading}
              />
            </div>

            {/* Max nodes selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">
                图谱节点数:
              </label>
              <input
                type="range"
                min={5}
                max={50}
                value={maxNodes}
                onChange={(e) => setMaxNodes(Number(e.target.value))}
                className="flex-1 accent-emerald-500"
                disabled={loading}
              />
              <span className="text-sm font-mono text-gray-500 w-8">{maxNodes}</span>
            </div>
          </>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className={`w-full py-3 rounded-xl font-semibold text-white transition-all
            ${canSubmit && !loading
              ? mode === "mindmap"
                ? "bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98]"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]"
              : "bg-gray-300 cursor-not-allowed"
            }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              生成中...
            </span>
          ) : mode === "mindmap" ? (
            "生成思维导图"
          ) : (
            "生成知识图谱"
          )}
        </button>
      </div>
    </div>
  );
}
