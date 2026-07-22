"use client";

import React from "react";

interface ProgressOverlayProps {
  message: string;
  progress: number; // 0–1
  visible: boolean;
}

export default function ProgressOverlay({ message, progress, visible }: ProgressOverlayProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
        {/* Spinner */}
        <div className="relative w-16 h-16 mx-auto mb-4">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="6"
            />
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="#6366f1"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - Math.max(progress, 0.05))}`}
              className="transition-[stroke-dashoffset] duration-500 ease-out"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-indigo-600">
            {Math.round(progress * 100)}%
          </span>
        </div>

        <p className="text-gray-700 font-medium text-lg">MindGraph AI</p>
        <p className="text-gray-500 text-sm mt-1 animate-pulse">{message}</p>
      </div>
    </div>
  );
}
