"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

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

type ThemeName = "dark" | "fresh";

const THEMES: { id: ThemeName; label: string; icon: string }[] = [
  { id: "dark", label: "深邃", icon: "◐" },
  { id: "fresh", label: "清新", icon: "❀" },
];
const THEME_STORAGE_KEY = "tavern-vault-theme";

const themeListeners = new Set<() => void>();

function readTheme(): ThemeName {
  return document.documentElement.dataset.theme === "fresh" ? "fresh" : "dark";
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
  detail: "等待启动 D:\\SillyTavern",
  port: 8000,
  logs: [],
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  const now = new Date("2026-08-08T12:00:00+08:00");
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
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

export default function CharacterManager() {
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeShelf, setActiveShelf] = useState("收藏夹");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeRating, setActiveRating] = useState("all");
  const [activeType, setActiveType] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("explorer");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [detailOpen, setDetailOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  const [newShelfOpen, setNewShelfOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [customShelves, setCustomShelves] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as ThemeName);
  const [tavernPanelOpen, setTavernPanelOpen] = useState(false);
  const [tavernProgress, setTavernProgress] = useState<TavernLaunchProgress>(initialTavernProgress);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<null | "tag" | "shelf" | "rating" | "delete">(null);
  const [bulkTagDraft, setBulkTagDraft] = useState("");
  const [bulkShelf, setBulkShelf] = useState("未分类");
  const [bulkRating, setBulkRating] = useState(0);
  const [hydratingAll, setHydratingAll] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingUpdatesRef = useRef<Map<string, { timer: number; patch: Partial<CharacterCard> }>>(new Map());
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if ((stored === "dark" || stored === "fresh") && readTheme() !== stored) applyTheme(stored);
  }, []);

  useEffect(() => {
    if (window.desktopAPI) {
      setIsDesktop(true);
      window.desktopAPI.listCards()
        .then((storedCards) => setCards(storedCards as CharacterCard[]))
        .catch(() => setToast("读取本地角色卡失败"));
      window.desktopAPI.getTavernStatus().then(setTavernProgress).catch(() => undefined);
      return window.desktopAPI.onTavernProgress(setTavernProgress);
    }
    fetch("/api/cards")
      .then((response) => response.json() as Promise<{ cards?: CharacterCard[] }>)
      .then((data) => {
        if (data.cards?.length) setCards((current) => [...current, ...data.cards!]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
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

  function toggleTag(tag: string) {
    setActiveTags((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag]);
  }

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

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setBulkSelected(new Set(filteredCards.map((card) => card.id)));
      }
      if (event.key === "Escape" && bulkSelected.size) {
        setBulkSelected(new Set());
        setBulkModal(null);
      }
      if (event.key === "Escape" && dragging) setDragging(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bulkSelected.size, dragging, filteredCards]);

  async function updateCard(id: string, patch: Partial<CharacterCard>) {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...patch, modifiedAt: new Date().toISOString() } : card));
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
          save(patchToSave).catch(() => setToast("保存更改失败"));
        }, 320),
        patch: mergedPatch,
      });
    };
    if (window.desktopAPI) {
      if (id.startsWith("local-")) return;
      scheduleSave((merged) => window.desktopAPI!.updateCard(id, merged));
      return;
    }
    if (id.startsWith("local-")) return;
    scheduleSave((merged) => fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(merged),
    }));
  }

  async function importFiles(fileList: FileList | File[]) {
    const accepted = Array.from(fileList).filter((file) => /\.(png|webp|json)$/i.test(file.name));
    if (!accepted.length) {
      setToast("请选择 PNG、WEBP 或 JSON 角色卡");
      return;
    }
    setImporting(true);
    if (window.desktopAPI) {
      try {
        const entries: DesktopImportEntry[] = [];
        for (const file of accepted) {
          let parsedName = fileBaseName(file.name);
          if (/\.json$/i.test(file.name)) {
            try {
              const json = JSON.parse(await file.text()) as { name?: string; data?: { name?: string } };
              parsedName = json.data?.name || json.name || parsedName;
            } catch {
              // The filename remains the display name for malformed JSON.
            }
          }
          entries.push({ file, suggestedName: parsedName, sourcePath: file.webkitRelativePath || file.name });
        }
        const imported = await window.desktopAPI.importCards(entries) as CharacterCard[];
        if (!imported.length) throw new Error("没有可导入的文件");
        setCards((current) => [...imported, ...current]);
        setSelectedId(imported[0].id);
        setDetailOpen(true);
        setActiveShelf("全部角色");
        setToast(`已导入 ${imported.length} 张角色卡`);
      } catch {
        setToast("导入失败，请确认文件仍然存在");
      } finally {
        setImporting(false);
      }
      return;
    }
    let added = 0;
    for (const file of accepted) {
      let parsedName = fileBaseName(file.name);
      if (/\.json$/i.test(file.name)) {
        try {
          const json = JSON.parse(await file.text()) as { name?: string; data?: { name?: string } };
          parsedName = json.data?.name || json.name || parsedName;
        } catch {
          // Keep the filename when a JSON card cannot be parsed.
        }
      }
      const now = new Date().toISOString();
      const localId = `local-${crypto.randomUUID()}`;
      const localCard: CharacterCard = {
        id: localId,
        name: parsedName,
        fileName: file.name,
        fileType: file.type || (/\.json$/i.test(file.name) ? "application/json" : "image/png"),
        size: file.size,
        rating: 0,
        tags: [],
        bookshelf: "未分类",
        image: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
        description: "刚刚导入的角色卡，等待你补充标签与简介。",
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
        const form = new FormData();
        form.set("file", file);
        form.set("name", parsedName);
        form.set("fileName", file.name);
        form.set("fileType", localCard.fileType);
        form.set("sourcePath", localCard.sourcePath);
        form.set("bookshelf", "未分类");
        const response = await fetch("/api/cards", { method: "POST", body: form });
        if (!response.ok) throw new Error("upload failed");
        const result = await response.json() as { card: CharacterCard | null };
        if (result.card) {
          setCards((current) => current.map((card) => card.id === localId ? result.card! : card));
          setSelectedId((current) => current === localId ? result.card!.id : current);
        }
      } catch {
        // The optimistic card stays usable if remote persistence is unavailable.
      }
    }
    setImporting(false);
    setActiveShelf("全部角色");
    setToast(`已导入 ${added} 张角色卡`);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void importFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files);
  }

  function openDetails(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
    setTagDraft("");
    if (window.desktopAPI) {
      window.desktopAPI.hydrateCard(id)
        .then((hydrated) => {
          if (!hydrated) return;
          setCards((current) => current.map((card) => card.id === hydrated.id ? { ...card, ...hydrated } : card));
        })
        .catch(() => undefined);
    }
  }

  function handleCardKey(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails(id);
    }
  }

  function addTag() {
    const tags = parseTagsInput(tagDraft);
    if (!selected || !tags.length) return;
    const merged = Array.from(new Set([...selected.tags, ...tags]));
    if (merged.length === selected.tags.length) return;
    void updateCard(selected.id, { tags: merged });
    setTagDraft("");
    setToast(`已添加 ${tags.length} 个标签`);
  }

  function createShelf() {
    const value = newShelfName.trim();
    if (!value) return;
    setCustomShelves((current) => Array.from(new Set([...current, value])));
    setActiveShelf(value);
    setNewShelfName("");
    setNewShelfOpen(false);
    setToast(`已创建书架「${value}」`);
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
      setCards(stored as CharacterCard[]);
      setToast(result.hydrated > 0 ? `已补读 ${result.hydrated} 张角色卡的角色信息` : "没有需要补读的旧卡");
    } catch {
      setToast("补读失败，请重试");
    } finally {
      setHydratingAll(false);
    }
  }

  const bulkCards = cards.filter((card) => bulkSelected.has(card.id));
  const allVisibleSelected = filteredCards.length > 0 && filteredCards.every((card) => bulkSelected.has(card.id));

  function toggleBulk(id: string) {
    setBulkSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        .catch(() => setToast("批量移动书架失败"));
    } else {
      for (const card of bulkCards) {
        if (!card.id.startsWith("local-")) void updateCard(card.id, { bookshelf: bulkShelf });
      }
    }
    setCards((current) => current.map((card) => bulkSelected.has(card.id) ? { ...card, bookshelf: bulkShelf, modifiedAt: new Date().toISOString() } : card));
    setToast(`已将 ${bulkCards.length} 张角色卡移入「${bulkShelf}」`);
    clearBulk();
  }

  function applyBulkRating() {
    if (!bulkCards.length || !bulkRating) return;
    const ids = bulkCards.map((card) => card.id);
    if (window.desktopAPI) {
      window.desktopAPI.updateCards(ids, { rating: bulkRating })
        .catch(() => setToast("批量评分失败"));
    } else {
      for (const card of bulkCards) {
        if (!card.id.startsWith("local-")) void updateCard(card.id, { rating: bulkRating });
      }
    }
    setCards((current) => current.map((card) => bulkSelected.has(card.id) ? { ...card, rating: bulkRating, modifiedAt: new Date().toISOString() } : card));
    setToast(`已为 ${bulkCards.length} 张角色卡评分`);
    clearBulk();
  }

  async function applyBulkTag() {
    const values = parseTagsInput(bulkTagDraft);
    if (!bulkCards.length || !values.length) return;
    const realCards = bulkCards;
    if (window.desktopAPI) {
      try {
        await Promise.all(realCards.map((card) => {
          const merged = Array.from(new Set([...card.tags, ...values]));
          return merged.length === card.tags.length
            ? Promise.resolve(0)
            : window.desktopAPI!.updateCard(card.id, { tags: merged });
        }));
      } catch {
        setToast("批量添加标签失败");
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
    setToast(`已为 ${bulkCards.length} 张角色卡添加 ${values.length} 个标签`);
    clearBulk();
  }

  function applyBulkDelete() {
    if (!bulkCards.length) return;
    const ids = bulkCards.map((card) => card.id);
    if (window.desktopAPI) {
      window.desktopAPI.deleteCards(ids)
        .catch(() => setToast("批量删除失败"));
    } else {
      for (const card of bulkCards) {
        if (!card.id.startsWith("local-")) {
          fetch(`/api/cards/${card.id}`, { method: "DELETE" }).catch(() => undefined);
        }
      }
    }
    setCards((current) => current.filter((card) => !bulkSelected.has(card.id)));
    if (selectedId && bulkSelected.has(selectedId)) {
      const remaining = cards.find((card) => !bulkSelected.has(card.id));
      setSelectedId(remaining?.id ?? "");
    }
    setToast(`已删除 ${bulkCards.length} 张角色卡`);
    clearBulk();
  }

  return (
    <div className="vault-app">
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
          <div className="storage-copy"><span>卡库空间</span><small>本地与云端同步</small></div>
          <div className="storage-bar"><i style={{ width: `${Math.min(84, 18 + cards.length * 2)}%` }} /></div>
          <div className="storage-meta"><span>{cards.length} 张角色卡</span><span>自动保存</span></div>
        </div>
      </aside>

      <main
        className={`workspace ${detailOpen && selected ? "with-detail" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (Array.from(event.dataTransfer.types).includes("Files")) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <header className="topbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色、标签或文件名…" aria-label="搜索角色卡" />
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
            <button
              className="theme-toggle"
              onClick={() => applyTheme(theme === "dark" ? "fresh" : "dark")}
              aria-label={`切换界面主题，当前为${THEMES.find((item) => item.id === theme)?.label}主题`}
              title="切换界面主题"
            >
              <span aria-hidden="true">{THEMES.find((item) => item.id === theme)?.icon}</span>
              {THEMES.find((item) => item.id === theme)?.label}
            </button>
            <button className="more-button" aria-label="更多选项">•••</button>
          </div>
        </header>

        <section className="library">
          <div className="library-title-row">
            <div>
              <div className="breadcrumbs"><span>书架</span><b>/</b><span>{activeShelf}</span></div>
              <h1>{activeShelf}</h1>
              <p>{filteredCards.length} 张角色卡 · 上次整理于今天</p>
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
                <button className="danger" onClick={() => setBulkModal("delete")}><span>×</span>删除</button>
              </div>
              <button className="bulk-clear" onClick={clearBulk}>取消选择</button>
            </div>
          )}

          {filteredCards.length ? (
            <div className={view === "grid" ? "character-grid" : "character-list"}>
              {filteredCards.map((card) => (
                <article
                  key={card.id}
                  className={`character-card ${selectedId === card.id && detailOpen ? "selected" : ""} ${bulkSelected.has(card.id) ? "bulk-selected" : ""}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => openDetails(card.id)}
                  onKeyDown={(event) => handleCardKey(event, card.id)}
                >
                  <button
                    className={`card-check ${bulkSelected.has(card.id) ? "checked" : ""}`}
                    aria-label={bulkSelected.has(card.id) ? `取消选择${card.name}` : `选择${card.name}`}
                    onClick={(event) => { event.stopPropagation(); toggleBulk(card.id); }}
                  >
                    <i>{bulkSelected.has(card.id) ? "✓" : ""}</i>
                  </button>
                  <div className="card-art" style={{ "--card-accent": card.accent ?? "#7158c9" } as React.CSSProperties}>
                    {card.image ? <img src={card.image} alt="" loading="lazy" decoding="async" /> : <span className="initials">{initials(card.name)}</span>}
                    <span className="format-badge">{card.fileType.includes("json") ? "JSON" : card.fileType.includes("webp") ? "WEBP" : "PNG"}</span>
                    <button
                      className={`card-favorite ${card.favorite ? "active" : ""}`}
                      aria-label={card.favorite ? `取消收藏${card.name}` : `收藏${card.name}`}
                      aria-pressed={card.favorite === true}
                      onClick={(event) => { event.stopPropagation(); void updateCard(card.id, { favorite: !card.favorite }); }}
                    >{card.favorite ? "♥" : "♡"}</button>
                    <button className="card-menu" aria-label={`${card.name}更多选项`} onClick={(event) => { event.stopPropagation(); openDetails(card.id); }}>•••</button>
                    <div className="art-fade" />
                    <div className="card-rating" aria-label={`${card.rating}星`}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          className={star <= card.rating ? "filled" : ""}
                          aria-label={`设为${star}星`}
                          onClick={(event) => { event.stopPropagation(); void updateCard(card.id, { rating: card.rating === star ? 0 : star }); }}
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
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span>◇</span><h2>没有找到角色卡</h2><p>试试更换筛选条件，或导入新的 PNG、WEBP、JSON 角色卡。</p>
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
            <button className="drop-close" onClick={() => setDragging(false)} aria-label="关闭导入提示">×</button>
            <div><span>＋</span><strong>松开即可导入角色卡</strong><small>支持 PNG、WEBP 与 JSON 文件</small></div>
          </div>
        )}
      </main>

      {detailOpen && selected && (
        <aside className="detail-panel" aria-label="角色卡详情">
          <div className="detail-head">
            <div><span className="live-dot" /> 角色卡详情</div>
            <button aria-label="关闭详情" onClick={() => setDetailOpen(false)}>×</button>
          </div>
          <div className="detail-scroll">
            <div className="detail-cover" style={{ "--card-accent": selected.accent ?? "#7158c9" } as React.CSSProperties}>
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
          <div className="detail-footer"><span>所有更改均已自动保存</span><i>✓</i></div>
        </aside>
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
                <small>D:\\SillyTavern</small>
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
                ["检查安装目录", 8],
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
              <span>调用 Start.bat，不会修改酒馆本体，也不会重复打开页面</span>
              <button
                className={tavernProgress.phase === "error" ? "retry" : ""}
                disabled={["checking", "starting", "waiting"].includes(tavernProgress.phase)}
                onClick={() => void launchTavern()}
              >
                {tavernProgress.phase === "ready" ? "再次打开" : tavernProgress.phase === "error" ? "重新尝试" : "正在启动"}
              </button>
            </div>
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

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}
