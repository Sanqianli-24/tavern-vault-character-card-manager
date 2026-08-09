import type { Metadata } from "next";
import CharacterManager from "./character-manager";

export const metadata: Metadata = {
  title: "酒馆角色卡库｜角色卡管理器",
  description: "为 SillyTavern 玩家打造的角色卡收藏、整理与评分工作台。",
};

export default function Home() {
  return <CharacterManager />;
}
