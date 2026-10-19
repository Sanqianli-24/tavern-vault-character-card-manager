"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { parseCharacterCardJson, parseCharacterCardPng, type ParsedCardContent } from "./card-parser";
import { THEME_STORAGE_KEY, THEMES, isThemeName, themeMeta, type ThemeName } from "./themes";

type CharacterCard = {
  id: string;
  name: string;
  fileName: string;
  fileType: string;
  size: number;
  rating: number;
  favorite?: boolean;
  tags: string[];
  userTags?: string[];
  bookshelf: string;
  image: string;
  description: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogue?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  alternateGreetings?: string[];
  creator?: string;
  characterVersion?: string;
  sourcePath: string;
  createdAt: string;
  modifiedAt: string;
  accent?: string;
};

type SortMode = "explorer" | "name-desc" | "newest" | "oldest" | "rating" | "size";

const themeListeners = new Set<() => void>();

function readTheme(): ThemeName {
  const value = document.documentElement.dataset.theme;
  return isThemeName(value) ? value : "dark";
}

function applyTheme(next: ThemeName) {
  document.documentElement.dataset.theme = next;
  window.localStorage.setItem(THEME_STORAGE_KEY, next);
  for (const listener of themeListeners) listener();
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

const presetShelves = ["最爱角色", "长线剧情", "日常轻松", "悬疑推理", "待体验", "待整理"];
const explorerCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const initialTavernProgress: TavernLaunchProgress = {
  phase: "idle",
  progress: 0,
  message: "酒馆尚未启动",
  detail: "等待配置酒馆目录",
  port: 8000,
  logs: [],
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fileBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function initials(name: string) {
  return name.replace(/[・\s]/g, "").slice(0, 2).toUpperCase();
}

function parseTagsInput(value: string) {
  return Array.from(new Set(
    value
      .split(/[,，\s]+/)
      .map((item) => item.trim().replace(/^#/, ""))
      .filter(Boolean),
  ));
}

function revokeObjectUrl(image?: string) {
  if (image?.startsWith("blob:")) URL.revokeObjectURL(image);
}

type CardItemProps = {
  card: CharacterCard;
  selected: boolean;
  bulkSelected: boolean;
  onOpen: (id: string) => void;
  onToggleBulk: (id: string) => void;
  onUpdate: (id: string, patch: Partial<CharacterCard>) => void;
  onCardMenu: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
};

const CharacterCardItem = memo(function CharacterCardItem({
  card, selected, bulkSelected, onOpen, onToggleBulk, onUpdate, onCardMenu,
}: CardItemProps) {
  function handleKey(event: ReactKeyboardEvent<HTMLElement>) {
    // 只响应卡片本身的按键；内部按钮（收藏/评分/菜单）自己处理 Enter/Space
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(card.id);
    }
  }

  return (
    <article
      className={`character-card ${selected ? "selected" : ""} ${bulkSelected ? "bulk-selected" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={card.name}
      onClick={() => onOpen(card.id)}
      onKeyDown={handleKey}
      onContextMenu={(event) => onCardMenu(event, card.id)}
    >
      <button
        className={`card-check ${bulkSelected ? "checked" : ""}`}
        aria-label={bulkSelected ? `取消选择${card.name}` : `选择${card.name}`}
        onClick={(event) => { event.stopPropagation(); onToggleBulk(card.id); }}
      >
        <i>{bulkSelected ? "✓" : ""}</i>
      </button>
      <div className="card-art" style={{ "--card-accent": card.accent || "var(--accent)" } as React.CSSProperties}>
        {card.image ? <img src={card.image} alt="" loading="lazy" decoding="async" /> : <span className="initials">{initials(card.name)}</span>}
        <span className="format-badge">{card.fileType.includes("json") ? "JSON" : card.fileType.includes("webp") ? "WEBP" : "PNG"}</span>
        <button
          className={`card-favorite ${card.favorite ? "active" : ""}`}
          aria-label={card.favorite ? `取消收藏${card.name}` : `收藏${card.name}`}
          aria-pressed={card.favorite === true}
          onClick={(event) => { event.stopPropagation(); onUpdate(card.id, { favorite: !card.favorite }); }}
        >{card.favorite ? "♥" : "♡"}</button>
        <button
          className="card-menu"
          aria-label={`${card.name}更多操作`}
          onClick={(event) => { event.stopPropagation(); onCardMenu(event, card.id); }}
        >•••</button>
        <div className="art-fade" />
        <div className="card-rating" aria-label={`${card.rating}星`}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              className={star <= card.rating ? "filled" : ""}
              aria-label={`设为${star}星`}
              aria-pressed={card.rating === star}
              onClick={(event) => { event.stopPropagation(); onUpdate(card.id, { rating: card.rating === star ? 0 : star }); }}
            >★</button>
          ))}
        </div>
      </div>
      <div className="card-info">
        <h2>{card.name}</h2>
        <p>{card.tags.length ? card.tags.slice(0, 2).map((tag) => `#${tag}`).join("  ") : "等待添加标签"}</p>
        <div className="card-meta"><span>{formatBytes(card.size)}</span><i /> <span>{formatDate(card.modifiedAt)}</span></div>
      </div>
    </article>
  );
});

export default function CharacterManager() {
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeShelf, setActiveShelf] = useState("全部角色");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeRating, setActiveRating] = useState("all");
  const [activeType, setActiveType] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("explorer");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [detailOpen, setDetailOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToastState] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [newShelfOpen, setNewShelfOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [customShelves, setCustomShelves] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [tavernPanelOpen, setTavernPanelOpen] = useState(false);
  const [tavernProgress, setTavernProgress] = useState<TavernLaunchProgress>(initialTavernProgress);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<null | "tag" | "shelf" | "rating" | "delete" | "export">(null);
  const [bulkTagDraft, setBulkTagDraft] = useState("");
  const [bulkShelf, setBulkShelf] = useState("未分类");
  const [bulkRating, setBulkRating] = useState(0);
  const [hydratingAll, setHydratingAll] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsavedIds, setUnsavedIds] = useState<Set<string>>(new Set());
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [backups, setBackups] = useState<DesktopBackup[] | null>(null);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as ThemeName);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingUpdatesRef = useRef<Map<string, { timer: number; patch: Partial<CharacterCard> }>>(new Map());
  const pendingFilesRef = useRef<Map<string, { file: File; content: ParsedCardContent | null }>>(new Map());
  const lastUpdateEventRef = useRef<string>("");
  const dragDepthRef = useRef(0);

  const showToast = useCallback((text: string, kind: "success" | "error" = "success") => {
    setToastState({ text, kind });
  }, []);

  const clearUnsavedState = useCallback((ids?: Iterable<string>) => {
    if (ids) {
      for (const id of ids) pendingFilesRef.current.delete(id);
      setUnsavedIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      return;
    }
    pendingFilesRef.current.clear();
    setUnsavedIds(new Set());
  }, []);

  const cancelPendingSaves = useCallback((ids?: string[]) => {
    if (!ids) {
      for (const entry of pendingUpdatesRef.current.values()) window.clearTimeout(entry.timer);
      pendingUpdatesRef.current.clear();
      return;
    }
    for (const id of ids) {
      const entry = pendingUpdatesRef.current.get(id);
      if (entry) {
        window.clearTimeout(entry.timer);
        pendingUpdatesRef.current.delete(id);
      }
    }
  }, []);

  const loadCards = useCallback(async () => {
    setLoadError(null);
    if (window.desktopAPI) {
      try {
        const stored = await window.desktopAPI.listCards();
        setCards(stored);
        return true;
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "读取本地卡库失败");
        return false;
      }
    }
    try {
      const response = await fetch("/api/cards");
      const data = await response.json() as { cards?: CharacterCard[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "读取失败");
      setCards((current) => {
        for (const card of current) {
          if (card.id.startsWith("local-")) revokeObjectUrl(card.image);
        }
        return data.cards ?? [];
      });
      clearUnsavedState();
      return true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取失败");
      return false;
    }
  }, [clearUnsavedState]);

  const refreshSettings = useCallback(async () => {
    if (!window.desktopAPI) return null;
    try {
      const next = await window.desktopAPI.getSettings();
      setSettings(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (window.desktopAPI) {
      setIsDesktop(true);
    }
    void loadCards();
    if (window.desktopAPI) {
      window.desktopAPI.getTavernStatus().then(setTavernProgress).catch(() => undefined);
      void refreshSettings();
      return window.desktopAPI.onTavernProgress(setTavernProgress);
    }
    return undefined;
  }, [loadCards, refreshSettings]);

  useEffect(() => {
    if (!window.desktopAPI?.onUpdateStatus) return undefined;
    return window.desktopAPI.onUpdateStatus((status) => {
      setUpdateStatus(status);
      const kind = status.event;
      if (kind === lastUpdateEventRef.current) return;
      lastUpdateEventRef.current = kind;
      if (kind === "available") showToast(`发现新版本 v${status.version ?? ""}，正在后台下载…`);
      if (kind === "downloaded") showToast(`新版本 v${status.version ?? ""} 已就绪，重启后生效`);
    });
  }, [showToast]);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeName(stored) && readTheme() !== stored) applyTheme(stored);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToastState(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 240);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function endDrag() {
      dragDepthRef.current = 0;
      setDragging(false);
    }
    window.addEventListener("dragend", endDrag);
    window.addEventListener("drop", endDrag);
    return () => {
      window.removeEventListener("dragend", endDrag);
      window.removeEventListener("drop", endDrag);
    };
  }, []);

  const selected = cards.find((card) => card.id === selectedId) ?? null;
  const allShelves = useMemo(
    () => Array.from(new Set([...presetShelves, ...customShelves, ...cards.map((card) => card.bookshelf)])).filter(Boolean),
    [cards, customShelves],
  );
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    cards.flatMap((card) => card.tags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [cards]);

  const visibleTags = useMemo(() => {
    const lowered = tagSearch.trim().toLocaleLowerCase("zh-CN");
    if (!lowered) return allTags;
    return allTags.filter(([tag]) => tag.toLocaleLowerCase("zh-CN").includes(lowered));
  }, [allTags, tagSearch]);

  const totalSize = useMemo(() => cards.reduce((sum, card) => sum + (card.size || 0), 0), [cards]);

  const filteredCards = useMemo(() => {
    const lowered = debouncedQuery.trim().toLocaleLowerCase("zh-CN");
    const filtered = cards.filter((card) => {
      const matchesQuery = !lowered || [card.name, card.fileName, ...card.tags]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(lowered);
      const matchesShelf = activeShelf === "全部角色"
        || (activeShelf === "收藏夹" && card.favorite === true)
        || (activeShelf === "最近导入" && Date.now() - new Date(card.createdAt).getTime() < 7 * 86400000)
        || (activeShelf === "未分类" && card.bookshelf === "未分类")
        || card.bookshelf === activeShelf;
      const matchesTag = activeTags.length === 0 || activeTags.every((tag) => card.tags.includes(tag));
      const matchesRating = activeRating === "all"
        || (activeRating === "5" && card.rating === 5)
        || (activeRating === "4up" && card.rating >= 4)
        || (activeRating === "3up" && card.rating >= 3)
        || (activeRating === "none" && card.rating === 0);
      const matchesType = activeType === "all"
        || (activeType === "json" && card.fileType.includes("json"))
        || (activeType === "webp" && card.fileType.includes("webp"))
        || (activeType === "png" && card.fileType.includes("png"));
      return matchesQuery && matchesShelf && matchesTag && matchesRating && matchesType;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "name-desc") return explorerCollator.compare(b.name, a.name);
      if (sortMode === "newest") return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      if (sortMode === "oldest") return new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
      if (sortMode === "rating") return b.rating - a.rating || explorerCollator.compare(a.name, b.name);
      if (sortMode === "size") return b.size - a.size;
      return explorerCollator.compare(a.name, b.name);
    });
  }, [activeShelf, activeTags, activeRating, activeType, cards, debouncedQuery, sortMode]);

  const filteredRef = useRef(filteredCards);
  const draggingRef = useRef(dragging);
  const latestModified = useMemo(() => filteredCards.reduce<string>((latest, card) => card.modifiedAt > latest ? card.modifiedAt : latest, ""), [filteredCards]);
  useEffect(() => {
    filteredRef.current = filteredCards;
    draggingRef.current = dragging;
  });

  const closeTopModal = useCallback((): boolean => {
    if (bulkModal) { setBulkModal(null); return true; }
    if (confirmDeleteId) { setConfirmDeleteId(null); return true; }
    if (settingsOpen) { setSettingsOpen(false); return true; }
    if (backupsOpen) { setBackupsOpen(false); return true; }
    if (aboutOpen) { setAboutOpen(false); return true; }
    if (newShelfOpen) { setNewShelfOpen(false); return true; }
    if (tavernPanelOpen) { setTavernPanelOpen(false); return true; }
    if (tagPickerOpen) { setTagPickerOpen(false); return true; }
    return false;
  }, [aboutOpen, backupsOpen, bulkModal, confirmDeleteId, newShelfOpen, settingsOpen, tagPickerOpen, tavernPanelOpen]);

  const closeTopModalRef = useRef(closeTopModal);
  useEffect(() => {
    closeTopModalRef.current = closeTopModal;
  });

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setCardMenu(null);
        setTopMenuOpen(false);
        setThemeMenuOpen(false);
        if (closeTopModalRef.current()) return;
        setBulkSelected((current) => (current.size ? new Set() : current));
        if (draggingRef.current) {
          dragDepthRef.current = 0;
          setDragging(false);
        }
        return;
      }
      // 输入框内不劫持 Ctrl+K / Ctrl+A（与搜索框全选等原生行为一致）
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setBulkSelected(new Set(filteredRef.current.map((card) => card.id)));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateCard = useCallback(async (id: string, patch: Partial<CharacterCard>) => {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...patch, modifiedAt: new Date().toISOString() } : card));
    if (id.startsWith("local-")) return;
    const persisted: Partial<CharacterCard> = {};
    for (const [key, value] of Object.entries(patch)) {
      if ([
        "name", "rating", "favorite", "tags", "bookshelf", "description", "personality", "scenario",
        "firstMessage", "exampleDialogue", "creatorNotes", "systemPrompt",
        "postHistoryInstructions", "alternateGreetings", "creator", "characterVersion",
      ].includes(key)) {
        (persisted as Record<string, unknown>)[key] = value;
      }
    }
    if (!Object.keys(persisted).length) return;
    const scheduleSave = (save: (merged: Partial<CharacterCard>) => Promise<unknown>) => {
      const existing = pendingUpdatesRef.current.get(id);
      if (existing) window.clearTimeout(existing.timer);
      const mergedPatch = existing ? { ...existing.patch, ...persisted } : persisted;
      pendingUpdatesRef.current.set(id, {
        timer: window.setTimeout(() => {
          pendingUpdatesRef.current.delete(id);
          const patchToSave = { ...mergedPatch };
          save(patchToSave).catch(() => showToast("保存更改失败", "error"));
        }, 320),
        patch: mergedPatch,
      });
    };
    if (window.desktopAPI) {
      scheduleSave((merged) => window.desktopAPI!.updateCard(id, merged));
      return;
    }
    scheduleSave((merged) => fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(merged),
    }).then((response) => {
      if (!response.ok) throw new Error(`保存失败（HTTP ${response.status}）`);
    }));
  }, [showToast]);

  const handleUpdate = useCallback((id: string, patch: Partial<CharacterCard>) => {
    void updateCard(id, patch);
  }, [updateCard]);

  const toggleBulk = useCallback((id: string) => {
    setBulkSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openDetails = useCallback((id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    setTagDraft("");
    if (window.desktopAPI) {
      window.desktopAPI.hydrateCard(id)
        .then((hydrated) => {
          if (!hydrated) return;
          setCards((current) => {
            // 已删除的卡不合并；已有内容只补空字段，避免晚到的快照覆盖新编辑
            if (!current.some((card) => card.id === hydrated.id)) return current;
            return current.map((card) => {
              if (card.id !== hydrated.id) return card;
              const merged: CharacterCard = { ...card };
              for (const [key, value] of Object.entries(hydrated as Record<string, unknown>)) {
                if (value === null || value === undefined || value === "") continue;
                const current2 = (merged as Record<string, unknown>)[key];
                if (current2 === null || current2 === undefined || current2 === "" || (Array.isArray(value) && Array.isArray(current2) && current2.length === 0)) {
                  (merged as Record<string, unknown>)[key] = value;
                }
              }
              return merged;
            });
          });
        })
        .catch(() => undefined);
    }
  }, []);

  const openCardMenu = useCallback((event: ReactMouseEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setCardMenu({
      id,
      x: Math.min(event.clientX, window.innerWidth - 200),
      y: Math.min(event.clientY, window.innerHeight - 170),
    });
  }, []);

  function toggleTag(tag: string) {
    setActiveTags((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag]);
  }

  function readCardContent(file: File): Promise<ParsedCardContent | null> {
    if (/\.json$/i.test(file.name)) {
      return file.text().then(parseCharacterCardJson).catch(() => null);
    }
    if (/\.png$/i.test(file.name)) {
      return file.arrayBuffer().then(parseCharacterCardPng).catch(() => null);
    }
    return Promise.resolve(null);
  }

  function postCardFile(file: File, card: CharacterCard, content: ParsedCardContent | null) {
    const form = new FormData();
    form.set("file", file);
    form.set("name", card.name);
    form.set("fileName", card.fileName);
    form.set("fileType", card.fileType);
    form.set("sourcePath", card.sourcePath);
    form.set("bookshelf", card.bookshelf || "未分类");
    if (content) {
      form.set("description", content.description);
      form.set("personality", content.personality);
      form.set("scenario", content.scenario);
      form.set("firstMessage", content.firstMes);
      form.set("exampleDialogue", content.mesExample);
      form.set("creatorNotes", content.creatorNotes);
      form.set("systemPrompt", content.systemPrompt);
      form.set("postHistoryInstructions", content.postHistoryInstructions);
      form.set("creator", content.creator);
      form.set("characterVersion", content.characterVersion);
      form.set("tags", JSON.stringify(content.tags));
      form.set("alternateGreetings", JSON.stringify(content.alternateGreetings));
    }
    return fetch("/api/cards", { method: "POST", body: form })
      .then(async (response) => {
        if (!response.ok) throw new Error("上传失败");
        const result = await response.json() as { card: CharacterCard | null };
        if (!result.card) throw new Error("上传失败");
        return result.card;
      });
  }

  async function importFiles(fileList: FileList | File[]) {
    if (importing) return;
    const accepted = Array.from(fileList).filter((file) => /\.(png|webp|json)$/i.test(file.name));
    if (!accepted.length) {
      showToast("请选择 PNG、WEBP 或 JSON 角色卡", "error");
      return;
    }
    setImporting(true);
    try {
      if (window.desktopAPI) {
        try {
          const entries: DesktopImportEntry[] = [];
          for (const file of accepted) {
            let parsedName = fileBaseName(file.name);
            if (/\.json$/i.test(file.name)) {
              try {
                const content = await readCardContent(file);
                if (content?.name) parsedName = content.name;
              } catch {
                // The filename remains the display name for malformed JSON.
              }
            }
            entries.push({ file, suggestedName: parsedName, sourcePath: file.webkitRelativePath || file.name });
          }
          const result = await window.desktopAPI.importCards(entries);
          if (!result.cards.length) throw new Error("没有可导入的文件");
          setCards((current) => [...result.cards, ...current]);
          setSelectedId(result.cards[0].id);
          setDetailOpen(true);
          setActiveShelf("全部角色");
          const parts = [`已导入 ${result.cards.length} 张角色卡`];
          if (result.duplicates) parts.push(`跳过 ${result.duplicates} 张重复`);
          if (result.skipped) parts.push(`${result.skipped} 张读取失败`);
          showToast(parts.join("，"));
        } catch (error) {
          showToast(error instanceof Error && error.message === "没有可导入的文件" ? "没有可导入的文件（可能都是重复卡）" : "导入失败，请确认文件仍然存在", "error");
        }
        return;
      }
      let added = 0;
      let failed = 0;
      for (const file of accepted) {
        const content = await readCardContent(file);
        const parsedName = content?.name?.trim() || fileBaseName(file.name);
        const now = new Date().toISOString();
        const localId = `local-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        const localCard: CharacterCard = {
          id: localId,
          name: parsedName,
          fileName: file.name,
          fileType: file.type || (/\.json$/i.test(file.name) ? "application/json" : /\.webp$/i.test(file.name) ? "image/webp" : "image/png"),
          size: file.size,
          rating: 0,
          tags: content?.tags ?? [],
          bookshelf: "未分类",
          image: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
          description: content?.description?.trim() || "刚刚导入的角色卡，等待你补充标签与简介。",
          personality: content?.personality ?? "",
          scenario: content?.scenario ?? "",
          firstMessage: content?.firstMes ?? "",
          exampleDialogue: content?.mesExample ?? "",
          creatorNotes: content?.creatorNotes ?? "",
          systemPrompt: content?.systemPrompt ?? "",
          postHistoryInstructions: content?.postHistoryInstructions ?? "",
          alternateGreetings: content?.alternateGreetings ?? [],
          creator: content?.creator ?? "",
          characterVersion: content?.characterVersion ?? "",
          sourcePath: file.webkitRelativePath || file.name,
          createdAt: now,
          modifiedAt: now,
          accent: "#7557c5",
        };
        setCards((current) => [localCard, ...current]);
        setSelectedId(localId);
        setDetailOpen(true);
        added += 1;

        try {
          const saved = await postCardFile(file, localCard, content);
          revokeObjectUrl(localCard.image);
          setCards((current) => current.map((card) => card.id === localId ? saved : card));
          setSelectedId((current) => current === localId ? saved.id : current);
        } catch {
          failed += 1;
          pendingFilesRef.current.set(localId, { file, content });
          setUnsavedIds((current) => new Set(current).add(localId));
        }
      }
      setActiveShelf("全部角色");
      if (failed) {
        showToast(`已导入 ${added - failed} 张，${failed} 张保存失败（已标记为未保存，可在详情面板重试）`, "error");
      } else {
        showToast(`已导入 ${added} 张角色卡`);
      }
    } finally {
      setImporting(false);
    }
  }

  async function retrySave(id: string) {
    const pending = pendingFilesRef.current.get(id);
    const card = cards.find((item) => item.id === id);
    if (!pending || !card) return;
    try {
      let saved = await postCardFile(pending.file, card, pending.content);
      // 未保存期间的本机编辑（名称/评分/标签/描述等）需要同步到云端，
      // POST 只落解析出的原始内容。
      try {
        const response = await fetch(`/api/cards/${saved.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: card.name,
            rating: card.rating,
            favorite: card.favorite === true,
            tags: card.tags,
            bookshelf: card.bookshelf,
            description: card.description,
            personality: card.personality ?? "",
            scenario: card.scenario ?? "",
            firstMessage: card.firstMessage ?? "",
            exampleDialogue: card.exampleDialogue ?? "",
            creatorNotes: card.creatorNotes ?? "",
            systemPrompt: card.systemPrompt ?? "",
            postHistoryInstructions: card.postHistoryInstructions ?? "",
          }),
        });
        if (response.ok) {
          const result = await response.json() as { card: CharacterCard | null };
          if (result.card) saved = result.card;
        }
      } catch {
        // 同步编辑失败时保留基础保存结果，卡片不再标记未保存
      }
      revokeObjectUrl(card.image);
      setCards((current) => current.map((item) => item.id === id ? saved : item));
      setSelectedId((current) => current === id ? saved.id : current);
      clearUnsavedState([id]);
      showToast("角色卡已保存到云端");
    } catch {
      showToast("重试保存失败，请检查网络后再试", "error");
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void importFiles(event.target.files);
    event.target.value = "";
  }

  function onRootDragEnter(event: DragEvent<HTMLElement>) {
    if (Array.from(event.dataTransfer.types).includes("Files")) setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files);
  }

  function addTag() {
    const tags = parseTagsInput(tagDraft);
    if (!selected || !tags.length) return;
    const merged = Array.from(new Set([...selected.tags, ...tags]));
    if (merged.length === selected.tags.length) return;
    void updateCard(selected.id, { tags: merged });
    setTagDraft("");
    showToast(`已添加 ${tags.length} 个标签`);
  }

  function createShelf() {
    const value = newShelfName.trim();
    if (!value) return;
    setCustomShelves((current) => Array.from(new Set([...current, value])));
    setActiveShelf(value);
    setNewShelfName("");
    setNewShelfOpen(false);
    showToast(`已创建书架「${value}」`);
  }

  async function deleteCard(id: string) {
    const card = cards.find((item) => item.id === id);
    if (!card) return;
    try {
      if (window.desktopAPI) {
        await window.desktopAPI.deleteCards([id]);
      } else if (!id.startsWith("local-")) {
        const response = await fetch(`/api/cards/${id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
      }
    } catch {
      showToast("删除失败，请重试", "error");
      setConfirmDeleteId(null);
      setCardMenu(null);
      return;
    }
    cancelPendingSaves([id]);
    revokeObjectUrl(card.image);
    clearUnsavedState([id]);
    setCards((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId("");
    setConfirmDeleteId(null);
    setCardMenu(null);
    showToast("已删除角色卡");
  }

  function clientCardData(card: CharacterCard) {
    return {
      name: card.name || card.fileName || "未命名角色",
      description: card.description || "",
      personality: card.personality || "",
      scenario: card.scenario || "",
      first_mes: card.firstMessage || "",
      mes_example: card.exampleDialogue || "",
      creator_notes: card.creatorNotes || "",
      system_prompt: card.systemPrompt || "",
      post_history_instructions: card.postHistoryInstructions || "",
      alternate_greetings: card.alternateGreetings || [],
      creator: card.creator || "",
      character_version: card.characterVersion || "",
      tags: card.tags || [],
    };
  }

  function exportCard(id: string) {
    const card = cards.find((item) => item.id === id);
    if (!card) return;
    if (window.desktopAPI) {
      window.desktopAPI.exportCard(id)
        .then((result) => {
          if (result.ok) showToast(`已导出到 ${result.path}`);
          else if (!result.canceled) showToast(result.error || "导出失败", "error");
        })
        .catch(() => showToast("导出失败", "error"));
      return;
    }
    const anchor = window.document.createElement("a");
    anchor.rel = "noopener";
    if (card.id.startsWith("local-")) {
      // 未保存的卡片直接用本机数据导出：图片用 blob，否则生成 JSON
      if (card.image) {
        anchor.href = card.image;
        anchor.download = card.fileName || "character-card";
      } else {
        const blob = new Blob(
          [JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: clientCardData(card) }, null, 2)],
          { type: "application/json" },
        );
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `${(card.name || "角色卡").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.json`;
        window.setTimeout(() => URL.revokeObjectURL(anchor.href), 30000);
      }
    } else {
      anchor.href = card.image
        ? `/api/cards/file/${id}?download=1`
        : `/api/cards/file/${id}?format=json&download=1`;
    }
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    showToast("已开始下载角色卡文件");
  }

  function exportSelected() {
    if (!window.desktopAPI || !bulkSelected.size) return;
    const ids = [...bulkSelected];
    window.desktopAPI.exportCards(ids)
      .then((result) => {
        if (!result.ok && !result.canceled) {
          showToast(result.error || "批量导出失败", "error");
          return;
        }
        if (result.ok) {
          const parts = [`已导出 ${result.exported} 张到 ${result.dir}`];
          if (result.failed) parts.push(`${result.failed} 张失败`);
          showToast(parts.join("，"));
          clearBulk();
        }
      })
      .catch(() => showToast("批量导出失败", "error"));
  }

  async function launchTavern() {
    if (!window.desktopAPI) return;
    setTavernPanelOpen(true);
    try {
      const state = await window.desktopAPI.startSillyTavern();
      setTavernProgress(state);
    } catch {
      setTavernProgress((current) => ({ ...current, phase: "error", progress: 100, message: "启动请求失败", detail: "请重新尝试" }));
    }
  }

  async function hydrateAllCards() {
    if (!window.desktopAPI || hydratingAll) return;
    setHydratingAll(true);
    try {
      const result = await window.desktopAPI.hydrateAllCards();
      const stored = await window.desktopAPI.listCards();
      setCards(stored);
      showToast(result.hydrated > 0 ? `已补读 ${result.hydrated} 张角色卡的角色信息` : "没有需要补读的旧卡");
    } catch {
      showToast("补读失败，请重试", "error");
    } finally {
      setHydratingAll(false);
    }
  }

  async function pickTavernDir() {
    if (!window.desktopAPI) return;
    try {
      const dir = await window.desktopAPI.pickDirectory();
      if (!dir) return;
      const result = await window.desktopAPI.setSettings({ sillyTavernDir: dir, preferEmbedded: false });
      if (!result.ok) {
        showToast(result.error || "设置目录失败", "error");
        return;
      }
      await refreshSettings();
      setTavernProgress((current) => ({ ...current, phase: "idle", progress: 0, message: "酒馆目录已更新", detail: `等待启动 ${result.sillyTavernDir}` }));
      showToast("已更新酒馆目录");
    } catch {
      showToast("选择目录失败", "error");
    }
  }

  async function switchTavernMode(embedded: boolean) {
    if (!window.desktopAPI) return;
    try {
      const result = await window.desktopAPI.setSettings({ preferEmbedded: embedded });
      if (!result.ok) {
        showToast(result.error || "切换失败", "error");
        return;
      }
      await refreshSettings();
      setTavernProgress((current) => ({
        ...current,
        phase: "idle",
        progress: 0,
        message: embedded ? "已切换为内置酒馆" : "已切换为外部酒馆目录",
        detail: `等待启动 ${result.sillyTavernDir}`,
      }));
      showToast(embedded ? "已切换为内置酒馆，点击启动即可使用" : "已切换为外部酒馆目录");
    } catch {
      showToast("切换失败", "error");
    }
  }

  async function openTavernInApp() {
    if (!window.desktopAPI) return;
    try {
      const result = await window.desktopAPI.openTavernWindow();
      if (!result.ok) showToast(result.error || "酒馆尚未运行", "error");
    } catch {
      showToast("打开酒馆窗口失败", "error");
    }
  }

  async function openTavernInBrowser() {
    if (!window.desktopAPI) return;
    try {
      const result = await window.desktopAPI.openTavernBrowser();
      if (!result.ok) showToast(result.error || "酒馆尚未运行", "error");
    } catch {
      showToast("打开浏览器失败", "error");
    }
  }

  async function openSettingsModal(checkUpdate = false) {
    await refreshSettings();
    setSettingsOpen(true);
    if (checkUpdate) void checkForUpdates();
  }

  async function openBackupsModal() {
    if (!window.desktopAPI) return;
    try {
      setBackups(await window.desktopAPI.listBackups());
    } catch {
      setBackups([]);
    }
    setBackupsOpen(true);
  }

  async function createBackupNow() {
    if (!window.desktopAPI) return;
    try {
      const result = await window.desktopAPI.createBackup();
      if (!result.ok) throw new Error();
      setBackups(await window.desktopAPI.listBackups());
      showToast("已创建备份");
    } catch {
      showToast("创建备份失败", "error");
    }
  }

  async function restoreBackup(name: string) {
    if (!window.desktopAPI) return;
    try {
      const result = await window.desktopAPI.restoreBackup(name);
      if (!result.ok) throw new Error(result.error || "恢复失败");
      cancelPendingSaves();
      clearUnsavedState();
      setCards((current) => {
        for (const card of current) {
          if (card.id.startsWith("local-")) revokeObjectUrl(card.image);
        }
        return result.cards ?? [];
      });
      setSelectedId("");
      setBackups(await window.desktopAPI.listBackups());
      setBackupsOpen(false);
      showToast(`已恢复备份（${(result.cards ?? []).length} 张角色卡），恢复前的数据已另存为备份`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "恢复备份失败", "error");
    }
  }

  async function checkForUpdates() {
    if (!window.desktopAPI || updateChecking) return;
    setUpdateChecking(true);
    try {
      const result = await window.desktopAPI.checkForUpdates();
      if (!result.ok) {
        setUpdateStatus({ event: "error", message: result.error });
      } else if (result.version) {
        setUpdateStatus({ event: "available", version: result.version });
      } else {
        setUpdateStatus({ event: "not-available" });
      }
    } finally {
      setUpdateChecking(false);
    }
  }

  function installUpdate() {
    if (!window.desktopAPI) return;
    window.desktopAPI.installUpdate().catch(() => undefined);
  }

  function refreshCards() {
    void loadCards().then((ok) => {
      showToast(ok ? "卡库已刷新" : "刷新卡库失败，请重试", ok ? "success" : "error");
    });
  }

  const bulkCards = cards.filter((card) => bulkSelected.has(card.id));
  const allVisibleSelected = filteredCards.length > 0 && filteredCards.every((card) => bulkSelected.has(card.id));

  function toggleAllVisible() {
    setBulkSelected((current) => {
      const next = new Set(current);
      if (filteredCards.every((card) => next.has(card.id))) {
        for (const card of filteredCards) next.delete(card.id);
      } else {
        for (const card of filteredCards) next.add(card.id);
      }
      return next;
    });
  }

  function clearBulk() {
    setBulkSelected(new Set());
    setBulkModal(null);
  }

  function applyBulkShelf() {
    if (!bulkCards.length) return;
    const ids = bulkCards.map((card) => card.id);
    if (window.desktopAPI) {
      window.desktopAPI.updateCards(ids, { bookshelf: bulkShelf })
        .catch(() => showToast("批量移动书架失败", "error"));
    } else {
      for (const card of bulkCards) {
        if (!card.id.startsWith("local-")) void updateCard(card.id, { bookshelf: bulkShelf });
      }
    }
    setCards((current) => current.map((card) => bulkSelected.has(card.id) ? { ...card, bookshelf: bulkShelf, modifiedAt: new Date().toISOString() } : card));
    showToast(`已将 ${bulkCards.length} 张角色卡移入「${bulkShelf}」`);
    clearBulk();
  }

  function applyBulkRating() {
    if (!bulkCards.length || !bulkRating) return;
    const ids = bulkCards.map((card) => card.id);
    if (window.desktopAPI) {
      window.desktopAPI.updateCards(ids, { rating: bulkRating })
        .catch(() => showToast("批量评分失败", "error"));
    } else {
      for (const card of bulkCards) {
        if (!card.id.startsWith("local-")) void updateCard(card.id, { rating: bulkRating });
      }
    }
    setCards((current) => current.map((card) => bulkSelected.has(card.id) ? { ...card, rating: bulkRating, modifiedAt: new Date().toISOString() } : card));
    showToast(`已为 ${bulkCards.length} 张角色卡评分`);
    clearBulk();
  }

  async function applyBulkTag() {
    const values = parseTagsInput(bulkTagDraft);
    if (!bulkCards.length || !values.length) return;
    if (window.desktopAPI) {
      try {
        await Promise.all(bulkCards.map((card) => {
          const merged = Array.from(new Set([...card.tags, ...values]));
          return merged.length === card.tags.length
            ? Promise.resolve(0)
            : window.desktopAPI!.updateCard(card.id, { tags: merged });
        }));
      } catch {
        showToast("批量添加标签失败", "error");
        return;
      }
    } else {
      for (const card of bulkCards) {
        const merged = Array.from(new Set([...card.tags, ...values]));
        if (merged.length !== card.tags.length && !card.id.startsWith("local-")) {
          void updateCard(card.id, { tags: merged });
        }
      }
    }
    setCards((current) => current.map((card) => {
      if (!bulkSelected.has(card.id)) return card;
      const merged = Array.from(new Set([...card.tags, ...values]));
      return merged.length === card.tags.length ? card : { ...card, tags: merged, modifiedAt: new Date().toISOString() };
    }));
    showToast(`已为 ${bulkCards.length} 张角色卡添加 ${values.length} 个标签`);
    clearBulk();
  }

  async function applyBulkDelete() {
    if (!bulkCards.length) return;
    const ids = bulkCards.map((card) => card.id);
    if (window.desktopAPI) {
      try {
        await window.desktopAPI.deleteCards(ids);
      } catch {
        showToast("批量删除失败，正在重新加载卡库", "error");
        void loadCards();
        clearBulk();
        return;
      }
    } else {
      const failedIds = new Set<string>();
      for (const card of bulkCards) {
        if (card.id.startsWith("local-")) continue;
        try {
          const response = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
          if (!response.ok && response.status !== 404) failedIds.add(card.id);
        } catch {
          failedIds.add(card.id);
        }
      }
      if (failedIds.size) {
        const removed = bulkCards.filter((card) => !failedIds.has(card.id));
        cancelPendingSaves(ids.filter((id) => !failedIds.has(id)));
        for (const card of removed) {
          revokeObjectUrl(card.image);
          pendingFilesRef.current.delete(card.id);
        }
        clearUnsavedState(removed.map((card) => card.id));
        setCards((current) => current.filter((card) => !bulkSelected.has(card.id) || failedIds.has(card.id)));
        showToast(`已删除 ${removed.length} 张，${failedIds.size} 张删除失败已保留`, "error");
        clearBulk();
        return;
      }
    }
    cancelPendingSaves(ids);
    for (const card of bulkCards) {
      revokeObjectUrl(card.image);
      pendingFilesRef.current.delete(card.id);
    }
    clearUnsavedState(ids);
    setCards((current) => current.filter((card) => !bulkSelected.has(card.id)));
    if (selectedId && bulkSelected.has(selectedId)) {
      const remaining = cards.find((card) => !bulkSelected.has(card.id));
      setSelectedId(remaining?.id ?? "");
    }
    showToast(`已删除 ${bulkCards.length} 张角色卡`);
    clearBulk();
  }

  const confirmDeleteCard = confirmDeleteId ? cards.find((card) => card.id === confirmDeleteId) : null;
  const activeTheme = themeMeta(theme);

  return (
    <div
      className="vault-app"
      onDragEnter={onRootDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>酒馆角色卡库</strong><small>本地角色卡管理器</small></span>
        </div>

        <button className="new-shelf" onClick={() => setNewShelfOpen(true)}><span>＋</span> 新建书架</button>

        <nav className="primary-nav" aria-label="主要分类">
          {[
            ["收藏夹", "★", cards.filter((card) => card.favorite === true).length],
            ["全部角色", "▦", cards.length],
            ["最近导入", "◷", cards.filter((card) => Date.now() - new Date(card.createdAt).getTime() < 7 * 86400000).length],
            ["未分类", "◇", cards.filter((card) => card.bookshelf === "未分类").length],
          ].map(([name, icon, count]) => (
            <button key={String(name)} className={activeShelf === name ? "active" : ""} onClick={() => setActiveShelf(String(name))}>
              <span className="nav-icon">{icon}</span><span>{name}</span><em>{count}</em>
            </button>
          ))}
        </nav>

        <div className="sidebar-heading"><span>我的书架</span><button aria-label="新建书架" onClick={() => setNewShelfOpen(true)}>＋</button></div>
        <nav className="shelf-nav" aria-label="我的书架">
          {allShelves.map((shelf, index) => (
            <button key={shelf} className={activeShelf === shelf ? "active" : ""} onClick={() => setActiveShelf(shelf)}>
              <span className={`shelf-dot color-${index % 6}`} />
              <span>{shelf}</span>
              <em>{cards.filter((card) => card.bookshelf === shelf).length}</em>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-copy"><span>卡库概览</span><small>{isDesktop ? "本机存储 · 自动备份" : "云端存储"}</small></div>
          <div className="storage-meta"><span>{cards.length} 张角色卡</span><span>共 {formatBytes(totalSize)}</span></div>
        </div>
      </aside>

      <main className={`workspace ${detailOpen && selected ? "with-detail" : ""}`}>
        <header className="topbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索角色、标签或文件名…"
              aria-label="搜索角色卡"
            />
            <kbd>Ctrl K</kbd>
          </label>
          <div className="top-actions">
            {isDesktop && (
              <button className={`tavern-launch-button ${tavernProgress.phase === "ready" ? "ready" : ""}`} onClick={() => void launchTavern()}>
                <span>{tavernProgress.phase === "ready" ? "✓" : "▶"}</span>
                {tavernProgress.phase === "ready" ? "进入酒馆" : "启动酒馆"}
              </button>
            )}
            <label className="button secondary">
              <input type="file" multiple accept=".png,.webp,.json,image/png,image/webp,application/json" onChange={onFileChange} />
              <span>＋</span>{importing ? "正在导入…" : "导入文件"}
            </label>
            <button className="button primary" onClick={() => folderInputRef.current?.click()}><span>▱</span> 导入文件夹</button>
            <input
              ref={folderInputRef}
              className="visually-hidden"
              type="file"
              multiple
              onChange={onFileChange}
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            />
            <div className="top-menu-wrap">
              <button
                className="theme-toggle"
                aria-haspopup="menu"
                aria-expanded={themeMenuOpen}
                onClick={() => setThemeMenuOpen((open) => !open)}
                aria-label={`选择界面主题，当前为${activeTheme?.label}主题`}
                title="选择界面主题"
              >
                <span aria-hidden="true">{activeTheme?.icon}</span>
                {activeTheme?.label}
              </button>
              {themeMenuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setThemeMenuOpen(false)} />
                  <div className="app-menu theme-menu" role="menu" aria-label="界面主题">
                    {THEMES.map((item) => (
                      <button
                        key={item.id}
                        role="menuitemradio"
                        aria-checked={item.id === theme}
                        className={item.id === theme ? "active" : ""}
                        title={item.note}
                        onClick={() => {
                          applyTheme(item.id);
                          setThemeMenuOpen(false);
                        }}
                      >
                        <span className={`theme-swatch swatch-${item.id}`} aria-hidden="true" />
                        <span className="theme-menu-label">{item.label}</span>
                        <span className="theme-menu-check" aria-hidden="true">{item.id === theme ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="top-menu-wrap">
              <button
                className="more-button"
                aria-label="更多选项"
                aria-expanded={topMenuOpen}
                onClick={() => setTopMenuOpen((open) => !open)}
              >•••</button>
              {topMenuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setTopMenuOpen(false)} />
                  <div className="app-menu" role="menu">
                    <button role="menuitem" onClick={() => { setTopMenuOpen(false); refreshCards(); }}><span>↻</span>刷新卡库</button>
                    {isDesktop && <button role="menuitem" onClick={() => { setTopMenuOpen(false); void openSettingsModal(); }}><span>⚙</span>设置</button>}
                    {isDesktop && <button role="menuitem" onClick={() => { setTopMenuOpen(false); void openBackupsModal(); }}><span>▰</span>备份与恢复</button>}
                    {isDesktop && <button role="menuitem" onClick={() => { setTopMenuOpen(false); void openSettingsModal(true); }}><span>↑</span>检查更新</button>}
                    <button role="menuitem" onClick={() => { setTopMenuOpen(false); setAboutOpen(true); }}><span>ℹ</span>关于</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <section className="library">
          <div className="library-title-row">
            <div>
              <div className="breadcrumbs"><span>书架</span><b>/</b><span>{activeShelf}</span></div>
              <h1>{activeShelf}</h1>
              <p>
                {filteredCards.length} 张角色卡
                {latestModified ? ` · 最近修改 ${formatDate(latestModified)}` : ""}
                {unsavedIds.size ? ` · ${unsavedIds.size} 张未保存` : ""}
              </p>
            </div>
            <div className="library-summary">
              <span className="summary-stack" aria-hidden="true"><i /><i /><i /></span>
              <div><strong>{cards.filter((card) => card.rating >= 4).length}</strong><small>张高分收藏</small></div>
            </div>
            {isDesktop && (
              <button className="hydrate-button" onClick={() => void hydrateAllCards()} disabled={hydratingAll}>
                <span>{hydratingAll ? "◌" : "↻"}</span>
                {hydratingAll ? "正在补读…" : "补读全部旧卡"}
              </button>
            )}
          </div>

          <div className="toolbar">
            <div className="batch-controls">
              <button className={`batch-select ${allVisibleSelected ? "checked" : ""}`} onClick={toggleAllVisible} aria-label="全选当前视图">
                <i>{allVisibleSelected ? "✓" : ""}</i>
              </button>
              <button className="batch-toggle" onClick={toggleAllVisible}>全选</button>
              {bulkSelected.size > 0 && <em>{bulkSelected.size} 张已选</em>}
            </div>
            <div className="tag-filter-area">
              <div className="tag-filters" aria-label="标签筛选">
                <button
                  className={`filter-more ${tagPickerOpen ? "active" : ""}`}
                  aria-expanded={tagPickerOpen}
                  onClick={() => setTagPickerOpen((open) => !open)}
                >
                  全部标签 <span>{allTags.length}</span>
                </button>
                {activeTags.map((tag) => {
                  const count = allTags.find(([item]) => item === tag)?.[1] ?? 0;
                  return <button key={tag} className="active selected-tag" onClick={() => toggleTag(tag)}>#{tag} <span>{count} ×</span></button>;
                })}
              </div>
              {tagPickerOpen && (
                <div className="tag-picker" role="listbox" aria-label="全部标签">
                  <div className="tag-picker-head"><strong>选择标签 <small>可多选，点击已选标签取消</small></strong><button onClick={() => setTagPickerOpen(false)} aria-label="关闭标签选择">×</button></div>
                  <input className="tag-search" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="搜索标签…" aria-label="搜索标签" autoFocus />
                  <div className="tag-picker-list">
                    <button className={activeTags.length === 0 ? "active" : ""} onClick={() => setActiveTags([])}>全部标签（清除筛选）</button>
                    {visibleTags.map(([tag, count]) => (
                      <button key={tag} className={activeTags.includes(tag) ? "active" : ""} aria-selected={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>
                        <span>#{tag}</span><em>{count}</em>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="view-controls">
              <label className="sort-select filter-select">
                <span>评分</span>
                <select value={activeRating} onChange={(event) => setActiveRating(event.target.value)} aria-label="评分筛选">
                  <option value="all">全部</option>
                  <option value="5">5 星</option>
                  <option value="4up">4 星及以上</option>
                  <option value="3up">3 星及以上</option>
                  <option value="none">未评分</option>
                </select>
              </label>
              <label className="sort-select filter-select">
                <span>类型</span>
                <select value={activeType} onChange={(event) => setActiveType(event.target.value)} aria-label="格式筛选">
                  <option value="all">全部</option>
                  <option value="png">PNG</option>
                  <option value="webp">WEBP</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              <label className="sort-select">
                <span>排序</span>
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="排序方式">
                  <option value="explorer">名称（资源管理器）</option>
                  <option value="name-desc">名称（降序）</option>
                  <option value="newest">最近修改</option>
                  <option value="oldest">最早修改</option>
                  <option value="rating">评分最高</option>
                  <option value="size">文件大小</option>
                </select>
              </label>
              <div className="view-toggle">
                <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="网格视图">▦</button>
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="列表视图">☷</button>
              </div>
            </div>
          </div>

          {bulkSelected.size > 0 && (
            <div className="bulk-action-bar">
              <div className="bulk-title">
                <strong>{bulkSelected.size}</strong>
                <span>张角色卡已选择</span>
              </div>
              <div className="bulk-actions">
                <button onClick={() => { setBulkTagDraft(""); setBulkModal("tag"); }}><span>#</span>添加标签</button>
                <button onClick={() => { setBulkShelf("未分类"); setBulkModal("shelf"); }}><span>▰</span>移入书架</button>
                <button onClick={() => { setBulkRating(0); setBulkModal("rating"); }}><span>★</span>批量评分</button>
                {isDesktop && <button onClick={exportSelected}><span>⤓</span>导出</button>}
                <button className="danger" onClick={() => setBulkModal("delete")}><span>×</span>删除</button>
              </div>
              <button className="bulk-clear" onClick={clearBulk}>取消选择</button>
            </div>
          )}

          {filteredCards.length ? (
            <div className={view === "grid" ? "character-grid" : "character-list"}>
              {filteredCards.map((card) => (
                <CharacterCardItem
                  key={card.id}
                  card={card}
                  selected={selectedId === card.id && detailOpen}
                  bulkSelected={bulkSelected.has(card.id)}
                  onOpen={openDetails}
                  onToggleBulk={toggleBulk}
                  onUpdate={handleUpdate}
                  onCardMenu={openCardMenu}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">{loadError ? "!" : "◇"}</span>
              <h2>{loadError ? "卡库读取失败" : "没有找到角色卡"}</h2>
              <p>{loadError ? `${loadError}，请检查网络或存储后重试。` : "试试更换筛选条件，或导入新的 PNG、WEBP、JSON 角色卡。"}</p>
              {loadError && <button className="empty-retry" onClick={() => void loadCards()}>重新加载</button>}
            </div>
          )}
        </section>

        {dragging && (
          <div
            className="drop-zone"
            onDragEnter={() => { dragDepthRef.current += 1; }}
            onDragLeave={() => {
              dragDepthRef.current -= 1;
              if (dragDepthRef.current <= 0) { dragDepthRef.current = 0; setDragging(false); }
            }}
          >
            <button
              className="drop-close"
              onClick={() => { dragDepthRef.current = 0; setDragging(false); }}
              aria-label="关闭导入提示"
            >×</button>
            <div><span>＋</span><strong>松开即可导入角色卡</strong><small>支持 PNG、WEBP 与 JSON 文件</small></div>
          </div>
        )}
      </main>

      {detailOpen && selected && (
        <aside className="detail-panel" aria-label="角色卡详情">
          <div className="detail-head">
            <div><span className="live-dot" /> 角色卡详情{unsavedIds.has(selected.id) ? "（未保存）" : ""}</div>
            <button aria-label="关闭详情" onClick={() => setDetailOpen(false)}>×</button>
          </div>
          <div className="detail-scroll">
            <div className="detail-cover" style={{ "--card-accent": selected.accent || "var(--accent)" } as React.CSSProperties}>
              {selected.image ? <img src={selected.image} alt={selected.name} /> : <span className="initials">{initials(selected.name)}</span>}
              <span className="detail-format">{selected.fileType.includes("json") ? "JSON 角色卡" : "角色卡"}</span>
            </div>
            <div className="detail-title">
              <div className="detail-title-main">
                <input value={selected.name} onChange={(event) => void updateCard(selected.id, { name: event.target.value })} aria-label="角色名称" />
                <button className={`detail-favorite ${selected.favorite ? "active" : ""}`} onClick={() => void updateCard(selected.id, { favorite: !selected.favorite })} aria-pressed={selected.favorite === true}>
                  {selected.favorite ? "♥ 已收藏" : "♡ 收藏"}
                </button>
              </div>
              <p>{selected.fileName}</p>
            </div>
            <section className="detail-section">
              <label>我的评分</label>
              <div className="detail-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} className={star <= selected.rating ? "filled" : ""} onClick={() => void updateCard(selected.id, { rating: selected.rating === star ? 0 : star })} aria-label={selected.rating === star ? "取消评分" : `设为${star}星`}>★</button>
                ))}
                <span>{selected.rating ? `${selected.rating}.0` : "未评分"}</span>
              </div>
            </section>
            <section className="detail-section">
              <label>所在书架</label>
              <select value={selected.bookshelf} onChange={(event) => void updateCard(selected.id, { bookshelf: event.target.value })}>
                <option value="未分类">未分类</option>
                {allShelves.filter((shelf) => shelf !== "未分类").map((shelf) => <option key={shelf}>{shelf}</option>)}
              </select>
            </section>
            <section className="detail-section">
              <label>标签</label>
              <div className="detail-tags">
                {selected.tags.map((tag) => (
                  <button key={tag} title="移除标签" onClick={() => void updateCard(selected.id, { tags: selected.tags.filter((item) => item !== tag) })}>#{tag} <span>×</span></button>
                ))}
              </div>
              <div className="tag-input">
                <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTag()} placeholder="多个标签可用逗号或空格分隔" />
                <button onClick={addTag}>添加</button>
              </div>
            </section>
            <section className="detail-section">
              <label>角色描述</label>
              <textarea className="detail-description-textarea" value={selected.description} onChange={(event) => void updateCard(selected.id, { description: event.target.value })} rows={8} />
            </section>
            <section className="detail-section">
              <label>开场白</label>
              <textarea
                value={selected.firstMessage ?? ""}
                onChange={(event) => void updateCard(selected.id, { firstMessage: event.target.value })}
                className="detail-opening-textarea"
                rows={12}
                placeholder="暂无开场白"
              />
            </section>
            {selected.alternateGreetings?.length ? (
              <section className="detail-section">
                <label>备选开场白</label>
                <div className="detail-alternates">
                  {selected.alternateGreetings.map((greeting, index) => (
                    <details key={index}><summary>开场白 {index + 1}</summary><p>{greeting}</p></details>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="detail-section">
              <label>性格与人物设定</label>
              <textarea
                value={selected.personality ?? ""}
                onChange={(event) => void updateCard(selected.id, { personality: event.target.value })}
                rows={4}
                placeholder="暂无性格设定"
              />
            </section>
            <section className="detail-section">
              <label>场景</label>
              <textarea
                value={selected.scenario ?? ""}
                onChange={(event) => void updateCard(selected.id, { scenario: event.target.value })}
                rows={3}
                placeholder="暂无场景设定"
              />
            </section>
            <section className="detail-section">
              <label>对话示例</label>
              <textarea
                value={selected.exampleDialogue ?? ""}
                onChange={(event) => void updateCard(selected.id, { exampleDialogue: event.target.value })}
                rows={5}
                placeholder="暂无对话示例"
              />
            </section>
            {selected.creatorNotes ? (
              <section className="detail-section">
                <label>作者笔记</label>
                <p className="detail-paragraph">{selected.creatorNotes}</p>
              </section>
            ) : null}
            {selected.systemPrompt ? (
              <section className="detail-section">
                <label>系统提示词</label>
                <pre className="detail-pre">{selected.systemPrompt}</pre>
              </section>
            ) : null}
            {selected.postHistoryInstructions ? (
              <section className="detail-section">
                <label>回复后指令</label>
                <pre className="detail-pre">{selected.postHistoryInstructions}</pre>
              </section>
            ) : null}
            <section className="file-details">
              <div><span>文件类型</span><strong>{selected.fileType.includes("json") ? "JSON" : selected.fileType.includes("webp") ? "WEBP" : "PNG"} 角色卡</strong></div>
              <div><span>文件大小</span><strong>{formatBytes(selected.size)}</strong></div>
              <div><span>修改时间</span><strong>{formatDate(selected.modifiedAt)}</strong></div>
              {selected.creator ? <div><span>作者</span><strong>{selected.creator}</strong></div> : null}
              {selected.characterVersion ? <div><span>卡版本</span><strong>{selected.characterVersion}</strong></div> : null}
              <div><span>来源</span><strong title={selected.sourcePath}>{selected.sourcePath || "手动导入"}</strong></div>
            </section>
          </div>
          <div className={`detail-footer ${unsavedIds.has(selected.id) ? "unsaved" : ""}`}>
            {unsavedIds.has(selected.id) ? (
              <>
                <span>该卡尚未保存到云端</span>
                <button className="detail-retry" onClick={() => void retrySave(selected.id)}>重试保存</button>
              </>
            ) : (
              <><span>所有更改均已自动保存</span><i>✓</i></>
            )}
            <button className="detail-export" onClick={() => exportCard(selected.id)}><span aria-hidden="true">⤓</span>导出</button>
          </div>
        </aside>
      )}

      {cardMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setCardMenu(null)} onContextMenu={(event) => { event.preventDefault(); setCardMenu(null); }} />
          <div className="card-context-menu" role="menu" style={{ left: cardMenu.x, top: cardMenu.y }}>
            <button role="menuitem" onClick={() => { const id = cardMenu.id; setCardMenu(null); openDetails(id); }}><span>◉</span>查看详情</button>
            <button role="menuitem" onClick={() => { const id = cardMenu.id; setCardMenu(null); exportCard(id); }}><span>⤓</span>导出</button>
            <button role="menuitem" className="danger" onClick={() => { const id = cardMenu.id; setCardMenu(null); setConfirmDeleteId(id); }}><span>×</span>删除</button>
          </div>
        </>
      )}

      {newShelfOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setNewShelfOpen(false)}>
          <div className="shelf-modal" role="dialog" aria-modal="true" aria-labelledby="new-shelf-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setNewShelfOpen(false)} aria-label="关闭">×</button>
            <span className="modal-icon">▰</span>
            <h2 id="new-shelf-title">新建书架</h2>
            <p>像整理小说一样，为一组角色卡留出专属位置。</p>
            <input autoFocus value={newShelfName} onChange={(event) => setNewShelfName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createShelf()} placeholder="例如：世界观共创" />
            <div><button className="modal-cancel" onClick={() => setNewShelfOpen(false)}>取消</button><button className="modal-create" onClick={createShelf}>创建书架</button></div>
          </div>
        </div>
      )}

      {tavernPanelOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTavernPanelOpen(false)}>
          <div className="tavern-modal" role="dialog" aria-modal="true" aria-labelledby="tavern-launch-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setTavernPanelOpen(false)} aria-label="关闭">×</button>
            <div className="tavern-modal-header">
              <span className={`tavern-emblem phase-${tavernProgress.phase}`}>{tavernProgress.phase === "ready" ? "✓" : "▶"}</span>
              <div>
                <small>
                  {settings?.tavernEmbedded
                    ? `内置酒馆${settings.embeddedVersion ? ` · SillyTavern ${settings.embeddedVersion}` : ""}`
                    : settings?.detectedDir || tavernProgress.detail}
                </small>
                <h2 id="tavern-launch-title">{tavernProgress.message}</h2>
                <p>{tavernProgress.detail}</p>
              </div>
            </div>

            <div className="launch-progress-summary">
              <span>启动进度</span><strong>{Math.round(tavernProgress.progress)}%</strong>
            </div>
            <div className="launch-progress-bar"><i style={{ width: `${tavernProgress.progress}%` }} /></div>

            <div className="launch-steps">
              {[
                [settings?.tavernEmbedded ? "准备内置酒馆" : "检查安装目录", 8],
                ["启动酒馆服务", 28],
                ["等待酒馆服务", 36],
                ["端口就绪并打开", 100],
              ].map(([label, threshold], index) => {
                const completed = tavernProgress.progress >= Number(threshold) && tavernProgress.phase !== "error";
                const active = !completed && tavernProgress.phase !== "error" && index === (tavernProgress.progress < 28 ? 0 : tavernProgress.progress < 36 ? 1 : tavernProgress.progress < 100 ? 2 : 3);
                return <div key={String(label)} className={`${completed ? "completed" : ""} ${active ? "active" : ""}`}><i>{completed ? "✓" : index + 1}</i><span>{label}</span></div>;
              })}
            </div>

            <div className="launch-log" aria-live="polite">
              <div><span>启动日志</span><em>端口 {tavernProgress.port}</em></div>
              <pre>{tavernProgress.logs.length ? tavernProgress.logs.join("\n") : "等待启动…"}</pre>
            </div>

            <div className="tavern-modal-actions">
              <span>
                {settings?.tavernEmbedded
                  ? "内置酒馆随应用启动，应用退出时自动关闭，数据保存在用户目录"
                  : "调用 Start.bat，不会修改酒馆本体，也不会重复打开页面"}
              </span>
              {settings?.tavernEmbedded && tavernProgress.phase === "ready" && (
                <button className="secondary" onClick={() => void openTavernInBrowser()}>在浏览器打开</button>
              )}
              <button
                className={tavernProgress.phase === "error" ? "retry" : ""}
                disabled={["checking", "starting", "waiting"].includes(tavernProgress.phase)}
                onClick={() => {
                  if (settings?.tavernEmbedded && tavernProgress.phase === "ready") void openTavernInApp();
                  else void launchTavern();
                }}
              >
                {settings?.tavernEmbedded && tavernProgress.phase === "ready"
                  ? "进入酒馆"
                  : tavernProgress.phase === "ready"
                    ? "再次打开"
                    : tavernProgress.phase === "error"
                      ? "重新尝试"
                      : "正在启动"}
              </button>
            </div>

            {tavernProgress.phase === "error" && settings && !settings.dirExists && !settings.tavernEmbedded && (
              <div className="tavern-dir-fix">
                <span>没有找到酒馆安装目录，换目录了？</span>
                {settings.embeddedAvailable && <button onClick={() => void switchTavernMode(true)}>改用内置酒馆</button>}
                <button onClick={() => void pickTavernDir()}>选择酒馆目录</button>
              </div>
            )}
          </div>
        </div>
      )}

      {bulkModal === "tag" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setBulkModal(null)}>
          <div className="shelf-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-tag-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setBulkModal(null)} aria-label="关闭">×</button>
            <span className="modal-icon">#</span>
            <h2 id="bulk-tag-title">批量添加标签</h2>
            <p>可输入多个标签，用逗号或空格分隔，将同时添加到已选的 {bulkSelected.size} 张角色卡。</p>
            <input autoFocus value={bulkTagDraft} onChange={(event) => setBulkTagDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void applyBulkTag()} placeholder="例如：温柔, 幻想 陪伴" />
            <div><button className="modal-cancel" onClick={() => setBulkModal(null)}>取消</button><button className="modal-create" onClick={() => void applyBulkTag()}>添加标签</button></div>
          </div>
        </div>
      )}

      {bulkModal === "shelf" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setBulkModal(null)}>
          <div className="shelf-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-shelf-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setBulkModal(null)} aria-label="关闭">×</button>
            <span className="modal-icon">▰</span>
            <h2 id="bulk-shelf-title">批量移入书架</h2>
            <p>将已选的 {bulkSelected.size} 张角色卡移入同一书架。</p>
            <select className="bulk-shelf-select" value={bulkShelf} onChange={(event) => setBulkShelf(event.target.value)}>
              <option value="未分类">未分类</option>
              {allShelves.filter((shelf) => shelf !== "未分类").map((shelf) => <option key={shelf}>{shelf}</option>)}
            </select>
            <div><button className="modal-cancel" onClick={() => setBulkModal(null)}>取消</button><button className="modal-create" onClick={applyBulkShelf}>移入书架</button></div>
          </div>
        </div>
      )}

      {bulkModal === "rating" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setBulkModal(null)}>
          <div className="shelf-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-rating-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setBulkModal(null)} aria-label="关闭">×</button>
            <span className="modal-icon">★</span>
            <h2 id="bulk-rating-title">批量评分</h2>
            <p>为已选的 {bulkSelected.size} 张角色卡设置相同评分。</p>
            <div className="bulk-rating-picker">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} className={star <= bulkRating ? "filled" : ""} onClick={() => setBulkRating(star)} aria-label={`设为${star}星`}>★</button>
              ))}
            </div>
            <div><button className="modal-cancel" onClick={() => setBulkModal(null)}>取消</button><button className="modal-create" onClick={applyBulkRating} disabled={!bulkRating}>确认评分</button></div>
          </div>
        </div>
      )}

      {bulkModal === "delete" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setBulkModal(null)}>
          <div className="shelf-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setBulkModal(null)} aria-label="关闭">×</button>
            <span className="modal-icon danger">×</span>
            <h2 id="bulk-delete-title">确认批量删除</h2>
            <p>将从卡库中删除已选的 {bulkSelected.size} 张角色卡。此操作无法撤销。</p>
            <div><button className="modal-cancel" onClick={() => setBulkModal(null)}>取消</button><button className="modal-create delete" onClick={applyBulkDelete}>确认删除</button></div>
          </div>
        </div>
      )}

      {confirmDeleteId && confirmDeleteCard && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmDeleteId(null)}>
          <div className="shelf-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="single-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setConfirmDeleteId(null)} aria-label="关闭">×</button>
            <span className="modal-icon danger">×</span>
            <h2 id="single-delete-title">删除角色卡</h2>
            <p>确定要删除「{confirmDeleteCard.name}」吗？此操作无法撤销。</p>
            <div><button className="modal-cancel" onClick={() => setConfirmDeleteId(null)}>取消</button><button className="modal-create delete" onClick={() => void deleteCard(confirmDeleteCard.id)}>确认删除</button></div>
          </div>
        </div>
      )}

      {isDesktop && settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div className="shelf-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button>
            <span className="modal-icon">⚙</span>
            <h2 id="settings-title">设置</h2>

            <div className="settings-field">
              <label>酒馆运行方式</label>
              <div className="settings-mode-row">
                <button
                  type="button"
                  className={`settings-mode-option ${settings?.tavernEmbedded ? "active" : ""}`}
                  disabled={!settings?.embeddedAvailable}
                  onClick={() => { if (!settings?.tavernEmbedded) void switchTavernMode(true); }}
                >
                  <strong>内置酒馆</strong>
                  <span>{settings?.embeddedVersion ? `SillyTavern ${settings.embeddedVersion} · 随应用退出` : "此版本未内置"}</span>
                </button>
                <button
                  type="button"
                  className={`settings-mode-option ${!settings?.tavernEmbedded ? "active" : ""}`}
                  onClick={() => { if (settings?.tavernEmbedded) void switchTavernMode(false); }}
                >
                  <strong>外部安装</strong>
                  <span>使用电脑上已有的 SillyTavern 目录</span>
                </button>
              </div>
              <p className="settings-hint">
                内置酒馆的角色与聊天数据保存在用户目录，与外部安装互不影响；切换运行方式不会移动任何数据。
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="tavern-dir-input">{settings?.tavernEmbedded ? "外部酒馆目录（未启用）" : "酒馆安装目录"}</label>
              <div className="settings-dir-row">
                <input id="tavern-dir-input" readOnly value={settings?.detectedDir ?? ""} />
                <button onClick={() => void pickTavernDir()}>浏览…</button>
              </div>
              <p className={`settings-hint ${settings?.tavernEmbedded ? "" : settings?.dirExists ? "ok" : "warn"}`}>
                {settings?.tavernEmbedded
                  ? "当前使用内置酒馆；切换到「外部安装」后此目录才会生效"
                  : settings?.dirExists
                    ? settings?.sillyTavernDir ? "已手动配置，目录有效" : "自动检测到该目录，也可手动指定"
                    : "目录不存在，请点击「浏览」选择 SillyTavern 安装目录"}
              </p>
            </div>

            <div className="settings-field">
              <label>应用与更新</label>
              <div className="settings-update">
                <div className="settings-version">
                  <strong>酒馆角色卡库 v{settings?.appVersion ?? "-"}</strong>
                  <span>{settings?.isPortable ? "便携版：请到 GitHub Releases 下载新版" : "安装版：启动时自动检查更新"}</span>
                </div>
                <button onClick={() => void checkForUpdates()} disabled={updateChecking}>
                  {updateChecking ? "正在检查…" : "检查更新"}
                </button>
              </div>
              {updateStatus?.event === "available" && (
                <div className="update-banner">
                  <span>发现新版本 v{updateStatus.version ?? ""}，正在后台下载…</span>
                </div>
              )}
              {updateStatus?.event === "progress" && (
                <div className="update-banner"><span>正在下载更新… {updateStatus.percent}%</span></div>
              )}
              {updateStatus?.event === "downloaded" && (
                <div className="update-banner">
                  <span>新版本 v{updateStatus.version ?? ""} 已就绪</span>
                  <button onClick={installUpdate}>立即重启更新</button>
                </div>
              )}
              {updateStatus?.event === "not-available" && (
                <div className="update-banner ok"><span>当前已是最新版本</span></div>
              )}
              {updateStatus?.event === "error" && (
                <div className="update-banner error"><span>{updateStatus.message ?? "检查更新失败"}</span></div>
              )}
            </div>
          </div>
        </div>
      )}

      {isDesktop && backupsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setBackupsOpen(false)}>
          <div className="shelf-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="backups-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setBackupsOpen(false)} aria-label="关闭">×</button>
            <span className="modal-icon">▰</span>
            <h2 id="backups-title">备份与恢复</h2>
            <p className="settings-hint">编辑卡库时自动备份，最多保留 5 份。恢复前会先把当前数据另存为备份。</p>
            {backups?.length ? (
              <div className="backups-list">
                {backups.map((backup) => (
                  <div key={backup.name} className="backup-item">
                    <div>
                      <span>{formatDateTime(backup.mtime)}</span>
                      <small>{backup.cardCount} 张角色卡 · {formatBytes(backup.size)}</small>
                    </div>
                    <button onClick={() => void restoreBackup(backup.name)}>恢复</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="backups-empty">还没有备份，保存卡库后会自动生成</div>
            )}
            <div className="backups-actions">
              <button onClick={() => void createBackupNow()}>立即备份</button>
            </div>
          </div>
        </div>
      )}

      {aboutOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAboutOpen(false)}>
          <div className="shelf-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setAboutOpen(false)} aria-label="关闭">×</button>
            <span className="modal-icon">ℹ</span>
            <h2 id="about-title">关于酒馆角色卡库</h2>
            <p className="settings-hint">
              v{settings?.appVersion ?? "0.6.0"} · 中文 SillyTavern 角色卡管理器与一键启动器。
              支持导入 PNG / WEBP / JSON 角色卡、书架整理、评分标签、启动酒馆、导出与自动备份。
            </p>
            <p className="settings-hint">
              <a href="https://github.com/Sanqianli-24/tavern-vault-character-card-manager" target="_blank" rel="noreferrer">GitHub 仓库与新版下载</a>
            </p>
            {settings?.embeddedVersion && (
              <p className="settings-hint">
                内置 SillyTavern v{settings.embeddedVersion}（AGPL-3.0 开源，github.com/SillyTavern/SillyTavern），
                完整源码随安装包一并提供。
              </p>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind === "error" ? "error" : ""}`} role="status" aria-live="polite">
          <span aria-hidden="true">{toast.kind === "error" ? "✕" : "✓"}</span>
          {toast.text}
        </div>
      )}
    </div>
  );
}
