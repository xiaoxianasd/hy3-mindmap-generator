import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindGraph AI — 基于 Hy3 的知识图谱 & 思维导图生成器",
  description:
    "利用腾讯混元 Hy3 大模型将长文本转化为思维导图，或从关键词生成交互式知识图谱。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-gray-50 text-gray-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
