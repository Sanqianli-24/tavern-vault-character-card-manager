"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

type CharacterCard = {
  id: string;
  name: string;
  fileName: string;
  fileType: string;
  size: number;
  rating: number;
  tags: string[];
  bookshelf: string;
  image: string;
  description: string;
  sourcePath: string;
  createdAt: string;
  modifiedAt: string;
  accent?: string;
  demo?: boolean;
};

type SortMode = "explorer" | "name-desc" | "newest" | "oldest" | "rating" | "size";

const demoCards: CharacterCard[] = [
  {
    id: "demo-luna",
    name: "露娜・月下信使",
    fileName: "Luna_Moonlit_Messenger.png",
    fileType: "image/png",
    size: 2486000,
    rating: 5,
    tags: ["温柔", "幻想", "陪伴"],
    bookshelf: "最爱角色",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=720&q=88",
    description: "来自银月城的秘密信使。她总在午夜敲响窗户，带来一封没有署名的信。",
    sourcePath: "Fantasy/Luna_Moonlit_Messenger.png",
    createdAt: "2026-08-03T19:24:00.000Z",
    modifiedAt: "2026-08-07T14:32:00.000Z",
    accent: "#8e71d9",
    demo: true,
  },
  {
    id: "demo-shen",
    name: "沈砚",
    fileName: "Shen_Yan_v3.png",
    fileType: "image/png",
    size: 3194000,
    rating: 4,
    tags: ["古风", "谋士", "慢热"],
    bookshelf: "长线剧情",
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=720&q=88",
    description: "寡言的年轻谋士，擅长在棋局里藏下只有你能读懂的暗语。",
    sourcePath: "LongStory/Shen_Yan_v3.png",
    createdAt: "2026-07-29T10:12:00.000Z",
    modifiedAt: "2026-08-06T20:01:00.000Z",
    accent: "#9a6e55",
    demo: true,
  },
  {
    id: "demo-nora",
    name: "诺拉 2.1",
    fileName: "Nora_2.1.webp",
    fileType: "image/webp",
    size: 1857000,
    rating: 5,
    tags: ["赛博朋克", "雇佣兵"],
    bookshelf: "最爱角色",
    image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=720&q=88",
    description: "霓虹雨夜中的A级雇佣兵。她不相信承诺，只相信已经上膛的武器。",
    sourcePath: "Cyberpunk/Nora_2.1.webp",
    createdAt: "2026-08-06T08:42:00.000Z",
    modifiedAt: "2026-08-06T08:42:00.000Z",
    accent: "#d0649b",
    demo: true,
  },
  {
    id: "demo-summer",
    name: "夏川遥",
    fileName: "Natsukawa_Haruka.png",
    fileType: "image/png",
    size: 2740000,
    rating: 3,
    tags: ["校园", "青梅竹马"],
    bookshelf: "日常轻松",
    image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=720&q=88",
    description: "住在隔壁的青梅竹马，习惯把真正想说的话写进借给你的书里。",
    sourcePath: "Daily/Natsukawa_Haruka.png",
    createdAt: "2026-07-17T13:12:00.000Z",
    modifiedAt: "2026-08-04T17:25:00.000Z",
    accent: "#d58d69",
    demo: true,
  },
  {
    id: "demo-kael",
    name: "凯尔・灰烬骑士",
    fileName: "Kael_Ash_Knight.png",
    fileType: "image/png",
    size: 4029000,
    rating: 4,
    tags: ["奇幻", "骑士", "救赎"],
    bookshelf: "长线剧情",
    image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=720&q=88",
    description: "失去封地与姓氏的骑士，仍在为一场无人记得的战争守夜。",
    sourcePath: "LongStory/Kael_Ash_Knight.png",
    createdAt: "2026-06-21T09:33:00.000Z",
    modifiedAt: "2026-08-02T22:14:00.000Z",
    accent: "#7c7066",
    demo: true,
  },
  {
    id: "demo-iris",
    name: "伊里斯",
    fileName: "Iris_Oracle.json",
    fileType: "application/json",
    size: 186000,
    rating: 0,
    tags: ["神秘", "预言家"],
    bookshelf: "待体验",
    image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=720&q=88",
    description: "她能看见每一个人的未来，唯独看不见你。",
    sourcePath: "Unplayed/Iris_Oracle.json",
    createdAt: "2026-08-07T11:07:00.000Z",
    modifiedAt: "2026-08-07T11:07:00.000Z",
    accent: "#4f7ca5",
    demo: true,
  },
  {
    id: "demo-7",
    name: "安 07",
    fileName: "Ann_07.png",
    fileType: "image/png",
    size: 2140000,
    rating: 4,
    tags: ["都市", "侦探"],
    bookshelf: "悬疑推理",
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=720&q=88",
    description: "经营着一家只在雨天营业的侦探事务所。",
    sourcePath: "Mystery/Ann_07.png",
    createdAt: "2026-07-30T06:41:00.000Z",
    modifiedAt: "2026-08-01T16:40:00.000Z",
    accent: "#397c78",
    demo: true,
  },
  {
    id: "demo-12",
    name: "安 12",
    fileName: "Ann_12.png",
    fileType: "image/png",
    size: 2290000,
    rating: 2,
    tags: ["都市", "平行世界"],
    bookshelf: "待整理",
    image: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=720&q=88",
    description: "来自另一条时间线的安，似乎认识一个完全不同的你。",
    sourcePath: "Inbox/Ann_12.png",
    createdAt: "2026-08-05T13:19:00.000Z",
    modifiedAt: "2026-08-05T13:19:00.000Z",
    accent: "#b05e72",
    demo: true,
  },
];

const presetShelves = ["最爱角色", "长线剧情", "日常轻松", "悬疑推理", "待体验", "待整理"];
const explorerCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

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

export default function CharacterManager() {
  const [cards, setCards] = useState<CharacterCard[]>(demoCards);
  const [selectedId, setSelectedId] = useState(demoCards[0].id);
  const [query, setQuery] = useState("");
  const [activeShelf, setActiveShelf] = useState("全部角色");
  const [activeTag, setActiveTag] = useState("全部标签");
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
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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

  const filteredCards = useMemo(() => {
    const lowered = query.trim().toLocaleLowerCase("zh-CN");
    const filtered = cards.filter((card) => {
      const matchesQuery = !lowered || [card.name, card.fileName, ...card.tags]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(lowered);
      const matchesShelf = activeShelf === "全部角色"
        || (activeShelf === "最近导入" && Date.now() - new Date(card.createdAt).getTime() < 7 * 86400000)
        || (activeShelf === "未分类" && card.bookshelf === "未分类")
        || card.bookshelf === activeShelf;
      const matchesTag = activeTag === "全部标签" || card.tags.includes(activeTag);
      return matchesQuery && matchesShelf && matchesTag;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "name-desc") return explorerCollator.compare(b.name, a.name);
      if (sortMode === "newest") return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      if (sortMode === "oldest") return new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
      if (sortMode === "rating") return b.rating - a.rating || explorerCollator.compare(a.name, b.name);
      if (sortMode === "size") return b.size - a.size;
      return explorerCollator.compare(a.name, b.name);
    });
  }, [activeShelf, activeTag, cards, query, sortMode]);

  async function updateCard(id: string, patch: Partial<CharacterCard>) {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...patch, modifiedAt: new Date().toISOString() } : card));
    if (id.startsWith("demo-") || id.startsWith("local-")) return;
    const persisted = Object.fromEntries(Object.entries(patch).filter(([key]) => ["name", "rating", "tags", "bookshelf", "description"].includes(key)));
    if (!Object.keys(persisted).length) return;
    fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(persisted),
    }).catch(() => setToast("更改已保留在当前页面"));
  }

  async function importFiles(fileList: FileList | File[]) {
    const accepted = Array.from(fileList).filter((file) => /\.(png|webp|json)$/i.test(file.name));
    if (!accepted.length) {
      setToast("请选择 PNG、WEBP 或 JSON 角色卡");
      return;
    }
    setImporting(true);
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
    setDragging(false);
    if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files);
  }

  function openDetails(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
    setTagDraft("");
  }

  function handleCardKey(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails(id);
    }
  }

  function addTag() {
    const value = tagDraft.trim().replace(/^#/, "");
    if (!selected || !value || selected.tags.includes(value)) return;
    void updateCard(selected.id, { tags: [...selected.tags, value] });
    setTagDraft("");
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

  return (
    <div className="vault-app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Tavern Vault</strong><small>角色卡书架</small></span>
        </div>

        <button className="new-shelf" onClick={() => setNewShelfOpen(true)}><span>＋</span> 新建书架</button>

        <nav className="primary-nav" aria-label="主要分类">
          {[
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
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
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
          </div>

          <div className="toolbar">
            <div className="tag-filters" aria-label="标签筛选">
              <button className={activeTag === "全部标签" ? "active" : ""} onClick={() => setActiveTag("全部标签")}>全部标签</button>
              {allTags.slice(0, 4).map(([tag, count]) => (
                <button key={tag} className={activeTag === tag ? "active" : ""} onClick={() => setActiveTag(tag)}>#{tag} <span>{count}</span></button>
              ))}
            </div>
            <div className="view-controls">
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

          {filteredCards.length ? (
            <div className={view === "grid" ? "character-grid" : "character-list"}>
              {filteredCards.map((card) => (
                <article
                  key={card.id}
                  className={`character-card ${selectedId === card.id && detailOpen ? "selected" : ""}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => openDetails(card.id)}
                  onKeyDown={(event) => handleCardKey(event, card.id)}
                >
                  <div className="card-art" style={{ "--card-accent": card.accent ?? "#7158c9" } as React.CSSProperties}>
                    {card.image ? <img src={card.image} alt="" /> : <span className="initials">{initials(card.name)}</span>}
                    <span className="format-badge">{card.fileType.includes("json") ? "JSON" : card.fileType.includes("webp") ? "WEBP" : "PNG"}</span>
                    <button className="card-menu" aria-label={`${card.name}更多选项`} onClick={(event) => { event.stopPropagation(); openDetails(card.id); }}>•••</button>
                    <div className="art-fade" />
                    <div className="card-rating" aria-label={`${card.rating}星`}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          className={star <= card.rating ? "filled" : ""}
                          aria-label={`设为${star}星`}
                          onClick={(event) => { event.stopPropagation(); void updateCard(card.id, { rating: star }); }}
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
          <div className="drop-zone" onDragLeave={() => setDragging(false)}>
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
              <span className="detail-format">{selected.fileType.includes("json") ? "JSON CARD" : "CHARACTER CARD"}</span>
            </div>
            <div className="detail-title">
              <input value={selected.name} onChange={(event) => void updateCard(selected.id, { name: event.target.value })} aria-label="角色名称" />
              <p>{selected.fileName}</p>
            </div>
            <section className="detail-section">
              <label>我的评分</label>
              <div className="detail-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} className={star <= selected.rating ? "filled" : ""} onClick={() => void updateCard(selected.id, { rating: star })} aria-label={`设为${star}星`}>★</button>
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
                <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTag()} placeholder="输入新标签…" />
                <button onClick={addTag}>添加</button>
              </div>
            </section>
            <section className="detail-section">
              <label>角色印象</label>
              <textarea value={selected.description} onChange={(event) => void updateCard(selected.id, { description: event.target.value })} rows={4} />
            </section>
            <section className="file-details">
              <div><span>文件类型</span><strong>{selected.fileType.includes("json") ? "JSON" : selected.fileType.includes("webp") ? "WEBP" : "PNG"} 角色卡</strong></div>
              <div><span>文件大小</span><strong>{formatBytes(selected.size)}</strong></div>
              <div><span>修改时间</span><strong>{formatDate(selected.modifiedAt)}</strong></div>
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

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}
