import type { Metadata } from "next";
import CharacterManager from "./character-manager";

export const metadata: Metadata = {
  title: "Tavern Vault｜角色卡书架",
  description: "为 SillyTavern 玩家打造的角色卡收藏、整理与评分工作台。",
};

export default function Home() {
  return <CharacterManager />;
}
