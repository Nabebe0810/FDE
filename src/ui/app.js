/*
 * app.js — スワイプ式の回答画面と FDE 画面（外部通信なし・ライブラリなし）
 * 状態はすべてエンジン（回答ログの再生）から作る。画面はその表示と入力の受け取りだけ。
 */
(function () {
  'use strict';
  const F = window.FDE;
  const db = F.engine.indexDb(F.DB);
  const $app = document.getElementById('app');
  const STORE = 'fde-hearing:';
  const ROLES = ['経営者', '管理者', '現場', 'IT担当'];

  let session = null;   // 回答ログ
  let state = null;     // 再生した状態
  let view = { mode: 'start', reviewSeq: null, fdeTab: 'now', shownAt: 0, draft: null };

  // ---------- 保存（端末内だけ。失敗しても動く） ----------
  function save() {
    if (!session) return;
    try {
      localStorage.setItem(STORE + session.meta.id, JSON.stringify(session));
      const idx = JSON.parse(localStorage.getItem(STORE + 'index') || '[]').filter((x) => x.id !== session.meta.id);
      idx.unshift({ id: session.meta.id, title: session.meta.title, at: new Date().toISOString() });
      localStorage.setItem(STORE + 'index', JSON.stringify(idx.slice(0, 30)));
    } catch (e) { /* 保存できない環境（プライベートモード等）では書き出しを使う */ }
  }
  function listSaved() { try { return JSON.parse(localStorage.getItem(STORE + 'index') || '[]'); } catch (e) { return []; } }
  function loadSaved(id) { try { return JSON.parse(localStorage.getItem(STORE + id)); } catch (e) { return null; } }

  // ---------- 小道具 ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
    catch (e) { const t = h('textarea', {}, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('コピーしました'); }
  }
  let toastTimer = null;
  function toast(msg, action) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = h('div', { class: 'toast', role: 'status' }, msg, action ? h('button', { onclick: () => { t.remove(); action.fn(); } }, action.label) : null);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), action ? 6000 : 2000);
  }
  const phaseName = (q) => (q.phase || '').replace(/^\d+_/, '');

  // ---------- 進行 ----------
  function refresh() { state = F.engine.replay(db, session); save(); render(); }
  function current() {
    if (view.reviewSeq != null) {
      const e = session.log.find((x) => x.seq === view.reviewSeq);
      return { iid: e.iid, review: e };
    }
    const n = F.select.next(db, state);
    return n.stage === 'done' ? null : n;
  }

  function submit(iid, payload) {
    const ms = Date.now() - view.shownAt;
    payload.ms = ms;
    if (view.reviewSeq != null) {
      const prev = session.log.find((x) => x.seq === view.reviewSeq);
      const same = prev.kind === (payload.kind || 'value') && JSON.stringify(prev.value) === JSON.stringify(payload.value);
      if (!same) {
        F.engine.edit(db, session, view.reviewSeq, payload);
        toast('訂正しました。前の回答も記録に残しています');
      }
      view.reviewSeq = nextReview(view.reviewSeq);
      view.draft = null;
      refresh();
      return;
    }
    F.engine.answer(db, session, iid, payload);
    const last = session.log[session.log.length - 1].seq;
    view.draft = null;
    refresh();
    toast('記録しました', { label: '取り消す', fn: () => { F.engine.retract(db, session, last); view.reviewSeq = null; refresh(); } });
  }
  function activeList() { return F.engine.activeAnswers(session); }
  function prevReview() {
    const list = activeList();
    if (!list.length) return null;
    if (view.reviewSeq == null) return list[list.length - 1].seq;
    const i = list.findIndex((x) => x.seq === view.reviewSeq);
    return i > 0 ? list[i - 1].seq : list[0].seq;
  }
  function nextReview(seq) {
    const list = activeList();
    const i = list.findIndex((x) => x.seq === seq);
    // 訂正後は seq が変わるので、次の未回答（最新）へ戻る
    return i >= 0 && i < list.length - 1 ? list[i + 1].seq : null;
  }
  function back() { const p = prevReview(); if (p != null) { view.reviewSeq = p; view.draft = null; render(); } }

  // 担当者（FDE）画面は合言葉で開く。※画面のコードは公開されているため、見せたくない情報を守る仕組みではない
  function openFde() {
    let ok = false;
    try { ok = sessionStorage.getItem(STORE + 'fde') === '1'; } catch (e) { /* 使えない環境 */ }
    if (!ok) {
      const p = window.prompt('担当者用の合言葉を入力してください');
      if (p === null) return;
      if (p.trim() !== '2407') { toast('合言葉が違います'); return; }
      try { sessionStorage.setItem(STORE + 'fde', '1'); } catch (e) { /* 使えない環境 */ }
    }
    view.mode = 'fde'; render();
  }

  // ---------- 描画 ----------
  function render() {
    $app.innerHTML = '';
    if (view.mode === 'start') return renderStart();
    if (view.mode === 'fde') return renderFde();
    const c = current();
    if (!c) return renderDone();
    renderCard(c);
  }

  function header() {
    const est = F.select.estimate(db, state);
    const pct = Math.round(est.progress * 100);
    return h('div', {},
      h('div', { class: 'top' },
        h('div', { class: 'brand' }, '要件ヒアリング'),
        h('div', { class: 'actions' },
          view.reviewSeq != null ? h('button', { class: 'chip-btn', onclick: () => { view.reviewSeq = null; render(); } }, '最新へ') : null,
          h('button', { class: 'link-btn', onclick: openFde, title: '担当者用' }, '担当者用'))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': '重要な点の確認状況' }, h('i', { style: 'width:' + pct + '%' })),
      h('div', { class: 'meta' },
        h('span', {}, '大事な点 ' + est.criticalResolved + '/' + est.criticalTotal + ' わかった'),
        h('span', {}, '経過 ' + Math.round(est.elapsedMin) + '分 ・ あと約' + est.remainingMin + '分（' + est.remainingQuestions + '問ほど）')));
  }

  function renderStart() {
    const saved = listSaved();
    const title = h('input', { type: 'text', id: 'f-title', placeholder: '例：〇〇社 受付業務の見直し' });
    const name = h('input', { type: 'text', id: 'f-name', placeholder: '例：山田（任意）' });
    const role = h('select', { id: 'f-role' }, ROLES.map((r) => h('option', { value: r }, r)));
    const budget = h('select', { id: 'f-budget' }, [30, 35, 45].map((m) => h('option', { value: m, selected: m === 35 }, m + '分')));
    const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (ev) => importFile(ev.target.files[0]) });
    $app.append(h('div', { class: 'wrap' },
      h('div', { class: 'panel' },
        h('h1', {}, '要件ヒアリング'),
        h('p', {}, '1画面に1つの質問です。選ぶだけの質問がほとんどです。わからないことは「わからない」で大丈夫です。'),
        h('p', { class: 'note' }, '答えはこの端末の中だけに保存します。外部には送りません。最後に、担当者に渡すファイルを保存できます。'),
        h('div', { class: 'field' }, h('label', { for: 'f-title' }, '案件の名前'), title),
        h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'お名前'), name),
        h('button', { class: 'primary', onclick: () => {
          session = F.engine.createSession(db, { title: title.value.trim(), role: '経営者', respondentName: name.value.trim() || '回答者1' });
          view.mode = 'card'; view.reviewSeq = null; refresh();
        } }, '始める'),
        h('button', { class: 'secondary', onclick: () => file.click() }, '保存したファイルから続ける'), file),
      saved.length ? h('div', { class: 'panel list-sessions' }, h('h2', {}, 'この端末の続き'),
        saved.map((s) => h('button', { class: 'secondary', onclick: () => { const x = loadSaved(s.id); if (x) open(x); } }, (s.title || s.id) + ' — ' + s.at.slice(0, 16).replace('T', ' ')))) : null));
  }

  function open(sess) {
    if (sess.meta.ruleVersion !== db.params.ruleVersion) toast('ルールの版が違います（' + sess.meta.ruleVersion + '）。今の版で再生します');
    session = sess; db.params.time.targetMin = sess.meta.budgetMin || db.params.time.targetMin;
    view.mode = 'card'; view.reviewSeq = null; refresh();
  }
  function importFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const s = JSON.parse(r.result); if (s.format !== 'fde-hearing-session/1') throw new Error('形式が違います'); open(s); } catch (e) { toast('読み込めませんでした：' + e.message); } };
    r.readAsText(f);
  }

  // ---------- 質問カード ----------
  function renderCard(c) {
    const q = F.engine.resolveQuestion(db, state, c.iid);
    if (!q) { view.reviewSeq = null; return render(); }
    view.shownAt = Date.now();
    const prev = c.review;
    const isConfirm = q.type === 'confirm';
    const stageLabel = isConfirm ? '最後の確認：内容が合っているか教えてください' : prev ? '前の回答を見直し中（変えると訂正として記録）' : (c.tier === 0 ? '確認' : c.tier === 1 ? '少しくわしく' : phaseName(q));
    const widget = buildWidget(q, prev);
    const card = h('section', { class: 'card', 'aria-label': '質問' },
      h('div', { class: 'stage' }, stageLabel),
      h('h1', { id: 'qtext' }, q.text),
      q.help ? h('p', { class: 'help' }, q.help) : null,
      widget.el,
      !isConfirm && !widget.noSpecial ? h('div', { class: 'special' },
        h('button', { onclick: () => submit(c.iid, { kind: 'dontknow' }) }, 'わからない'),
        h('button', { onclick: () => submit(c.iid, { kind: 'later' }) }, '後で確認'),
        h('button', { onclick: () => submit(c.iid, { kind: 'na' }) }, '該当しない')) : null,
      q.decides && q.decides.length ? h('div', { class: 'decides' }, 'この答えで決まること：' + q.decides.join('／')) : null);
    const go = h('button', { class: 'go', onclick: () => widget.submit() }, isConfirm ? '保留にする' : '次へ');
    if (isConfirm) go.onclick = () => submit(c.iid, { kind: 'later' });
    const nav = widget.hideNav ? null : h('div', { class: 'nav' }, h('button', { onclick: back, disabled: !activeList().length }, '← 戻る'), go);
    if (widget.validate) { const upd = () => { go.disabled = !widget.validate(); }; widget.onChange = upd; upd(); }
    $app.append(h('div', { class: 'wrap' }, header(), card, nav,));
    const f = card.querySelector('textarea, input[type=text], input[type=number]');
    if (f && window.matchMedia('(pointer:fine)').matches) f.focus(); else document.getElementById('qtext').setAttribute('tabindex', '-1');
    view.keyHandler = (ev) => onKey(ev, widget, c);
  }

  function attachSwipe(card, widget, c) {
    let sx = 0, sy = 0, dx = 0, dy = 0, on = false;
    const hints = { r: card.querySelector('.swipe-hint.r'), l: card.querySelector('.swipe-hint.l'), u: card.querySelector('.swipe-hint.u') };
    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('input, textarea, select, button, .deck, .slider, .pts, .matrix')) return;
      on = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; card.classList.add('dragging');
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    });
    card.addEventListener('pointermove', (e) => {
      if (!on) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      card.style.transform = 'translate(' + dx + 'px,' + Math.min(0, dy) + 'px) rotate(' + dx / 30 + 'deg)';
      hints.r.style.opacity = dx > 30 ? Math.min(1, dx / 100) : 0;
      hints.l.style.opacity = dx < -30 ? Math.min(1, -dx / 100) : 0;
      hints.u.style.opacity = dy < -40 && Math.abs(dx) < 60 ? Math.min(1, -dy / 120) : 0;
    }, { passive: true });
    const end = () => {
      if (!on) return; on = false; card.classList.remove('dragging'); card.style.transform = '';
      Object.values(hints).forEach((x) => { x.style.opacity = 0; });
      if (dx > 100) act('right', widget, c);
      else if (dx < -100) act('left', widget, c);
      else if (dy < -110 && Math.abs(dx) < 60) act('up', widget, c);
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  function act(dir, widget, c) {
    if (dir === 'right') return widget.right ? widget.right() : widget.submit();
    if (dir === 'left') return widget.left ? widget.left() : back();
    if (dir === 'up') return widget.up ? widget.up() : submit(c.iid, { kind: 'dontknow' });
    if (dir === 'down') return submit(c.iid, { kind: 'later' });
  }

  function onKey(ev, widget, c) {
    const typing = ev.target.closest && ev.target.closest('input, textarea, select');
    if (typing) { if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); widget.submit(); } return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); act('right', widget, c); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); act('left', widget, c); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); act('up', widget, c); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); act('down', widget, c); }
    else if (ev.key === 'Enter') { ev.preventDefault(); widget.submit(); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); back(); }
    else if (widget.digits && /^[1-9]$/.test(ev.key)) { widget.digits(Number(ev.key) - 1); }
  }
  document.addEventListener('keydown', (ev) => { if (view.mode === 'card' && view.keyHandler) view.keyHandler(ev); });

  // ---------- 入力部品（形式ごと） ----------
  function buildWidget(q, prev) {
    const t = q.input.type;
    const pv = prev && prev.kind === 'value' ? prev.value : undefined;
    const W = { el: null, submit: () => {}, validate: null };
    const send = (value, extra) => submit(q.iid, Object.assign({ kind: 'value', value }, extra || {}));
    const opts = q.input.options || [];

    if (q.type === 'confirm' || t === 'yesno') {
      const yes = q.input.yes || 'はい', no = q.input.no || 'いいえ';
      let note = null;
      const neither = q.type === 'confirm' ? '保留' : 'どちらとも言えない';
      const doNo = () => {
        if (q.type === 'confirm') {
          note = note || h('textarea', { placeholder: 'ちがう点を書いてください（任意）', 'aria-label': 'ちがう点' });
          if (!note.isConnected) { W.el.append(note, h('button', { class: 'secondary', onclick: () => send(false, { note: note.value }) }, 'これで送る')); note.focus(); return; }
          return send(false, { note: note.value });
        }
        send(false);
      };
      W.el = h('div', { class: 'yn' },
        h('button', { class: 'n', onclick: doNo, 'aria-pressed': pv === false }, no),
        h('button', { class: 'y', onclick: () => send(true), 'aria-pressed': pv === true }, yes),
        h('button', { class: 'm', onclick: () => submit(q.iid, { kind: q.type === 'confirm' ? 'later' : 'dontknow', note: neither }) }, neither));
      W.right = () => send(true); W.left = doNo; W.rightLabel = yes; W.leftLabel = no; W.upLabel = neither;
      W.up = () => submit(q.iid, { kind: q.type === 'confirm' ? 'later' : 'dontknow', note: neither });
      W.submit = () => {}; W.hideNav = q.type !== 'confirm' && !prev; W.noSpecial = q.type === 'confirm';
      if (q.type === 'confirm') W.hideNav = false;
      return W;
    }

    const isOther = (o) => /その他|どれでもない|ほかにある/.test(o.v + ' ' + o.label);
    const otherBox = h('input', { type: 'text', class: 'other', placeholder: '具体的に書いてください', 'aria-label': 'その他の内容' });
    if (prev && prev.note) otherBox.value = prev.note;

    if (t === 'single') {
      const el = h('div', { class: 'opts', role: 'radiogroup' });
      const pickOther = (o) => { if (!otherBox.isConnected) { el.after(otherBox, h('button', { class: 'primary small', onclick: () => send(o.v, { note: otherBox.value.trim() }) }, 'これで次へ')); } otherBox.focus(); };
      opts.forEach((o, i) => el.append(h('button', { class: 'opt', role: 'radio', 'aria-checked': pv === o.v, 'aria-pressed': pv === o.v, onclick: () => (isOther(o) ? pickOther(o) : send(o.v)) },
        h('span', { class: 'k' }, i + 1), h('span', {}, o.label, o.hint ? h('span', { class: 'h' }, o.hint) : null))));
      W.el = el; W.digits = (i) => opts[i] && send(opts[i].v); W.submit = () => pv !== undefined && send(pv);
      return W;
    }

    if (t === 'select') {
      const sel = h('select', { 'aria-labelledby': 'qtext' }, h('option', { value: '' }, '選んでください'), opts.map((o) => h('option', { value: o.v, selected: pv === o.v }, o.label)));
      W.el = sel; W.validate = () => !!sel.value; sel.onchange = () => W.onChange && W.onChange();
      W.submit = () => sel.value && send(sel.value);
      return W;
    }

    if (t === 'slider' || t === 'scale') {
      let idx = pv !== undefined ? opts.findIndex((o) => o.v === pv) : -1;
      const now = h('div', { class: 'now' + (idx < 0 ? ' untouched' : '') }, idx < 0 ? 'つまみを動かすか、目盛りをタップ' : opts[idx].label);
      const range = h('input', { type: 'range', min: 0, max: opts.length - 1, step: 1, value: idx < 0 ? Math.floor((opts.length - 1) / 2) : idx, 'aria-labelledby': 'qtext', 'aria-valuetext': idx < 0 ? '未選択' : opts[idx].label });
      const ticks = h('div', { class: 'ticks' });
      const set = (i) => {
        idx = i; range.value = i; now.textContent = opts[i].label; now.className = 'now';
        range.setAttribute('aria-valuetext', opts[i].label);
        ticks.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
        W.onChange && W.onChange();
      };
      opts.forEach((o, i) => ticks.append(h('button', { type: 'button', onclick: () => set(i), class: i === idx ? 'on' : '' }, o.short || o.label)));
      range.addEventListener('input', () => set(Number(range.value)));
      W.el = h('div', { class: 'slider' }, now, range, ticks);
      W.validate = () => idx >= 0; W.submit = () => idx >= 0 && send(opts[idx].v); W.digits = (i) => opts[i] && set(i);
      return W;
    }

    if (t === 'multi') {
      const chosen = new Set(Array.isArray(pv) ? pv : []);
      const el = h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'qtext' });
      opts.forEach((o) => {
        const b = h('button', { class: 'chip', 'aria-pressed': chosen.has(o.v), onclick: () => {
          if (chosen.has(o.v)) chosen.delete(o.v); else chosen.add(o.v);
          b.setAttribute('aria-pressed', chosen.has(o.v));
          if (isOther(o)) { if (chosen.has(o.v)) { el.after(otherBox); otherBox.focus(); } else otherBox.remove(); }
          W.onChange && W.onChange();
        } }, o.label);
        el.append(b);
      });
      W.el = h('div', {}, h('p', { class: 'note' }, '当てはまるものをすべて選んでください'), el);
      W.validate = () => chosen.size > 0;
      W.submit = () => chosen.size && send(opts.map((o) => o.v).filter((v) => chosen.has(v)), otherBox.isConnected && otherBox.value.trim() ? { note: otherBox.value.trim() } : {});
      W.digits = (i) => opts[i] && el.children[i].click();
      return W;
    }

    if (t === 'cards') {
      // 当てはまるものを選ぶだけ。選ばなかったもの＝当てはまらない。「わからない」は下の欄で
      const yes = new Set(pv && pv.yes ? pv.yes : []);
      const unk = new Set(pv && pv.unknown ? pv.unknown : []);
      const el = h('div', { class: 'tiles', role: 'group', 'aria-labelledby': 'qtext' });
      opts.forEach((o) => {
        const b = h('button', { class: 'tile', 'aria-pressed': yes.has(o.v), onclick: () => {
          if (yes.has(o.v)) yes.delete(o.v); else { yes.add(o.v); unk.delete(o.v); }
          b.setAttribute('aria-pressed', yes.has(o.v)); W.onChange && W.onChange();
        } }, h('span', { class: 'tile-t' }, o.label), o.hint ? h('span', { class: 'tile-h' }, o.hint) : null, h('span', { class: 'tick', 'aria-hidden': 'true' }));
        el.append(b);
      });
      W.el = h('div', {}, h('p', { class: 'note' }, '当てはまるものをすべて選んでください（なければ「次へ」）'), el);
      W.validate = () => true;
      W.submit = () => send({ yes: opts.map((o) => o.v).filter((v) => yes.has(v)), no: opts.map((o) => o.v).filter((v) => !yes.has(v) && !unk.has(v)), unknown: [...unk] });
      return W;
    }

    if (t === 'points') {
      const total = q.input.total || 10;
      const pts = Object.assign({}, pv || {});
      const left = h('div', { class: 'left' });
      const rows = opts.map((o) => {
        const r = h('input', { type: 'range', min: 0, max: total, step: 1, value: pts[o.v] || 0, 'aria-label': o.label });
        const n = h('span', {}, pts[o.v] || 0);
        r.addEventListener('input', () => {
          const others = Object.keys(pts).filter((k) => k !== o.v).reduce((a, k) => a + (pts[k] || 0), 0);
          const v = Math.min(Number(r.value), total - others);
          pts[o.v] = v; r.value = v; n.textContent = v; upd();
        });
        return h('div', { class: 'row' }, h('span', {}, o.label), r, n);
      });
      const upd = () => { const s = Object.values(pts).reduce((a, b) => a + b, 0); left.textContent = '残り ' + (total - s) + ' 点（' + total + '点を配ります）'; W.onChange && W.onChange(); };
      W.el = h('div', { class: 'pts' }, left, rows); upd();
      W.validate = () => Object.values(pts).reduce((a, b) => a + b, 0) > 0;
      W.submit = () => W.validate() && send(pts);
      return W;
    }

    if (t === 'rank') {
      const order = Array.isArray(pv) ? pv.slice() : [];
      const el = h('div', { class: 'opts rank' });
      const draw = () => {
        el.innerHTML = '';
        opts.forEach((o) => {
          const k = order.indexOf(o.v);
          el.append(h('button', { class: 'opt' + (k >= 0 ? ' sel' : ''), onclick: () => { if (k >= 0) order.splice(k, 1); else order.push(o.v); draw(); } },
            h('span', { class: 'k' }, k >= 0 ? k + 1 : '・'), h('span', {}, o.label)));
        });
        W.onChange && W.onChange();
      };
      draw();
      W.el = h('div', {}, h('p', { class: 'note' }, '大事な順にタップしてください（もう一度タップで外せます。全部でなくて大丈夫）'), el);
      W.validate = () => order.length > 0; W.submit = () => order.length && send(order.slice());
      return W;
    }

    if (t === 'matrix') {
      const rows = F.derive.slotVal(state, q.input.rowsFrom) || [];
      const cols = q.input.columns;
      const val = Object.assign({}, pv || {});
      const tbl = h('table', { class: 'matrix' }, h('thead', {}, h('tr', {}, h('th', {}, ''), cols.map((c) => h('th', {}, c.label)))));
      const body = h('tbody', {});
      rows.forEach((r) => {
        const tr = h('tr', {}, h('td', {}, r));
        cols.forEach((c) => {
          const b = h('button', { 'aria-pressed': val[r] === c.v, 'aria-label': r + '：' + c.label, onclick: () => { val[r] = c.v; tr.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); W.onChange && W.onChange(); } }, val[r] === c.v ? '●' : '○');
          tr.append(h('td', {}, b));
        });
        body.append(tr);
      });
      tbl.append(body);
      W.el = rows.length ? tbl : h('p', {}, '先に「使う人の立場」を選んでください。');
      W.validate = () => rows.length > 0 && rows.every((r) => val[r]);
      W.submit = () => W.validate() && send(val);
      return W;
    }

    if (t === 'number') {
      const inp = h('input', { type: 'number', inputmode: 'decimal', value: pv != null ? pv : '', 'aria-labelledby': 'qtext', min: q.input.min, max: q.input.max });
      const presets = (q.input.presets || []).map((p) => h('button', { class: 'chip', onclick: () => { inp.value = p; W.onChange && W.onChange(); } }, p + (q.input.unit || '')));
      inp.addEventListener('input', () => W.onChange && W.onChange());
      W.el = h('div', {}, h('div', { style: 'display:flex;gap:8px;align-items:center' }, inp, q.input.unit ? h('span', {}, q.input.unit) : null), presets.length ? h('div', { class: 'presets' }, presets) : null);
      W.validate = () => inp.value !== '' && !isNaN(Number(inp.value));
      W.submit = () => W.validate() && send(Number(inp.value));
      return W;
    }

    if (t === 'month' || t === 'date') {
      const inp = h('input', { type: t === 'month' ? 'month' : 'date', value: pv || '', 'aria-labelledby': 'qtext' });
      inp.addEventListener('input', () => W.onChange && W.onChange());
      W.el = inp; W.validate = () => !!inp.value; W.submit = () => inp.value && send(inp.value);
      return W;
    }

    if (t === 'steps') {
      const items = Array.isArray(pv) && pv.length ? pv.slice() : ['', '', ''];
      const ol = h('ol', { class: 'steps' });
      const draw = () => {
        ol.innerHTML = '';
        items.forEach((v, i) => {
          const inp = h('input', { type: 'text', value: v, placeholder: i === 0 ? (q.input.placeholder || '例：お客様から電話が来る') : '次に起きること', 'aria-label': '手順' + (i + 1) });
          inp.addEventListener('input', () => { items[i] = inp.value; W.onChange && W.onChange(); });
          ol.append(h('li', {}, inp));
        });
      };
      draw();
      W.el = h('div', {}, ol, h('button', { class: 'chip-btn', onclick: () => { items.push(''); draw(); } }, '＋ 手順を足す'));
      W.validate = () => items.filter((x) => x.trim()).length >= 2;
      W.submit = () => W.validate() && send(items.filter((x) => x.trim()));
      return W;
    }

    // text / longtext：原文をそのまま保存する（意味は判定しない）
    const long = t === 'longtext';
    const inp = long ? h('textarea', { placeholder: q.input.placeholder || '', 'aria-labelledby': 'qtext' }, pv || '') : h('input', { type: 'text', value: pv || '', placeholder: q.input.placeholder || '', 'aria-labelledby': 'qtext' });
    const cnt = h('div', { class: 'note' });
    inp.addEventListener('input', () => { cnt.textContent = inp.value.length + '字'; W.onChange && W.onChange(); });
    W.el = h('div', {}, inp, long ? cnt : null);
    W.validate = () => inp.value.trim().length > 0;
    W.submit = () => W.validate() && send(inp.value.trim());
    return W;
  }

  function swipeMini(el, fn) {
    let sx = 0, sy = 0, on = false;
    el.addEventListener('pointerdown', (e) => { on = true; sx = e.clientX; sy = e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (on) el.style.transform = 'translate(' + (e.clientX - sx) + 'px,' + Math.min(0, e.clientY - sy) + 'px)'; });
    el.addEventListener('pointerup', (e) => {
      if (!on) return; on = false; el.style.transform = '';
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (dx > 80) fn('r'); else if (dx < -80) fn('l'); else if (dy < -80) fn('u');
    });
  }

  // ---------- 完了 ----------
  function sendSheet() {
    const url = window.FDE_CONFIG && window.FDE_CONFIG.gasUrl;
    if (!url || session.meta.sentAt) return;
    const sh = F.report.sheets(db, state, session);
    fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(sh) })
      .then(() => { session.meta.sentAt = new Date().toISOString(); save(); toast('担当者に送信しました'); })
      .catch(() => toast('送信できませんでした。ファイルを保存してください'));
  }
  function renderDone() {
    sendSheet();
    const rd = F.quality.readiness(db, state);
    const json = JSON.stringify(session, null, 1);
    $app.append(h('div', { class: 'wrap' }, header(),
      h('div', { class: 'panel' },
        h('h1', {}, 'ありがとうございました'),
        h('p', {}, 'いただいた答えは ' + state.answers.length + ' 問、時間は約 ' + Math.round(state.elapsedSec / 60) + ' 分でした。'),
        h('p', {}, '担当者が内容を整理して、確認のご連絡をします。わからなかった点も、そこで一緒に決めます。'),
        h('button', { class: 'primary', onclick: () => download((session.meta.title || session.meta.id) + '_回答.json', json, 'application/json') }, '担当者に渡すファイルを保存'),
        h('button', { class: 'secondary', onclick: () => { view.reviewSeq = prevReview(); render(); } }, '答えを見直す'),
        h('button', { class: 'secondary', onclick: () => { F.engine.goConfirm(db, session); refresh(); } }, '内容の確認をもう一度'),
        h('p', { class: 'note' }, '判定（担当者向け）：' + rd.verdict))));
  }

  // ---------- FDE 画面 ----------
  const TABS = [['now', '次の質問の理由'], ['reqs', '要件'], ['open', '未決定'], ['hyp', '仮説・矛盾'], ['tech', '技術候補'], ['quality', '品質'], ['review', '人間レビュー'], ['log', '回答・計測'], ['vision', '依頼者理解'], ['out', '書き出し']];
  function renderFde() {
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': view.fdeTab === k, onclick: () => { view.fdeTab = k; render(); } }, l)));
    const body = h('div', { class: 'panel scroll' });
    const T = (head, rows) => h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
    const st = (s) => h('span', { class: 'badge ' + (s === 'confirmed' ? 'ok' : s === 'rejected' ? 'ng' : 'w') }, F.report.STATUS[s] || s);
    const tab = view.fdeTab;
    if (tab === 'now') {
      const n = F.select.next(db, state);
      const cands = F.select.candidates(db, state).slice(0, 15);
      body.append(h('h2', {}, '段階：' + state.stage + '　次：' + (n.iid || '完了')), h('p', {}, '理由：' + (n.why || '')),
        h('p', { class: 'note' }, 'Tier0＝矛盾確認、1＝追加質問（予約 ' + state.queue.length + '件）、2＝必須、3＝スコア順。同点は質問IDの辞書順。ルール版 ' + db.params.ruleVersion),
        T(['候補', '層', 'スコア', 'U不確実', 'D判断', 'I重要', 'F後続', 'B分岐', 'O順序', 'C負荷', '質問'], cands.map((c) => [c.iid, c.tier, c.score, c.parts.U, c.parts.D, c.parts.I, c.parts.F, c.parts.B, c.parts.O, c.parts.C, F.engine.resolveQuestion(db, state, c.iid).text])),
        h('h2', {}, '有効な論点'), h('p', {}, Object.entries(state.topics).filter(([, v]) => v.active).map(([k, v]) => k + '（' + v.reason + '）').join('、')),
        h('h2', {}, '分岐フラグ'), h('p', {}, Object.values(state.branches.flags).map((f) => f.id + ' ' + f.label).join('、') || 'なし'));
    } else if (tab === 'reqs') {
      body.append(T(['ID', '種類', '内容', '状態', '出どころ', '親', '優先', '受け入れ条件', '根拠'], state.reqOrder.map((k) => { const r = state.reqs[k]; return [r.key, F.report.TYPE[r.type] || r.type, r.title, st(r.status), F.report.ORIGIN[r.origin], r.parent || '', r.moscow || '', r.ac || '', '#' + r.answerSeqs.join(',') + ' ' + r.rules.join(',')]; })));
    } else if (tab === 'open') {
      body.append(T(['ID', '種類', '内容', '止める', '確認する人', '理由'], F.quality.openIssues(db, state).map((o) => [o.id, o.kind, o.label, o.blocking ? '止める' : '', o.owner, o.reason])));
    } else if (tab === 'hyp') {
      body.append(h('h2', {}, '競合仮説'), T(['群', '仮説', '状態', '反証条件', '判別質問'], Object.values(state.hyps).map((x) => [x.family, x.label, x.status, x.falsifier, x.discriminators.join(',')])),
        h('h2', {}, '矛盾（構造化項目どうし・回答者間）'), T(['ID', '内容', '状態'], Object.values(state.contradictions).map((c) => [c.id, c.label, c.status])),
        h('h2', {}, '訂正の記録'), T(['#', '種類', '前', '後'], state.corrections.map((c) => [c.seq, c.kind, F.report.fmt(c.before), F.report.fmt(c.after)])));
    } else if (tab === 'tech') {
      const t = state.tech;
      body.append(h('p', {}, '材料の不足：' + (t.missingInputs.map((k) => F.engine.slotLabel(db, k)).join('、') || 'なし') + '（数値の確認日：' + t.checkedAt + '）'),
        T(['構成', '判定', '点', '理由・注意', 'トレードオフ'], t.ranked.map((a) => [a.id + ' ' + a.label, a.status, a.score, a.reasons.concat(a.warnings.map((w) => '注意：' + w)).join('／'), t.tradeoffs[a.id]])));
    } else if (tab === 'quality') {
      const m = F.quality.metrics(db, state), r = F.quality.readiness(db, state);
      body.append(h('h2', {}, '判定：' + r.verdict), T(['ルール', '結果'], r.checks.map((c) => [c.id + ' ' + c.label + (c.hard ? '（必須）' : ''), c.ok ? '○' : '×'])),
        h('h2', {}, '品質指標'), T(['指標', '値', '内訳'], Object.entries(m).map(([k, v]) => [k, v.value == null ? '-' : v.value, v.detail])));
    } else if (tab === 'review') {
      body.append(h('p', { class: 'note' }, '自由記述はツールが意味を判定していません。原文を読み、要件への反映を人が決めてください。'),
        T(['#', '原文', '手がかり', '確認'], F.quality.reviewQueue(db, state).map((r) => [r.seq, r.raw, r.reasons.join('・') + ' ' + r.explain.join(' '),
          r.reviewed ? '済' : h('button', { class: 'chip-btn', onclick: () => { F.engine.markReviewed(db, session, [r.seq]); refresh(); } }, '確認した')])),
        h('button', { class: 'secondary', onclick: () => { F.engine.markReviewed(db, session, F.quality.reviewQueue(db, state).filter((r) => !r.reviewed).map((r) => r.seq)); refresh(); } }, 'すべて確認した（要件への反映を決めた）'));
    } else if (tab === 'log') {
      body.append(T(['#', '質問', '回答', '秒', '立場'], state.answers.map((a) => [a.seq, (F.engine.resolveQuestion(db, state, a.iid) || {}).text || a.iid, F.report.answerText(db, state, a), Math.round(a.ms / 1000), a.persona])),
        h('h2', {}, '回答者を追加・交代'), h('div', { class: 'grid2' }, ROLES.map((r) => h('button', { class: 'secondary', onclick: () => { const id = 'R' + (session.meta.respondents.length + 1); F.engine.switchRespondent(db, session, { id, name: r + '（' + id + '）', role: r }); view.mode = 'card'; refresh(); } }, r + 'として続きを答える'))),
        h('button', { class: 'secondary', onclick: () => { F.engine.goConfirm(db, session); view.mode = 'card'; refresh(); } }, 'ここで質問を終えて、顧客確認へ進む'));
    } else if (tab === 'vision') {
      body.append(T(['項目', '回答'], Object.keys(db.slots).filter((k) => k.startsWith('VIS.') || k.startsWith('PRJ.')).filter((k) => state.slots[k]).map((k) => [db.slots[k].label, F.report.fmt(state.slots[k].value) || '［' + (F.engine.SPECIAL[state.slots[k].status] || state.slots[k].status) + '］'])));
    } else if (tab === 'out') {
      const md = F.report.markdown(db, state, session);
      const sh = F.report.sheets(db, state, session);
      const name = (session.meta.title || session.meta.id).replace(/[\\/:*?"<>|]/g, '_');
      body.append(h('div', { class: 'grid2' },
        h('button', { class: 'secondary', onclick: () => download(name + '_要件定義書.md', md, 'text/markdown') }, '要件定義書（Markdown）を保存'),
        h('button', { class: 'secondary', onclick: () => copy(md) }, '要件定義書をコピー'),
        h('button', { class: 'secondary', onclick: () => copy(sh.requirements) }, '要件一覧をコピー（スプレッドシートに貼る）'),
        h('button', { class: 'secondary', onclick: () => copy(sh.openIssues) }, '未決定事項をコピー（同上）'),
        h('button', { class: 'secondary', onclick: () => copy(sh.answers) }, '回答と計測ログをコピー（同上）'),
        h('button', { class: 'secondary', onclick: () => download(name + '_回答.json', JSON.stringify(session, null, 1), 'application/json') }, '回答ファイル（JSON）を保存')),
        h('pre', { class: 'md' }, md));
    }
    $app.append(h('div', { class: 'wrap wide' },
      h('div', { class: 'top' }, h('div', { class: 'brand' }, 'FDE 画面 — ' + (session.meta.title || session.meta.id)), h('button', { class: 'chip-btn', onclick: () => { view.mode = 'card'; render(); } }, '回答画面へ')),
      tabs, body));
  }

  // 起動
  render();
})();
