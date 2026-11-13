/*
 * engine.js — ヒアリングの状態管理（イベントソーシング）
 *
 * セッション＝「回答ログ（追記のみ）」。状態は毎回ログを先頭から再生して作る。
 *   → 同じログ＋同じルール版なら、必ず同じ状態・同じ次の質問になる（説明可能・再現可能）。
 *   → 前の回答を訂正すると、訂正後のログで再生し直すだけで、後続の分岐・要件が自動で整合する。
 *   → 訂正前の値は消さずに「訂正ログ」に残す（相手の訂正は重要な情報として扱う）。
 *
 * 10ステップと stage の対応
 *   S1 相談内容の理解 / S2 事実・推測の分類 / S3 論点候補の抽出 / S4 競合仮説の設定 … stage=intake
 *   S5 質問の選択 / S6 平易な一問 / S7 回答の分析 / S8 追加質問 / S9 要件への構造化 … stage=loop
 *   S10 顧客確認 … stage=confirm → done
 */
(function (root) {
  'use strict';
  const isNode = typeof require === 'function';
  const util = isNode ? require('./util.js') : root.FDE.util;
  const cond = isNode ? require('./cond.js') : root.FDE.cond;
  const detect = isNode ? require('./detect.js') : root.FDE.detect;
  const derive = isNode ? require('./derive.js') : root.FDE.derive;
  const tech = isNode ? require('./tech.js') : root.FDE.tech;

  const SPECIAL = { dontknow: 'わからない', later: '後で確認', na: '該当しない' };

  // ---------------- DB の索引 ----------------
  function indexDb(db) {
    if (db._indexed) return db;
    db.qIndex = {};
    for (const q of db.questions) {
      if (db.qIndex[q.id]) throw new Error('質問IDの重複: ' + q.id);
      db.qIndex[q.id] = q;
    }
    db.contraIndex = {};
    for (const r of db.rules.contradictions) db.contraIndex[r.id] = r;
    db._indexed = true;
    return db;
  }

  // ---------------- セッション ----------------
  function createSession(db, meta) {
    meta = meta || {};
    return {
      format: 'fde-hearing-session/1',
      meta: {
        id: meta.id || 'case-' + Date.now(),
        title: meta.title || '',
        createdAt: meta.createdAt || new Date().toISOString(),
        dbVersion: db.version,
        ruleVersion: db.params.ruleVersion,
        respondents: meta.respondents || [{ id: 'R1', name: meta.respondentName || '回答者1', role: meta.role || '経営者' }],
        budgetMin: meta.budgetMin || db.params.time.targetMin,
      },
      log: [],
    };
  }

  function addEvent(session, ev) {
    const seq = session.log.length ? session.log[session.log.length - 1].seq + 1 : 1;
    const e = Object.assign({ seq, ts: new Date().toISOString() }, ev);
    session.log.push(e);
    return e;
  }

  // ---------------- 仮想質問の解決 ----------------
  function parseIid(iid) {
    const at = iid.indexOf('@');
    return at < 0 ? { qid: iid, param: undefined } : { qid: iid.slice(0, at), param: iid.slice(at + 1) };
  }

  function slotLabel(db, key) {
    if (db.slots[key]) return db.slots[key].label;
    const base = key.replace(/__\w+$/, '');
    return (db.slots[base] && db.slots[base].label) || key;
  }

  /** iid（質問ID＋パラメータ）から、表示・適用に使う具体的な質問オブジェクトを作る */
  function resolveQuestion(db, state, iid) {
    const { qid, param } = parseIid(iid);
    if (qid === 'C') return contrastQuestion(db, state, param, iid);
    if (qid === 'CONFIRM') return confirmQuestion(db, state, param, iid);
    const base = db.qIndex[qid];
    if (!base) return null;
    const q = Object.assign({}, base, { iid, param });
    const v = derive.vars(state, db, param);
    if (base.generic) {
      v.paramLabel = slotLabel(db, param);
      const prevAns = state.slots[param];
      v.prev = prevAns && prevAns.raw ? String(prevAns.raw).slice(0, 60) : (prevAns && Array.isArray(prevAns.value) ? prevAns.value.join('、') : prevAns && prevAns.value);
      q.slot = param + '__' + base.slotSuffix;
    } else {
      q.slot = base.slot ? cond.slotKey(base.slot, { param }) : null;
    }
    q.text = util.template(base.text, v);
    q.help = base.help ? util.template(base.help, v) : '';
    if (base.input && base.input.options) {
      q.input = Object.assign({}, base.input, {
        options: base.input.options.map((o) => Object.assign({}, o, { label: util.template(o.label, v) })),
      });
    }
    if (base.input && base.input.optionsFrom) q.input = Object.assign({}, base.input, { options: optionsFrom(db, state, base.input.optionsFrom) });
    return q;
  }

  /** 選択肢を DB の辞書から作る（論点カード・エンティティカードなど） */
  function optionsFrom(db, state, spec) {
    if (spec === 'topics') return db.rules.topics.filter((t) => !t.always && !t.hiddenCard).map((t) => ({ v: t.id, label: t.card || t.label, hint: t.plain }));
    if (spec === 'entities') return Object.keys(db.rules.entities.types).map((k) => ({ v: k, label: db.rules.entities.types[k].label, hint: db.rules.entities.types[k].plain }));
    if (spec.startsWith('hyp:')) {
      const fam = db.rules.hypotheses.find((f) => f.id === spec.slice(4));
      return fam ? fam.hyps.map((h) => ({ v: h.id, label: h.card || h.label, hint: h.plain })) : [];
    }
    if (spec.startsWith('slot:')) {
      const val = derive.slotVal(state, spec.slice(5)) || [];
      return val.map((x) => ({ v: x, label: derive.labelOfParam(db, x) || x }));
    }
    return [];
  }

  function contrastQuestion(db, state, cid, iid) {
    const c = state.contradictions[cid];
    if (cid.startsWith('C-RESP@')) {
      const key = cid.slice(7);
      const conflict = (c && c.conflict) || { a: '?', b: '?' };
      const fmt = (x) => Array.isArray(x) ? x.join('、') : String(x);
      return {
        iid, id: 'C', type: 'contrast', step: 7, topic: 'core', persona: '全員', importance: 4, costSec: 15,
        text: '「' + slotLabel(db, key) + '」について、「' + fmt(conflict.a) + '」と「' + fmt(conflict.b) + '」の2つの答えが出ています。いまの実際に近いのはどちらですか？',
        intent: '回答者間の食い違いを事実で確かめる（対置型）', technique: '対置型',
        input: { type: 'single', options: [
          { v: 'a', label: fmt(conflict.a), setSlot: { [key]: conflict.a } },
          { v: 'b', label: fmt(conflict.b), setSlot: { [key]: conflict.b } },
          { v: 'both', label: '場合によって違う' },
        ] }, slot: null, contradiction: cid, sources: ['C:VS5', 'C:原則10'],
      };
    }
    const r = db.contraIndex[cid];
    if (!r) return null;
    const v = derive.vars(state, db);
    return {
      iid, id: 'C', type: 'contrast', step: 7, topic: 'core', persona: '全員', importance: r.severity >= 3 ? 5 : 4, costSec: 15,
      text: util.template(r.question, v), help: util.template(r.help || '', v),
      intent: r.intent || ('矛盾の確認：' + r.label), technique: '対置型',
      input: { type: 'single', options: r.options.map((o) => Object.assign({}, o, { label: util.template(o.label, v) })) },
      slot: null, contradiction: cid, decides: r.decides || [], sources: r.sources || [],
    };
  }

  function confirmQuestion(db, state, key, iid) {
    const r = state.reqs[key];
    if (!r) return null;
    return {
      iid, id: 'CONFIRM', type: 'confirm', step: 10, topic: 'core', persona: '全員', importance: 5, costSec: 8,
      text: r.plain || r.title, help: r.type === 'BR' ? '事業のねらい' : '',
      intent: '推定した要件を、平易な文で顧客に確かめる', technique: '仮置き型',
      input: { type: 'yesno', yes: '合っている', no: 'ちがう', allowNote: true },
      reqKey: key, slot: null, sources: ['C:VS5', 'B:§VIS'],
    };
  }

  // ---------------- 再生（replay） ----------------
  function initState(db, session) {
    return {
      meta: session.meta, stage: 'intake', persona: session.meta.respondents[0].role, respondent: session.meta.respondents[0].id,
      slots: {}, asked: {}, answers: [], queue: [], detFlags: {}, flags: {}, depth: {},
      topics: {}, hyps: {}, families: {}, contradictions: {}, contraAnswered: {}, branches: { flags: {}, boosts: {}, mandatorySlots: {} },
      reqs: {}, reqOrder: [], confirmations: {}, corrections: [], orphans: [], counters: {},
      elapsedSec: 0, manualConfirm: false, notes: [], fdeReviewed: {},
    };
  }

  function replay(db, session) {
    indexDb(db);
    const state = initState(db, session);
    const superseded = {};
    for (const e of session.log) {
      if (e.type === 'edit' || e.type === 'retract') superseded[e.target] = e.seq;
    }
    recompute(db, state);
    for (const e of session.log) {
      if (e.type === 'respondent') {
        const r = session.meta.respondents.find((x) => x.id === e.respondent);
        if (r) { state.respondent = r.id; state.persona = r.role; }
        continue;
      }
      if (e.type === 'stage') { if (e.to === 'confirm') state.manualConfirm = true; continue; }
      if (e.type === 'note') { state.notes.push(e); continue; }
      if (e.type === 'fdeReview') { (e.seqs || []).forEach((x) => { state.fdeReviewed[x] = e.seq; }); continue; }
      if (e.type === 'retract') {
        const orig = session.log.find((x) => x.seq === e.target);
        if (orig) state.corrections.push({ seq: e.seq, target: e.target, iid: orig.iid, before: orig.value, after: null, kind: 'retract' });
        continue;
      }
      if (e.type !== 'answer' && e.type !== 'edit') continue;
      if (superseded[e.seq]) continue;
      if (e.type === 'edit') {
        const orig = session.log.find((x) => x.seq === e.target);
        state.corrections.push({ seq: e.seq, target: e.target, iid: e.iid, before: orig ? (orig.kind === 'value' ? orig.value : SPECIAL[orig.kind]) : null, after: e.kind === 'value' ? e.value : SPECIAL[e.kind], kind: 'edit' });
      }
      applyAnswer(db, state, e);
      recompute(db, state);
    }
    updateStage(db, state);
    return state;
  }

  /** 回答を状態に反映する（S7 回答の分析 → S8 追加質問の予約） */
  function applyAnswer(db, state, e) {
    const q = resolveQuestion(db, state, e.iid);
    if (!q) { state.orphans.push({ seq: e.seq, iid: e.iid, reason: '質問がDBにない（版が違う可能性）' }); return; }
    // 前提が変わって、もうこの質問が出ない状態なら適用しない（訂正の連鎖を正しく扱う）
    if (!stillValid(db, state, q)) { state.orphans.push({ seq: e.seq, iid: e.iid, reason: '前の回答の訂正で、この質問の前提が変わった' }); return; }

    state.asked[e.iid] = e.seq;
    state.elapsedSec += Math.min((e.ms || 0) / 1000, db.params.time.maxCardSec);
    const rec = { seq: e.seq, iid: e.iid, qid: q.id, kind: e.kind, value: e.value, raw: e.raw, respondent: state.respondent, persona: state.persona, ms: e.ms || 0, det: null, note: e.note };
    state.answers.push(rec);
    state.queue = state.queue.filter((x) => x.iid !== e.iid);

    if (q.type === 'confirm') {
      const st = e.kind === 'value' ? (e.value === true ? 'confirmed' : 'rejected') : (e.kind === 'later' || e.kind === 'dontknow' ? 'held' : 'na');
      state.confirmations[q.reqKey] = { status: st, note: e.note || '', seq: e.seq };
      if (st === 'rejected') {
        state.corrections.push({ seq: e.seq, iid: e.iid, before: q.text, after: e.note || '（ちがう）', kind: 'confirm-reject' });
        if (db.qIndex['G-NEG']) enqueue(state, 'G-NEG@' + q.reqKey, '否定された点を特定する（外れた部分だけ入れ替える）', e.seq, 1);
      }
      return;
    }
    if (q.type === 'contrast') {
      state.contraAnswered[q.contradiction] = { value: e.value, kind: e.kind, seq: e.seq };
      if (e.kind === 'value') {
        const opt = q.input.options.find((o) => o.v === e.value);
        if (opt) applySets(db, state, opt, e, q);
      }
      return;
    }

    const key = q.slot;
    if (e.kind !== 'value') {
      if (key) setSlot(db, state, key, { value: null, status: e.kind, origin: 'customer', qid: q.id, seq: e.seq });
      // 重要な項目が「わからない」→ わかりそうな人を一問だけ聞く（未決定事項の担当を決めるため）
      if (key && e.kind === 'dontknow' && !q.generic && db.slots[key] && db.slots[key].weight >= 3 && db.qIndex['G-WHOKNOWS']) {
        enqueue(state, 'G-WHOKNOWS@' + key, '「わからない」の担当を決める', e.seq, 1);
      }
      return;
    }

    const type = q.input.type;
    let value = e.value;
    let origin = 'selected';
    if (type === 'text' || type === 'longtext') {
      origin = 'text';
      const a = detect.analyzeText(e.value, db.rules.lexicon, db.params.detect);
      rec.det = a.det; rec.explain = a.explain; rec.epistemicHint = a.epistemicHint;
      if (key) {
        for (const d of q.deepdive || []) if (a.det[d]) state.detFlags[d + '@' + key] = true;
        // 形式判定に応じて原文を別の項目にも写す（例：手段だけの相談 → 「お客様が考えている手段」）
        for (const ct of q.copyTo || []) if (a.det[ct.det]) setSlot(db, state, ct.slot, { value: e.value, raw: e.value, status: 'answered', origin: 'text', qid: q.id, seq: e.seq });
        if (a.det.correction) state.corrections.push({ seq: e.seq, iid: e.iid, before: null, after: e.value, kind: 'text-correction-word' });
      }
    } else if (type === 'number') {
      value = Number(e.value);
    } else if (type === 'cards') {
      value = (e.value && e.value.yes) || [];
      if (key) {
        setSlot(db, state, key + '_no', { value: (e.value && e.value.no) || [], status: 'answered', origin, qid: q.id, seq: e.seq });
        setSlot(db, state, key + '_unknown', { value: (e.value && e.value.unknown) || [], status: 'answered', origin, qid: q.id, seq: e.seq });
      }
    } else if (type === 'points') {
      // 配分（10点を配る）：値は {選択肢: 点}。最も点の多いものを __top に入れる
      const entries = Object.entries(e.value || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      if (key && entries.length) setSlot(db, state, key + '__top', { value: entries[0][0], status: 'answered', origin, qid: q.id, seq: e.seq });
    } else if (type === 'steps') {
      value = (e.value || []).filter((x) => String(x).trim());
      origin = 'text';
    }
    if (key) setSlot(db, state, key, { value, raw: e.raw != null ? e.raw : (typeof e.value === 'string' ? e.value : null), status: 'answered', origin, qid: q.id, seq: e.seq, epistemic: e.epistemic });

    // 選択肢に付いた追加の設定・フラグ
    const chosen = [].concat(['multi', 'rank'].includes(type) ? (value || []) : [value]);
    for (const o of (q.input.options || [])) if (chosen.includes(o.v)) applySets(db, state, o, e, q);
    if (q.input.type === 'yesno') {
      const o = value === true ? q.input.onYes : q.input.onNo;
      if (o) applySets(db, state, o, e, q);
    }

    // S8：追加質問の予約（その質問に書かれた条件 → 汎用の深掘り）
    const ctx = { param: q.param, det: rec.det || {} };
    const bkey = key ? baseSlot(key) : null;
    if (q.generic && bkey) state.depth[bkey] = (state.depth[bkey] || 0) + 1;
    const depth = bkey ? (state.depth[bkey] || 0) : 0;
    for (const f of q.followups || []) {
      if (depth >= db.params.deepdive.maxDepth && f.deep) continue;
      if (cond.evaluate(f.when, state, ctx)) enqueue(state, f.ask.indexOf('@') < 0 && q.param ? f.ask + '@' + q.param : f.ask, f.why || '追加質問', e.seq, depth + 1);
    }
    if (rec.det && bkey && depth < db.params.deepdive.maxDepth) {
      for (const d of db.rules.deepdive) {
        if ((q.deepdive || []).includes(d.det) && rec.det[d.det]) {
          enqueue(state, d.ask + '@' + bkey, d.why, e.seq, depth + 1);
          break; // 一度に一つだけ（一問一論点）
        }
      }
    }
    if (q.epistemic && key && db.qIndex['EPI']) enqueue(state, 'EPI@' + key, '事実か推測かを本人に分けてもらう', e.seq, depth + 1);
  }

  function baseSlot(key) { return key.replace(/__\w+$/, ''); }

  function applySets(db, state, o, e, q) {
    if (o.set) for (const k of Object.keys(o.set)) setSlot(db, state, k, { value: o.set[k], status: 'answered', origin: 'selected', qid: q.id, seq: e.seq });
    if (o.setSlot) for (const k of Object.keys(o.setSlot)) setSlot(db, state, k, { value: o.setSlot[k], status: 'answered', origin: 'selected', qid: q.id, seq: e.seq, resolvedConflict: true });
    if (o.flags) for (const f of o.flags) state.detFlags[f] = true;
    if (o.ask) enqueue(state, o.ask, o.why || '選択に応じた追加質問', e.seq, 1);
  }

  function setSlot(db, state, key, s) {
    const prev = state.slots[key];
    const next = Object.assign({ by: state.respondent }, s);
    // 回答者が違い、構造化された値が食い違う → 回答者間の矛盾として残す（どちらも消さない）
    if (prev && prev.by && prev.by !== state.respondent && cond.KNOWN.includes(prev.status) && s.status === 'answered' && !s.resolvedConflict &&
        JSON.stringify(prev.value) !== JSON.stringify(s.value) && db.slots[key] && db.slots[key].type !== 'text') {
      next.conflict = { a: prev.value, b: s.value, byA: prev.by, byB: state.respondent };
    }
    if (prev && prev.history) next.history = prev.history.concat([{ value: prev.value, status: prev.status, by: prev.by, seq: prev.seq }]);
    else if (prev) next.history = [{ value: prev.value, status: prev.status, by: prev.by, seq: prev.seq }];
    state.slots[key] = next;
  }

  function enqueue(state, iid, why, fromSeq, depth) {
    if (state.asked[iid] || state.queue.some((x) => x.iid === iid)) return;
    state.queue.push({ iid, why, fromSeq, depth });
  }

  function stillValid(db, state, q) {
    if (q.type === 'confirm') return !!state.reqs[q.reqKey];
    if (q.type === 'contrast') return !!state.contradictions[q.contradiction];
    if (q.generic) return !!(state.slots[baseSlot(q.slot)] || state.reqs[baseSlot(q.slot)]);
    if (q.queuedOnly) return true; // 追加質問は予約された時点の判断を尊重
    const ctx = { param: q.param };
    if (q.trigger && !cond.evaluate(q.trigger, state, ctx)) return false;
    // 論点そのものが無効になった（例：「一般の個人向け」→「社内向け」に訂正）なら、その論点の回答は使わない
    if (q.topic && state.topics[q.topic] && !state.topics[q.topic].active) return false;
    return true;
  }

  /** 導出物を作り直す（S3 論点・S4 仮説・矛盾・分岐・S9 要件・技術候補） */
  function recompute(db, state) {
    state.flags = Object.assign({}, state.detFlags);
    state.topics = derive.computeTopics(state, db);
    const br = derive.computeBranches(state, db);
    state.branches = br;
    Object.assign(state.flags, Object.fromEntries(Object.keys(br.flags).map((k) => [k, true])));
    state.topics = derive.computeTopics(state, db); // 分岐フラグで有効になる論点を反映
    const h = derive.computeHypotheses(state, db);
    state.hyps = h.hyps; state.families = h.families;
    const c = derive.computeContradictions(state, db, state.contradictions);
    for (const id of Object.keys(c)) if (state.contraAnswered[id]) c[id].status = 'accepted';
    state.contradictions = c;
    const r = derive.computeRequirements(state, db);
    state.reqs = r.reqs; state.reqOrder = r.order;
    state.tech = tech.evaluate(db, state);
    return state;
  }

  function updateStage(db, state) {
    const intakeDone = db.questions.filter((q) => q.phase === '00_受付' && !q.generic && !q.queuedOnly)
      .every((q) => state.asked[q.id] || (q.trigger && !cond.evaluate(q.trigger, state)) || (q.persona !== '全員' && q.persona && ![].concat(q.persona).includes(state.persona)));
    if (!intakeDone) { state.stage = 'intake'; return; }
    state.stage = 'loop';
    if (state.manualConfirm || state.stopLoop) state.stage = 'confirm';
  }

  // ---------------- 公開 API ----------------
  function answer(db, session, iid, payload) {
    const p = payload || {};
    addEvent(session, { type: 'answer', iid, kind: p.kind || 'value', value: p.value, raw: p.raw, epistemic: p.epistemic, ms: p.ms || 0, note: p.note });
    return replay(db, session);
  }
  function edit(db, session, targetSeq, payload) {
    const orig = session.log.find((x) => x.seq === targetSeq);
    if (!orig) throw new Error('訂正対象の回答がありません: ' + targetSeq);
    const p = payload || {};
    addEvent(session, { type: 'edit', target: targetSeq, iid: orig.iid, kind: p.kind || 'value', value: p.value, raw: p.raw, epistemic: p.epistemic, ms: p.ms || 0, note: p.note });
    return replay(db, session);
  }
  function retract(db, session, targetSeq) {
    addEvent(session, { type: 'retract', target: targetSeq });
    return replay(db, session);
  }
  function switchRespondent(db, session, respondent) {
    if (!session.meta.respondents.find((r) => r.id === respondent.id)) session.meta.respondents.push(respondent);
    addEvent(session, { type: 'respondent', respondent: respondent.id });
    return replay(db, session);
  }
  function goConfirm(db, session) {
    addEvent(session, { type: 'stage', to: 'confirm' });
    return replay(db, session);
  }
  /** FDE が自由記述を読んで要件への反映を確認した印（R09）。回答そのものは変えない */
  function markReviewed(db, session, seqs) {
    addEvent(session, { type: 'fdeReview', seqs });
    return replay(db, session);
  }
  /** 有効な（訂正されていない）回答イベント */
  function activeAnswers(session) {
    const sup = {};
    for (const e of session.log) if (e.type === 'edit' || e.type === 'retract') sup[e.target] = true;
    return session.log.filter((e) => (e.type === 'answer' || e.type === 'edit') && !sup[e.seq]);
  }

  const api = { indexDb, createSession, replay, answer, edit, retract, switchRespondent, goConfirm, markReviewed, resolveQuestion, activeAnswers, parseIid, slotLabel, SPECIAL, recompute };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.engine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
