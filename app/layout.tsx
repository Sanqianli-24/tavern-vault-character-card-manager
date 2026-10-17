import type { Metadata } from "next";
import { headers } from "next/headers";
import { THEMES } from "./themes";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "酒馆角色卡库｜角色卡管理器",
    description: "导入、分类、标记并珍藏你的 SillyTavern 角色卡。",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "酒馆角色卡库",
      description: "收藏每一个好故事",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "酒馆角色卡库界面" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "酒馆角色卡库",
      description: "收藏每一个好故事",
      images: [`${origin}/og.png`],
    },
  };
}

const THEME_IDS = THEMES.map((theme) => theme.id).join("|");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem('tavern-vault-theme');if(t&&/^(?:${THEME_IDS})$/.test(t))document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
