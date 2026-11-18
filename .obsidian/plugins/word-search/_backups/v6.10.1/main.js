'use strict';

const { Plugin, ItemView, Notice, getIconIds, MarkdownView } = require('obsidian');

const VIEW_TYPE = 'word-search-view';
const NOTE_ROOT = '笔记/';

/** 功能区图标：自绘「放大镜 + 星芒」，和原生 search 明显不同 */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" ' +
  'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="10.2" cy="10.2" r="6" />' +
  '<path d="M14.8 14.8L20.5 20.5" />' +
  '<path d="M10.2 6.4l1.05 2.75 2.75 1.05-2.75 1.05-1.05 2.75-1.05-2.75-2.75-1.05 2.75-1.05z" ' +
  'fill="currentColor" stroke="none" />' +
  '</svg>';

/* ---------------------- 正文高亮（CodeMirror 装饰） ---------------------- */

let CM = null;
try {
  const v = require('@codemirror/view');
  const s = require('@codemirror/state');
  if (v && s && v.Decoration && s.StateField && s.StateEffect) {
    CM = { Decoration: v.Decoration, EditorView: v.EditorView, StateField: s.StateField, StateEffect: s.StateEffect };
  }
} catch (e) {
  CM = null;
}

const setHighlightEffect = CM ? CM.StateEffect.define() : null;

const highlightField = CM
  ? CM.StateField.define({
      create: () => CM.Decoration.none,
      update(deco, tr) {
        let next = deco.map(tr.changes);
        for (const e of tr.effects) {
          if (e.is(setHighlightEffect)) next = e.value || CM.Decoration.none;
        }
        return next;
      },
      provide: (f) => CM.EditorView.decorations.from(f),
    })
  : null;

/**
 * 计算高亮范围：全部命中用 ws-hl，当前那一处用 ws-hl-cur。
 * 所有位置都做边界校验，越界一律丢弃 —— 之前白屏就是这里的区间非法导致的。
 */
function buildDecorations(doc, terms, current, all, caseSensitive) {
  if (!CM) return null;
  const text = doc.toString();
  const hay = caseSensitive ? text : text.toLowerCase();
  const len = doc.length;

  const ranges = [];
  const seen = new Set();

  for (const term of terms || []) {
    if (!term) continue;
    const needle = caseSensitive ? term : term.toLowerCase();
    if (!needle) continue;
    let from = hay.indexOf(needle);
    let guard = 0;
    while (from !== -1 && guard++ < 5000) {
      const to = from + needle.length;
      const key = from + ':' + to;
      if (to <= len && !seen.has(key)) {
        seen.add(key);
        const isCur = !!(current && current.from === from && current.to === to);
        if (all || isCur) {
          ranges.push({ from, to, isCur });
        }
      }
      from = hay.indexOf(needle, to);
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const deco = [];
  for (const r of ranges) {
    try {
      deco.push(CM.Decoration.mark({ class: r.isCur ? 'ws-hl ws-hl-cur' : 'ws-hl' }).range(r.from, r.to));
    } catch (e) {
      /* 单条非法就跳过，不影响其它 */
    }
  }
  try {
    return CM.Decoration.set(deco, true);
  } catch (e) {
    return null;
  }
}


/* ------------------------------ 分词 ------------------------------ */

const ASCII_ID_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
const CJK_RE = /[\u3400-\u9fff]+/g;

let segmenter = null;
try {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  }
} catch (e) {
  segmenter = null;
}

function tokenize(s) {
  const out = [];
  let m;
  ASCII_ID_RE.lastIndex = 0;
  while ((m = ASCII_ID_RE.exec(s)) !== null) out.push(m[0].toLowerCase());
  for (const run of s.match(CJK_RE) || []) {
    if (segmenter) {
      for (const part of segmenter.segment(run)) {
        const t = part.segment.trim();
        if (t) out.push(t.toLowerCase());
      }
    } else {
      out.push(run.toLowerCase());
    }
  }
  return out;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function cleanLine(s) {
  if (/^\s*!\[\[/.test(s)) return '';
  let t = s;
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?\|([^\]]+)\]\]/g, '$2');
  t = t.replace(/\[\[([^\]]+)\]\]/g, '$1');
  t = t.replace(/\*\*/g, '');
  t = t.replace(/\\([<>*_])/g, '$1');
  t = t.replace(/`/g, '');
  t = t.replace(/^>\s?/, '');
  t = t.replace(/^[-*+]\s+/, '');
  t = t.replace(/^#+\s+/, '');
  return t.trim();
}

/* ------------------------------ 查询解析 ------------------------------ */

function parseQuery(raw) {
  const q = { groups: [], path: '', file: '', section: '', regex: null, caseSensitive: false, raw };
  let text = String(raw || '').trim();
  if (!text) return q;

  const mRe = text.match(/^\/(.+)\/([gimsuy]*)$/);
  if (mRe) {
    try {
      q.regex = new RegExp(mRe[1], mRe[2].includes('i') ? mRe[2] : mRe[2] + 'i');
      return q;
    } catch (e) { /* 非法正则按普通查询处理 */ }
  }

  const take = (re) => {
    const m = text.match(re);
    if (!m) return '';
    text = text.replace(m[0], ' ').trim();
    return (m[1] || m[2] || '').replace(/"/g, '');
  };
  q.path = take(/(?:^|\s)path:(?:"([^"]*)"|(\S+))/i);
  q.file = take(/(?:^|\s)file:(?:"([^"]*)"|(\S+))/i);
  q.section = take(/(?:^|\s)section:(?:"([^"]*)"|(\S+))/i);
  if (/(?:^|\s)match-case:/.test(text)) {
    q.caseSensitive = true;
    text = text.replace(/(?:^|\s)match-case:/g, ' ').trim();
  }

  q.groups = text.split(/\s+OR\s+/i).map((g) => {
    const tokens = [];
    const re = /(-)?(?:"([^"]+)"|(\S+))/g;
    let m;
    while ((m = re.exec(g)) !== null) {
      const value = (m[2] || m[3] || '').trim();
      if (value) tokens.push({ neg: !!m[1], value });
    }
    return tokens;
  });
  return q;
}

function termHit(rec, value, mode, cs) {
  const hay = cs ? rec.text : rec.lower;
  const needle = cs ? value : value.toLowerCase();

  if (mode === 'sub') return hay.includes(needle);

  const toks = tokenize(value);
  if (!toks.length) return hay.includes(needle);
  if (mode === 'fuzzy') {
    return toks.every((t) =>
      rec.tokens.some((x) => x === t || (t.length >= 2 && levenshtein(x, t) <= 1) || x.startsWith(t))
    );
  }
  return toks.every((t) => rec.tokens.includes(t));
}

function matchRecord(rec, q, mode) {
  const cs = !!q.caseSensitive;
  if (q.path && !rec.chapter.includes(q.path)) return false;
  if (q.file && !rec.note.toLowerCase().includes(q.file.toLowerCase())) return false;
  if (q.section && !rec.section.toLowerCase().includes(q.section.toLowerCase())) return false;
  if (q.regex) return q.regex.test(rec.text);
  if (!q.groups.length) return true;

  return q.groups.some((tokens) => {
    if (!tokens.length) return true;
    return tokens.every((t) => {
      const hit = termHit(rec, t.value, mode, cs);
      return t.neg ? !hit : hit;
    });
  });
}

function highlightTerms(q) {
  const out = [];
  for (const g of q.groups) for (const t of g) if (!t.neg) out.push(t.value);
  if (q.regex) out.push(q.raw.replace(/^\/|\/[gimsuy]*$/g, ''));
  return out.filter(Boolean);
}

/* ------------------------------ 面板 ------------------------------ */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

class SearchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.terms = [];
    this.rows = [];
    this.selected = -1;
    this.collapsed = new Set();
    this.state = Object.assign(
      { query: '', mode: 'word', scope: 'vault', sort: 'file', caseSensitive: false, highlightAll: false },
      plugin.settings || {}
    );
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '搜索'; }
  getIcon() { return this.plugin.iconId || 'search'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('ws-view');

    const row1 = root.createDiv({ cls: 'ws-row1' });
    this.input = row1.createEl('input', {
      type: 'text',
      cls: 'ws-input',
      attr: { placeholder: '搜索…  支持 "短语" -排除 OR path: file: section: /正则/' },
    });
    this.input.value = this.state.query || '';
    this.input.addEventListener('input', () => {
      this.state.query = this.input.value;
      clearTimeout(this._t);
      this._t = setTimeout(() => this.run(), 90);
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));

    const nav = row1.createDiv({ cls: 'ws-nav' });
    nav.createEl('button', { text: '↑', cls: 'ws-navbtn' }).onclick = () => this.step(-1);
    nav.createEl('button', { text: '↓', cls: 'ws-navbtn' }).onclick = () => this.step(1);

    const row2 = root.createDiv({ cls: 'ws-row2' });
    this.modeSel = row2.createEl('select', { cls: 'dropdown ws-mode' });
    [['word', '整词'], ['sub', '包含'], ['fuzzy', '模糊'], ['regex', '正则']]
      .forEach(([v, t]) => this.modeSel.createEl('option', { text: t, value: v }));
    this.modeSel.value = this.state.mode;
    this.modeSel.onchange = () => {
      this.state.mode = this.modeSel.value;
      this.input.focus();
      this.run();
    };

    this.scopeSel = row2.createEl('select', { cls: 'dropdown ws-scope' });
    [['vault', '全库'], ['file', '当前笔记']]
      .forEach(([v, t]) => this.scopeSel.createEl('option', { text: t, value: v }));
    this.scopeSel.value = this.state.scope;
    this.scopeSel.onchange = () => {
      this.state.scope = this.scopeSel.value;
      this.input.focus();
      this.run();
    };

    this.caseBtn = row2.createEl('button', {
      text: 'Aa',
      cls: 'ws-toggle' + (this.state.caseSensitive ? ' on' : ''),
    });
    this.caseBtn.onclick = () => {
      this.state.caseSensitive = !this.state.caseSensitive;
      this.caseBtn.toggleClass('on', this.state.caseSensitive);
      this.input.focus();
      this.run();
    };

    this.allBtn = row2.createEl('button', {
      text: '高亮全部',
      cls: 'ws-toggle' + (this.state.highlightAll ? ' on' : ''),
      attr: { 'aria-label': '高亮全部：正文里所有匹配词都标黄；关闭时只标当前这一处' },
    });
    this.allBtn.onclick = () => {
      this.state.highlightAll = !this.state.highlightAll;
      this.allBtn.toggleClass('on', this.state.highlightAll);
      this.input.focus();
      this.run();
    };

    const row3 = root.createDiv({ cls: 'ws-row2' });
    this.chapterSel = row3.createEl('select', { cls: 'dropdown ws-half' });
    this.chapterSel.onchange = () => { this.input.focus(); this.run(); };

    this.sortSel = row3.createEl('select', { cls: 'dropdown ws-half' });
    [['file', '按文件'], ['count', '按命中数'], ['mtime', '按修改时间']]
      .forEach(([v, t]) => this.sortSel.createEl('option', { text: t, value: v }));
    this.sortSel.value = this.state.sort;
    this.sortSel.onchange = () => {
      this.state.sort = this.sortSel.value;
      this.input.focus();
      this.run();
    };

    this.metaEl = root.createDiv({ cls: 'ws-meta' });
    this.listEl = root.createDiv({ cls: 'ws-list' });

    await this.plugin.ensureIndex();
    this.fillChapters();
    this.run();
    setTimeout(() => { try { this.input.focus(); } catch (e) {} }, 50);
  }

  fillChapters() {
    const keep = this.chapterSel.value;
    this.chapterSel.empty();
    this.chapterSel.createEl('option', { text: '全部章节', value: '' });

    // 按「第N章」里的数字排，99a/99b/99c 依次排在 99 之后
    const key = (name) => {
      const m = String(name || '').match(/^第(\d+)([a-zA-Z]?)/);
      if (!m) return [1, 0, '', String(name || '')];
      return [0, parseInt(m[1], 10), (m[2] || '').toLowerCase(), String(name || '')];
    };
    const list = [...new Set(this.plugin.index.map((r) => r.chapter))].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
      return ka[3].localeCompare(kb[3], 'zh');
    });

    for (const c of list) {
      this.chapterSel.createEl('option', { text: c, value: c });
    }
    this.chapterSel.value = keep;
  }

  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.rows.length) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const from = this.selected < 0 ? (dir > 0 ? -1 : 0) : this.selected;
      this.selected = (from + dir + this.rows.length) % this.rows.length;
      this.paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      this.input.value = '';
      this.state.query = '';
      this.run();
    }
  }

  async step(dir) {
    if (!this.rows.length) return;
    const from = this.selected < 0 ? (dir > 0 ? -1 : 0) : this.selected;
    const idx = (from + dir + this.rows.length) % this.rows.length;
    this.selected = idx;
    this.paint();
    const rec = this.rows[idx];
    if (rec) {
      try {
        await this.plugin.openRecord(rec, this.terms, this.state);
      } catch (e) {}
    }
    // 必须等跳转结束再把焦点还给搜索框，否则焦点被编辑器抢走，
    // 下一次回车就变成在正文里换行。
    this.refocus();
  }

  refocus() {
    try {
      this.input.focus();
      const v = this.input.value;
      this.input.setSelectionRange(v.length, v.length);
    } catch (e) {}
  }

  paint() {
    const nodes = this.listEl.querySelectorAll('.ws-row');
    nodes.forEach((n, i) => n.toggleClass('sel', i === this.selected));
    const cur = nodes[this.selected];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  run() {
    const t0 = performance.now();
    const raw = this.input.value.trim();
    this.state.query = raw;
    this.listEl.empty();
    this.rows = [];
    this.selected = -1;

    if (!raw) {
      this.metaEl.setText(`v${this.plugin.manifest.version} · 已索引 ${this.plugin.index.length} 行`);
      return;
    }

    const q = parseQuery(raw);
    const mode = q.regex ? 'regex' : this.state.mode;
    const terms = highlightTerms(q);
    this.terms = terms;

    // 正文高亮：查询一变就重刷（此时还没有“当前项”，只按全部开关标）
    try {
      this.plugin.applyToActiveEditor(terms, null, !!this.state.highlightAll, !!this.state.caseSensitive);
    } catch (e) {}

    let pool = this.plugin.index;
    if (this.state.scope === 'file') {
      const af = this.app.workspace.getActiveFile();
      pool = af ? pool.filter((r) => r.path === af.path) : [];
    }
    if (this.chapterSel.value) pool = pool.filter((r) => r.chapter === this.chapterSel.value);

    const hits = pool.filter((r) => matchRecord(r, q, mode));

    const groups = new Map();
    for (const r of hits) {
      if (!groups.has(r.note)) groups.set(r.note, { note: r.note, chapter: r.chapter, items: [] });
      groups.get(r.note).items.push(r);
    }
    const list = [...groups.values()];
    if (this.state.sort === 'count') list.sort((a, b) => b.items.length - a.items.length);
    else list.sort((a, b) => (a.chapter + a.note).localeCompare(b.chapter + b.note, 'zh'));

    const ms = Math.round(performance.now() - t0);
    this.metaEl.setText(`v${this.plugin.manifest.version} · 命中 ${hits.length} 行 · ${list.length} 篇 · ${ms}ms`);

    if (!hits.length) {
      this.listEl.createDiv({ cls: 'ws-empty', text: '未找到匹配结果。' });
      return;
    }

    for (const g of list) {
      const head = el('div', 'ws-group');
      head.appendChild(el('span', 'ws-arrow', this.collapsed.has(g.note) ? '▸' : '▾'));
      head.appendChild(el('span', '', g.note));
      head.appendChild(el('span', 'ws-count', String(g.items.length)));
      head.onclick = () => {
        if (this.collapsed.has(g.note)) this.collapsed.delete(g.note);
        else this.collapsed.add(g.note);
        this.run();
      };
      this.listEl.appendChild(head);
      if (this.collapsed.has(g.note)) continue;

      for (const r of g.items.slice(0, 30)) {
        const row = el('div', 'ws-row');
        const where =
          r.kind === 'title' ? '笔记标题'
            : r.kind === 'heading' ? '小节标题'
              : r.kind === 'code' ? `代码 · 第 ${r.line + 1} 行`
                : `第 ${r.line + 1} 行`;
        row.appendChild(el('div', 'ws-where', (r.section && r.kind !== 'heading' ? r.section + ' › ' : '') + where));
        row.appendChild(el('div', 'ws-text', r.text));
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.onclick = async () => {
          this.selected = this.rows.indexOf(r);
          this.paint();
          try {
            await this.plugin.openRecord(r, this.terms, this.state);
          } catch (e) {}
          this.refocus();
        };
        this.listEl.appendChild(row);
        this.rows.push(r);
      }
    }
  }
}

/* ------------------------------ 插件 ------------------------------ */

class WordSearchPlugin extends Plugin {
  async onload() {
    this.settings = (await this.loadData()) || {};
    this.index = [];
    this.ready = false;
    this.building = null;
    this.iconId = this.pickIcon();

    this.registerView(VIEW_TYPE, (leaf) => new SearchView(leaf, this));

    try {
      const ribbonEl = this.addRibbonIcon(this.iconId, '增强搜索', () => this.activate());
      this.ribbonEl = ribbonEl;
      if (ribbonEl && ribbonEl.empty) {
        ribbonEl.empty();
        ribbonEl.innerHTML = ICON_SVG;
        ribbonEl.addClass('ws-ribbon');
      }
    } catch (e) {}

    this.addCommand({ id: 'open', name: '打开搜索面板', callback: () => this.activate() });

    // 原生搜索按钮/快捷键指向本面板（只替换命令回调，不动 DOM；卸载时还原）
    this._origCallbacks = {};
    for (const id of ['search:search', 'global-search:open', 'global-search:search']) {
      try {
        const cmd = this.app.commands && this.app.commands.commands && this.app.commands.commands[id];
        if (!cmd) continue;
        if (!this._origCallbacks[id]) this._origCallbacks[id] = cmd.callback;
        cmd.callback = () => this.activate();
      } catch (e) {}
    }

    if (CM && highlightField) {
      this.registerEditorExtension([highlightField]);
    }

    const invalidate = () => {
      this.ready = false;
      this.building = null;
      clearTimeout(this._it);
      this._it = setTimeout(async () => {
        await this.ensureIndex();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          if (leaf.view && leaf.view.run) leaf.view.run();
        }
      }, 800);
    };
    this.registerEvent(this.app.vault.on('modify', invalidate));
    this.registerEvent(this.app.vault.on('create', invalidate));
    this.registerEvent(this.app.vault.on('delete', invalidate));
    this.registerEvent(this.app.vault.on('rename', invalidate));
  }

  /** 把高亮派发给指定编辑器；任何异常都吞掉并停用，绝不让编辑器挂掉 */
  applyHighlight(editor, terms, current, all, caseSensitive) {
    if (!CM || !setHighlightEffect || !editor || !editor.cm) return;
    if (this.highlightBroken) return;

    const cm = editor.cm;
    try {
      const deco = buildDecorations(cm.state.doc, terms, current, all, caseSensitive);
      if (!deco) return;
      const key = JSON.stringify([terms, current, all, caseSensitive]);
      if (this._hlKey === key) return;
      cm.dispatch({ effects: setHighlightEffect.of(deco) });
      this._hlKey = key;
    } catch (e) {
      this.highlightBroken = true;
      try { cm.dispatch({ effects: setHighlightEffect.of(CM.Decoration.none) }); } catch (err) {}
    }
  }

  /** 给当前活动笔记（如果是编辑视图）加高亮 */
  applyToActiveEditor(terms, current, all, caseSensitive) {
    try {
      const view = this.app.workspace.getActiveViewOfType &&
        this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
      const ed = view && view.editor;
      if (ed) this.applyHighlight(ed, terms, current, all, caseSensitive);
    } catch (e) {}
  }

  onunload() {
    try {
      for (const id of Object.keys(this._origCallbacks || {})) {
        const cmd = this.app.commands && this.app.commands.commands && this.app.commands.commands[id];
        if (cmd) cmd.callback = this._origCallbacks[id];
      }
    } catch (e) {}
  }

  pickIcon() {
    try {
      const ids = new Set(getIconIds());
      for (const c of ['text-search', 'file-search', 'search']) if (ids.has(c)) return c;
    } catch (e) {}
    return 'search';
  }

  async activate() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeftLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async ensureIndex() {
    if (this.ready) return this.index;
    if (this.building) return this.building;

    this.building = (async () => {
      const records = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(NOTE_ROOT)) continue;
        let text = '';
        try {
          text = await this.app.vault.cachedRead(file);
        } catch (e) {
          continue;
        }
        const chapter = file.parent ? file.parent.name : '';
        const push = (line, body, section, kind) => {
          const t = String(body || '').trim();
          if (t.length < 2) return;
          records.push({
            path: file.path,
            note: file.basename,
            chapter,
            section,
            line,
            kind,
            text: t,
            lower: t.toLowerCase(),
            tokens: tokenize(t),
          });
        };

        push(0, file.basename.replace(/^\d+\s+/, ''), '', 'title');

        const lines = text.split('\n');
        let section = '';
        let inCode = false;
        for (let i = 0; i < lines.length; i++) {
          const rawLine = lines[i];
          const s = rawLine.trim();
          if (s.startsWith('```')) { inCode = !inCode; continue; }
          if (!inCode && rawLine.startsWith('## ')) {
            section = rawLine.slice(3).trim();
            push(i, section, section, 'heading');
            continue;
          }
          if (!s) continue;
          push(i, inCode ? s : cleanLine(s), section, inCode ? 'code' : 'line');
        }
      }
      this.index = records;
      this.ready = true;
      this.building = null;
      return records;
    })();

    return this.building;
  }

  /**
   * 打开一条命中：在编辑视图里定位到行并选中词。
   * 只用公开接口，不改视图模式、不碰编辑器内部状态。
   */
  async openRecord(rec, terms, state) {
    try {
      const file = this.app.vault.getAbstractFileByPath(rec.path);
      if (!file) {
        new Notice('找不到笔记：' + rec.note);
        return;
      }

      // 选叶子：不占用锁定（pinned）的标签页，除非它本来就开着这篇
      const isPinned = (l) => {
        try {
          if (l.pinned === true) return true;
          if (typeof l.getViewState === 'function' && l.getViewState() && l.getViewState().pinned === true) return true;
        } catch (e) {}
        return false;
      };
      let leaf = null;
      try {
        const leaves = this.app.workspace.getLeavesOfType('markdown') || [];
        const same = (l) => l.view && l.view.file && l.view.file.path === rec.path;
        leaf =
          leaves.find((l) => same(l) && !isPinned(l)) ||
          leaves.find((l) => same(l)) ||
          leaves.find((l) => !isPinned(l)) ||
          null;
      } catch (e) {}
      if (!leaf) leaf = this.app.workspace.getLeaf('tab');

      await leaf.openFile(file);
      try { this.app.workspace.revealLeaf(leaf); } catch (e) {}

      let view = await this.waitForView(leaf, rec.path, 1200);
      // 以“当前可见的”视图为准：可能开在了别的叶子/其他标签
      try {
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active && active.file && active.file.path === rec.path) view = active;
      } catch (e) {}
      const mode = this.detectMode(view);
      const hasEd = !!(view && view.editor);
      this.log('打开 ' + rec.note + ' | detectMode=' + mode + ' | hasEditor=' + hasEd +
        ' | getMode=' + (view && view.getMode ? view.getMode() : 'n/a'));
      const ed = view && view.editor;
      if (mode === 'preview' || !ed) {
        // 阅读视图：滚到命中块并把词标黄
        this.jumpInPreview(view, rec, terms, state);
        return;
      }

      let line = rec.line;
      try {
        const total = typeof ed.lineCount === 'function' ? ed.lineCount() : null;
        if (typeof total === 'number' && total > 0) line = Math.max(0, Math.min(line, total - 1));
      } catch (e) {}

      const lineText = ed.getLine(line) || '';
      const list = (terms || []).filter(Boolean);
      let ch = 0;
      let len = 0;
      for (const t of list) {
        const i = lineText.toLowerCase().indexOf(t.toLowerCase());
        if (i >= 0) { ch = i; len = t.length; break; }
      }

      ed.setCursor({ line, ch });
      if (len > 0) ed.setSelection({ line, ch }, { line, ch: ch + len });
      ed.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);

      // 当前这一处单独加重标注（其余命中按“高亮全部”开关）
      let current = null;
      if (len > 0 && typeof ed.posToOffset === 'function') {
        try {
          const from = ed.posToOffset({ line, ch });
          current = { from, to: from + len };
        } catch (e) {}
      }
      this.applyHighlight(ed, list, current, !!(state && state.highlightAll), !!(state && state.caseSensitive));
    } catch (e) {
      new Notice('定位失败：' + rec.note, 4000);
    }
  }

  /** 把诊断信息写进插件目录的 debug.log，便于事后排查 */
  async log(msg) {
    try {
      const dir = this.manifest.dir || (this.app.vault.configDir + '/plugins/word-search');
      const file = dir + '/debug.log';
      const adapter = this.app.vault.adapter;
      const line = new Date().toISOString().slice(11, 19) + ' ' + msg + '\n';
      const has = await adapter.exists(file);
      if (has) await adapter.append(file, line);
      else await adapter.write(file, line);
    } catch (e) {}
  }

  /** 用 DOM 判断当前是阅读视图还是编辑视图，不依赖 getMode 是否存在 */
  detectMode(view) {
    try {
      const el = view && view.containerEl;
      if (el && el.querySelector) {
        const pv = el.querySelector('.markdown-preview-view');
        const cm = el.querySelector('.cm-editor');
        const visible = (n) => !!n && (n.offsetParent !== null ||
          (n.getBoundingClientRect && n.getBoundingClientRect().height > 0));
        if (visible(pv)) return 'preview';
        if (cm) return 'editor';
      }
    } catch (e) {}
    try { if (view && typeof view.getMode === 'function') return view.getMode(); } catch (e) {}
    return 'editor';
  }

  /** 阅读视图：滚到命中块，并把搜索词标黄（不改编辑器状态，只用 DOM） */
  jumpInPreview(view, rec, terms, state, attempt) {
    const SEL = 'p, li, h1, h2, h3, h4, h5, h6, .callout, td, pre, blockquote';

    // 候选容器：previewMode.containerEl 有时是尚未渲染的空壳，
    // 所以把所有可能的位置都试一遍，取第一个真正有内容的。
    const candidates = [];
    const push = (n) => { if (n && typeof n.querySelectorAll === 'function') candidates.push(n); };
    try { push(view && view.previewMode && view.previewMode.containerEl); } catch (e) {}
    try {
      const el = view && view.containerEl;
      if (el && el.querySelector) {
        push(el.querySelector('.markdown-reading-view'));
        push(el.querySelector('.markdown-preview-sizer'));
        push(el.querySelector('.markdown-preview-view'));
      }
      push(el);
    } catch (e) {}

    let root = null;
    let nodes = [];
    for (const c of candidates) {
      let list = [];
      try { list = Array.prototype.slice.call(c.querySelectorAll(SEL)); } catch (e) { continue; }
      // 取内容最多的候选：workspace-leaf-content 这类外层壳也会命中少量节点，
      // 但它不是真正的内容容器
      if (list.length > nodes.length) { root = c; nodes = list; }
    }

    const tryNo = attempt || 0;
    if (!root || !nodes.length) {
      this.log('jumpInPreview: 无内容容器（第 ' + (tryNo + 1) + ' 次）');
      // 刚打开的笔记，预览可能还没渲染完，稍后重试
      if (tryNo < 4) {
        setTimeout(() => this.jumpInPreview(view, rec, terms, state, tryNo + 1), tryNo === 0 ? 120 : 350);
      }
      return;
    }

    const norm = (x) => String(x || '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[“”"‘’'`，,。.：:；;、！!？?（）()【】\[\]「」《》—\-_*]/g, '')
      .toLowerCase();

    this.log('jumpInPreview: root=' + (root.className || '?') + ' | nodes=' + nodes.length);

    const texts = new Map(nodes.map((n) => [n, norm(n.textContent)]));
    const isHead = (n) => /^H[1-6]$/.test((n && n.tagName) || '');
    const full = norm(rec.text);
    const sect = norm(rec.section);

    let start = -1;
    if (sect) start = nodes.findIndex((n) => isHead(n) && texts.get(n) === sect);

    let scope = nodes;
    if (start >= 0) {
      let end = nodes.findIndex((n, i) => i > start && isHead(n));
      if (end === -1) end = nodes.length;
      scope = nodes.slice(start, end);
    }

    const normTerms = (terms || []).map((t) => norm(t)).filter(Boolean);

    let hit =
      scope.find((n) => texts.get(n) === full) ||
      (full.length >= 6 && scope.find((n) => texts.get(n).includes(full))) ||
      (full.length >= 6 && scope.find((n) => texts.get(n).includes(full.slice(0, 16)))) ||
      null;

    // 文本对不上时（渲染改写了标点、行内代码拆了节点等），
    // 退回到“该节内第一个含搜索词的块”——总比停在标题上好。
    if (!hit && normTerms.length) {
      hit = scope.find((n) => normTerms.some((t) => texts.get(n).includes(t))) || null;
    }

    // 阅读视图是增量渲染的：目标行可能还没进 DOM。
    // 这时先滚到小节标题（触发下面内容渲染），稍后重试一次。
    if (!hit && tryNo < 4) {
      if (start >= 0) {
        try { nodes[start].scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (e) {}
      }
      this.log('jumpInPreview: 未命中（start=' + start + '），重试第 ' + (tryNo + 1) + ' 次');
      setTimeout(() => this.jumpInPreview(view, rec, terms, state, tryNo + 1), 280);
      return;
    }

    const anchor = hit || (start >= 0 ? nodes[start] : null);
    this.log('jumpInPreview: sect=' + (rec.section || '无') + ' | start=' + start +
      ' | hit=' + (hit ? 'yes' : 'no') + ' | anchor=' + (anchor ? String(anchor.textContent).slice(0, 24) : 'null'));
    if (!anchor) return;

    try { anchor.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (e) {}

    try {
      const olds = root.querySelectorAll('mark.ws-term');
      Array.prototype.slice.call(olds).forEach((m) => {
        const par = m.parentNode;
        if (!par) return;
        while (m.firstChild) par.insertBefore(m.firstChild, m);
        par.removeChild(m);
        try { par.normalize(); } catch (e) {}
      });
    } catch (e) {}

    const list = (terms || []).filter(Boolean);
    if (!list.length) return;

    const target = (state && state.highlightAll) ? root : anchor;
    this.markTerms(target, list, !!(state && state.caseSensitive));
    let marks = 0;
    try { marks = root.querySelectorAll('mark.ws-term').length; } catch (e) {}
    let detail = '';
    try {
      const ms = root.querySelectorAll('mark.ws-term');
      detail = Array.prototype.slice.call(ms).slice(0, 6).map((m) => {
        const par = m.parentNode;
        return (par && par.tagName ? par.tagName.toLowerCase() : '?') + ':' + (m.textContent || '');
      }).join(',');
    } catch (e) {}
    let bg = 'n/a';
    try {
      const first = root.querySelector('mark.ws-term');
      if (first && window.getComputedStyle) {
        const cs = window.getComputedStyle(first);
        bg = cs.backgroundColor + ' / ' + cs.color;
      }
    } catch (e) {}
    this.log('jumpInPreview: v' + (this.manifest.version || '?') + ' terms=' + JSON.stringify(list) +
      ' | marks=' + marks + ' | 明细=' + detail + ' | mark 样式=' + bg);

    // Obsidian 可能在渲染完成后重建 DOM，把标记冲掉，这里复查并补标
    const verify = (round) => {
      let now = 0;
      try { now = root.querySelectorAll('mark.ws-term').length; } catch (e) {}
      if (now > 0) {
        if (round === 0) this.log('jumpInPreview: 复查仍在 marks=' + now);
        return;
      }
      if (round >= 3) {
        this.log('jumpInPreview: 复查标记被清除且补标失败');
        return;
      }
      this.markTerms(target, list, !!(state && state.caseSensitive));
      try { now = root.querySelectorAll('mark.ws-term').length; } catch (e) {}
      this.log('jumpInPreview: 补标第 ' + (round + 1) + ' 次 | marks=' + now);
      setTimeout(() => verify(round + 1), 500);
    };
    setTimeout(() => verify(0), 400);
  }

  /** 把文本里的词包成 <mark class="ws-term">；出错就放弃，不影响阅读 */
  markTerms(scopeEl, terms, caseSensitive) {
    try {
      const out = [];
      const collect = (node) => {
        const kids = (node && node.childNodes) || [];
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i];
          if (!c) continue;
          if (c.nodeType === 3) {
            if (c.nodeValue && c.nodeValue.trim()) out.push(c);
          } else if (c.nodeType === 1) {
            const tag = (c.tagName || '').toUpperCase();
            if (tag === 'MARK' || tag === 'SCRIPT' || tag === 'STYLE') continue;
            collect(c);
          }
        }
      };
      collect(scopeEl);

      for (const textNode of out) {
        const text = textNode.nodeValue;
        const hay = caseSensitive ? text : text.toLowerCase();
        let best = -1;
        let len = 0;
        for (const t of terms) {
          const needle = caseSensitive ? t : t.toLowerCase();
          const i = hay.indexOf(needle);
          if (i !== -1 && (best === -1 || i < best)) { best = i; len = t.length; }
        }
        if (best === -1) continue;

        const frag = document.createDocumentFragment();
        let rest = text;
        let guard = 0;
        while (rest.length && guard++ < 500) {
          const h = caseSensitive ? rest : rest.toLowerCase();
          let b = -1;
          let l2 = 0;
          for (const t of terms) {
            const needle = caseSensitive ? t : t.toLowerCase();
            const i = h.indexOf(needle);
            if (i !== -1 && (b === -1 || i < b)) { b = i; l2 = t.length; }
          }
          if (b === -1) { frag.appendChild(document.createTextNode(rest)); break; }
          if (b > 0) frag.appendChild(document.createTextNode(rest.slice(0, b)));
          const mk = document.createElement('mark');
          mk.className = 'ws-term';
          mk.textContent = rest.slice(b, b + l2);
          frag.appendChild(mk);
          rest = rest.slice(b + l2);
        }
        if (frag.childNodes.length) {
          try { textNode.parentNode.replaceChild(frag, textNode); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  async waitForView(leaf, path, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = leaf.view;
      if (v && typeof v.getViewType === 'function' && v.getViewType() === 'markdown' && v.file && v.file.path === path) {
        return v;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return leaf.view;
  }
}

WordSearchPlugin.__test = { parseQuery, matchRecord, tokenize, cleanLine };
WordSearchPlugin.__view = SearchView;

module.exports = WordSearchPlugin;
