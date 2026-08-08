import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "Tavern Vault｜角色卡书架",
    description: "导入、分类、标记并珍藏你的 SillyTavern 角色卡。",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Tavern Vault",
      description: "收藏每一个好故事",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Tavern Vault 角色卡书架" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Tavern Vault",
      description: "收藏每一个好故事",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
