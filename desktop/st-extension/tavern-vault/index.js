// 酒馆角色卡库 联动扩展
// 在酒馆角色面板按钮行加入「卡库」入口：浏览/筛选卡库、一键导入并开聊、反向收录酒馆角色。
// 数据全部通过宿主（酒馆角色卡库应用）在酒馆窗口注入的 window.desktopAPI 获取；
// 在未接入宿主的独立酒馆中安装本扩展时，仅显示引导提示。

const MODULE_NAME = 'tavern-vault';
const BUTTON_ID = 'tavern_vault_button';

let PopupLib = null;

function host() {
    return window.desktopAPI || null;
}

function stContext() {
    return (window.SillyTavern && typeof window.SillyTavern.getContext === 'function')
        ? window.SillyTavern.getContext()
        : null;
}

let cachedCsrfToken = null;

// ST 1.19 的 CSRF 令牌由 /csrf-token 接口下发（不落 cookie），取一次缓存复用
async function csrfToken() {
    if (cachedCsrfToken !== null) return cachedCsrfToken;
    try {
        const response = await fetch('/csrf-token');
        const data = await response.json();
        cachedCsrfToken = data.token || '';
    } catch {
        cachedCsrfToken = '';
    }
    return cachedCsrfToken;
}

function toast(kind, message) {
    try {
        if (kind === 'error' && window.toastr?.error) window.toastr.error(message);
        else if (kind === 'warn' && window.toastr?.warning) window.toastr.warning(message);
        else if (window.toastr?.success) window.toastr.success(message);
        else console.log(`[tavern-vault] ${message}`);
    } catch { /* toastr 不可用时静默 */ }
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function loadPopupLib() {
    if (PopupLib) return PopupLib;
    try {
        PopupLib = await import('/scripts/Popup.js');
    } catch {
        PopupLib = null;
    }
    return PopupLib;
}

// ---------- 面板状态与渲染 ----------

const panelState = {
    cards: [],
    tavernCharacters: [],
    search: '',
    tag: '',
    rating: 0,
};

function visibleCards() {
    const search = panelState.search.trim().toLowerCase();
    return panelState.cards.filter((card) => {
        if (search && !card.name.toLowerCase().includes(search)) return false;
        if (panelState.tag && !card.tags.includes(panelState.tag)) return false;
        if (panelState.rating && (card.rating || 0) < panelState.rating) return false;
        return true;
    });
}

function allTags() {
    const tags = new Set();
    for (const card of panelState.cards) for (const tag of card.tags) tags.add(tag);
    return [...tags].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).slice(0, 100);
}

function cardTileHtml(card) {
    const tags = card.tags.slice(0, 3).map((tag) => `<span class="tv-tag">#${tag}</span>`).join('');
    const stars = card.rating
        ? `<span class="tv-stars" title="${card.rating} 星">${'★'.repeat(card.rating)}</span>`
        : '';
    const action = card.imported
        ? `<button class="menu_button tv-act chat" data-id="${card.id}">去聊天</button>`
        : `<button class="menu_button tv-act import" data-id="${card.id}">导入并开聊</button>`;
    return `
        <div class="tv-card" data-id="${card.id}">
            <div class="tv-thumb" data-image="${card.id}"><div class="tv-thumb-fallback">${(card.name || '?').slice(0, 1)}</div></div>
            <div class="tv-name" title="${card.name}">${card.name}</div>
            <div class="tv-meta">${stars}${card.favorite ? '<span class="tv-fav">♥</span>' : ''}</div>
            <div class="tv-tags">${tags}</div>
            ${action}
        </div>`;
}

function panelHtml() {
    const cards = visibleCards();
    const tags = allTags();
    const missing = panelState.tavernCharacters.filter((item) => !item.adopted);
    const tagOptions = ['', ...tags].map((tag) =>
        `<option value="${tag}" ${panelState.tag === tag ? 'selected' : ''}>${tag || '全部标签'}</option>`).join('');
    const ratingOptions = [0, 3, 4, 5].map((value) =>
        `<option value="${value}" ${panelState.rating === value ? 'selected' : ''}>${value === 0 ? '全部评分' : `${value} 星及以上`}</option>`).join('');
    const cardsHtml = cards.length
        ? cards.map(cardTileHtml).join('')
        : '<div class="tv-empty">没有符合条件的角色卡。可以打开「完整卡库管理」导入新卡。</div>';
    const missingHtml = missing.length
        ? `<div class="tv-adopt-list">${missing.map((item) => `
            <div class="tv-adopt-item">
                <span class="tv-adopt-name" title="${item.avatar}">${item.name}</span>
                <button class="menu_button tv-act adopt" data-avatar="${item.avatar}">收进卡库</button>
            </div>`).join('')}</div>`
        : '<div class="tv-empty">酒馆里的角色都已在卡库中。</div>';
    return `
        <div class="tv-panel" id="tv_panel">
            <div class="tv-toolbar">
                <input id="tv_search" class="text_pole textarea_compact" type="text" placeholder="搜索卡库…" value="${panelState.search.replace(/"/g, '&quot;')}" />
                <select id="tv_tag" class="tv-select">${tagOptions}</select>
                <select id="tv_rating" class="tv-select">${ratingOptions}</select>
                <span class="tv-count">共 ${cards.length} 张</span>
                <button class="menu_button tv-full" id="tv_full" title="在酒馆内打开完整的卡库管理">完整管理</button>
            </div>
            <div class="tv-grid">${cardsHtml}</div>
            <div class="tv-section">从酒馆收录（${missing.length} 个未收录）</div>
            ${missingHtml}
            <div class="tv-hint">「完整卡库管理」窗口提供批量整理、书架、备份与设置（酒馆菜单栏 → 角色卡库）。</div>
        </div>`;
}

function hydrateImages() {
    const api = host();
    if (!api) return;
    document.querySelectorAll('.tv-thumb[data-image]').forEach(async (node) => {
        const id = node.dataset.image;
        try {
            const dataUrl = await api.tavernPanelCardImage(id);
            if (dataUrl && node.isConnected) {
                node.innerHTML = '';
                const img = document.createElement('img');
                img.src = dataUrl;
                img.alt = '';
                img.loading = 'lazy';
                node.appendChild(img);
            }
        } catch { /* 无图时保留首字占位 */ }
    });
}

// 事件委托挂到 document：ST 的 Popup 会在 show() 后二次渲染内容节点，
// 绑定在面板节点上的监听器会随之丢失，全局委托则不受影响。
function bindGlobalPanelEvents() {
    if (bindGlobalPanelEvents.done) return;
    bindGlobalPanelEvents.done = true;

    document.addEventListener('input', (event) => {
        const panel = event.target.closest?.('.tv-panel');
        if (!panel) return;
        if (event.target.id === 'tv_search') {
            panelState.search = event.target.value;
            rerenderList(panel);
        }
    });

    document.addEventListener('change', (event) => {
        const panel = event.target.closest?.('.tv-panel');
        if (!panel) return;
        if (event.target.id === 'tv_tag') {
            panelState.tag = event.target.value;
            rerenderList(panel);
        } else if (event.target.id === 'tv_rating') {
            panelState.rating = Number(event.target.value) || 0;
            rerenderList(panel);
        }
    });

    document.addEventListener('click', async (event) => {
        if (!event.target.closest?.('.tv-panel')) return;
        if (event.target.closest('#tv_full')) {
            mountManagerOverlay();
            return;
        }
        const target = event.target.closest('button.tv-act');
        if (!target) return;
        const root = document.querySelector('.tv-panel');
        if (!root) return;
        if (target.classList.contains('import')) await importAndChat(target.dataset.id, root);
        else if (target.classList.contains('chat')) await goChat(target.dataset.id, root);
        else if (target.classList.contains('adopt')) await adopt(target.dataset.avatar, root);
    });
}

function rerenderList(root) {
    const grid = root.querySelector('.tv-grid');
    const count = root.querySelector('.tv-count');
    const section = root.querySelector('.tv-section');
    const list = root.querySelector('.tv-adopt-list, .tv-empty:last-of-type');
    if (!grid) return;
    const cards = visibleCards();
    grid.innerHTML = cards.length ? cards.map(cardTileHtml).join('')
        : '<div class="tv-empty">没有符合条件的角色卡。可以打开「完整卡库管理」导入新卡。</div>';
    if (count) count.textContent = `共 ${cards.length} 张`;
    hydrateImages();
    void section; void list;
}

async function reloadPanelData(root) {
    const api = host();
    if (!api) return;
    panelState.cards = await api.tavernPanelList();
    panelState.tavernCharacters = await api.tavernPanelTavernCharacters();
    if (root && root.isConnected) {
        rerenderList(root);
        const missing = panelState.tavernCharacters.filter((item) => !item.adopted).length;
        const section = root.querySelector('.tv-section');
        if (section) section.textContent = `从酒馆收录（${missing} 个未收录）`;
        const adoptList = root.querySelector('.tv-adopt-list');
        if (adoptList) {
            const items = panelState.tavernCharacters.filter((item) => !item.adopted);
            adoptList.innerHTML = items.length ? items.map((item) => `
                <div class="tv-adopt-item">
                    <span class="tv-adopt-name" title="${item.avatar}">${item.name}</span>
                    <button class="menu_button tv-act adopt" data-avatar="${item.avatar}">收进卡库</button>
                </div>`).join('')
                : '';
            if (!items.length) {
                adoptList.insertAdjacentHTML('beforeend', '<div class="tv-empty">酒馆里的角色都已在卡库中。</div>');
            }
        }
    }
}

// ---------- 动作 ----------

async function importAndChat(id, root) {
    const api = host();
    const ctx = stContext();
    const card = panelState.cards.find((item) => item.id === id);
    if (!api || !card) return;
    try {
        const payload = await api.tavernPanelCardPayload(id);
        if (!payload.ok) throw new Error(payload.error || '读取卡片失败');

        let avatar = null;
        try {
            const format = (payload.fileName.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || 'png';
            const file = new File([base64ToBytes(payload.base64)], payload.fileName, { type: payload.mime });
            const form = new FormData();
            form.append('avatar', file);
            form.append('file_type', format);
            form.append('user_name', (ctx && ctx.name1) || 'User');
            const response = await fetch('/api/characters/import', {
                method: 'POST',
                headers: { 'X-CSRF-Token': await csrfToken() },
                body: form,
            });
            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                // 与 ST 前端一致：响应是 file_name（不带扩展名）
                if (data.file_name) avatar = `${data.file_name}.png`;
            }
        } catch { /* 页内导入失败时走宿主兜底 */ }

        if (!avatar) {
            // 页内导入不可用时由宿主写文件 + 刷新 + 选角
            const result = await api.tavernChatWithCard(id);
            if (!result.ok) throw new Error(result.error || '导入失败');
            toast('success', `已导入「${card.name}」`);
            await reloadPanelData(root);
            return;
        }

        await api.tavernPanelMarkImported(id, avatar);
        if (ctx && typeof ctx.getCharacters === 'function') await ctx.getCharacters();
        const chars = ctx && Array.isArray(ctx.characters) ? ctx.characters : [];
        const index = chars.findIndex((item) => item.avatar === avatar);
        if (ctx && typeof ctx.selectCharacterById === 'function' && index >= 0) {
            await ctx.selectCharacterById(index);
            toast('success', `已导入「${card.name}」，开始聊天吧`);
        } else {
            toast('success', `已导入「${card.name}」`);
        }
        await reloadPanelData(root);
    } catch (error) {
        toast('error', error.message || '导入失败');
    }
}

async function goChat(id, root) {
    const api = host();
    const card = panelState.cards.find((item) => item.id === id);
    if (!api || !card) return;
    try {
        const result = await api.tavernChatWithCard(id);
        if (!result.ok) throw new Error(result.error || '打开聊天失败');
        await reloadPanelData(root);
    } catch (error) {
        toast('error', error.message || '打开聊天失败');
    }
}

async function adopt(avatar, root) {
    const api = host();
    if (!api) return;
    try {
        const result = await api.tavernAdoptCharacter(avatar);
        if (!result.ok) throw new Error(result.error || '收录失败');
        toast('success', '已收进卡库');
        await reloadPanelData(root);
    } catch (error) {
        toast('error', error.message || '收录失败');
    }
}

// ---------- 完整管理覆盖层 ----------
// 把整个卡库管理器（React 应用）作为 srcdoc iframe 装进酒馆页面：
// 样式天然隔离；iframe 里的 desktopAPI 由内联 shim 通过 postMessage 桥接到本页。

let managerFrame = null;

function forwardEvent(method, payload) {
    managerFrame?.contentWindow?.postMessage({ __tv: 'event', method, payload }, '*');
}

function setupManagerBridge() {
    if (setupManagerBridge.done) return;
    setupManagerBridge.done = true;

    window.addEventListener('message', async (event) => {
        if (!managerFrame || event.source !== managerFrame.contentWindow) return;
        const data = event.data;
        if (!data || data.__tv !== 'call') return;
        const api = host();
        const method = data.method;
        if (!api || typeof api[method] !== 'function') {
            managerFrame.contentWindow.postMessage({ __tv: 'resp', id: data.id, ok: false, error: 'desktopAPI 不可用' }, '*');
            return;
        }
        try {
            const result = await api[method](...(data.args || []));
            managerFrame.contentWindow.postMessage({ __tv: 'resp', id: data.id, ok: true, result }, '*');
        } catch (error) {
            managerFrame.contentWindow.postMessage({ __tv: 'resp', id: data.id, ok: false, error: String(error?.message || error) }, '*');
        }
    });

    const api = host();
    if (api?.onTavernProgress) api.onTavernProgress((payload) => forwardEvent('onTavernProgress', payload));
    if (api?.onUpdateStatus) api.onUpdateStatus((payload) => forwardEvent('onUpdateStatus', payload));
}

async function mountManagerOverlay() {
    if (document.getElementById('tv_manager_overlay')) return;
    setupManagerBridge();

    let html = '';
    try {
        const response = await fetch('/scripts/extensions/third-party/tavern-vault/manager.html');
        if (!response.ok) throw new Error(String(response.status));
        html = await response.text();
    } catch {
        toast('error', '完整管理界面加载失败，请重启应用');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'tv_manager_overlay';
    const head = document.createElement('div');
    head.className = 'tv-manager-head';
    const title = document.createElement('span');
    title.textContent = '角色卡库 · 完整管理';
    const close = document.createElement('button');
    close.className = 'tv-manager-close';
    close.textContent = '×';
    close.title = '关闭（Esc）';
    close.addEventListener('click', unmountManagerOverlay);
    head.append(title, close);

    const frame = document.createElement('iframe');
    frame.className = 'tv-manager-frame';
    frame.srcdoc = html;
    managerFrame = frame;

    overlay.append(head, frame);
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') unmountManagerOverlay();
    });
    close.focus();
}

function unmountManagerOverlay() {
    const overlay = document.getElementById('tv_manager_overlay');
    if (overlay) overlay.remove();
    managerFrame = null;
}

// 宿主菜单「完整卡库管理」通过它把入口收进酒馆页面
window.__tavernVaultOpenManager = mountManagerOverlay;

// ---------- 面板入口 ----------

function noHostHtml() {
    return `
        <div class="tv-panel tv-panel-plain">
            <div class="tv-empty">
                「角色卡库」扩展需要在《酒馆角色卡库》应用中使用：<br/>
                内置酒馆会自动携带本扩展；外部安装的酒馆请在应用
                「设置 → 为外部酒馆安装卡库联动扩展」后刷新本页。
            </div>
        </div>`;
}

async function openPanel() {
    const lib = await loadPopupLib();
    const api = host();

    let container = null;
    if (lib && lib.Popup) {
        const html = api ? panelHtml() : noHostHtml();
        const popup = new lib.Popup(html, lib.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
        // Popup.show() 在用户关闭弹窗时才 resolve，这里不等待，直接挂事件并拉数据
        popup.show().catch(() => {});
        for (let i = 0; i < 20 && !container; i += 1) {
            container = document.querySelector('.tv-panel');
            if (!container) await new Promise((resolve) => setTimeout(resolve, 100));
        }
    } else {
        container = document.getElementById('tv_panel_root');
        if (!container) {
            container = document.createElement('div');
            container.id = 'tv_panel_root';
            document.body.appendChild(container);
        }
        container.innerHTML = api ? panelHtml() : noHostHtml();
    }

    if (!api) return;
    const root = container && container.isConnected ? container : document.querySelector('.tv-panel');
    if (!root) return;
    await reloadPanelData(root);
    hydrateImages();
    root.querySelector('#tv_search')?.focus();
}

// ---------- 启动 ----------

async function init() {
    if (document.getElementById(BUTTON_ID)) return;
    const container = document.querySelector('#rm_buttons_container');
    if (!container) return;
    bindGlobalPanelEvents();

    const button = document.createElement('div');
    button.id = BUTTON_ID;
    button.classList.add('right_menu_button', 'fa-solid', 'fa-book-open', 'interactable');
    button.title = '角色卡库';
    container.appendChild(button);

    document.addEventListener('click', (event) => {
        if (event.target.closest(`#${BUTTON_ID}`)) {
            event.preventDefault();
            event.stopPropagation();
            openPanel();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
} else {
    init();
}

console.log(`${MODULE_NAME}: 卡库联动扩展已加载`);
