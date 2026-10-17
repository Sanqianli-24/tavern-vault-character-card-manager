export const THEMES = [
  { id: "dark", label: "深邃", icon: "◐", note: "默认深紫夜色" },
  { id: "fresh", label: "清新", icon: "❀", note: "薄荷绿浅色" },
  { id: "mocha", label: "奶咖", icon: "☕", note: "柔彩暖棕深色 · Catppuccin Mocha" },
  { id: "nord", label: "极夜", icon: "❄", note: "北极冰蓝深色 · Nord" },
  { id: "kanagawa", label: "浮世", icon: "〜", note: "日式墨蓝 · Kanagawa" },
  { id: "dawn", label: "素笺", icon: "▤", note: "暖纸米色浅色 · Rosé Pine Dawn" },
] as const;

export type ThemeName = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "tavern-vault-theme";

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

export function themeMeta(id: string) {
  return THEMES.find((theme) => theme.id === id);
}
