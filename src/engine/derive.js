/*
 * derive.js — スロットから決定論的に導くもの
 *   ・論点（topics）の有効化
 *   ・競合仮説（hypotheses）の状態
 *   ・矛盾（contradictions）の検出 — 構造化項目どうしだけ
 *   ・分岐フラグ（branches）— 「KPIが不明」「権限が未定義」など
 *   ・要件変換（mappings）— 推定した要件は必ず「未確認」で作る
 * どれも「同じスロット → 同じ結果」の純関数。
 */
(function (root) {
  'use strict';
  const isNode = typeof require === 'function';
  const cond = isNode ? require('./cond.js') : root.FDE.cond;
  const util = isNode ? require('./util.js') : root.FDE.util;

  function slotVal(state, key) {
    const s = state.slots[key];
    return s && cond.KNOWN.includes(s.status) ? s.value : undefined;
  }

  /** テンプレート用の変数（スロット値＋ラベル） */
  function vars(state, db, param) {
    const v = { param: param, paramLabel: labelOfParam(db, param) };
    for (const k of Object.keys(state.slots)) {
      const parts = k.split('.');
      let o = v;
      for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
      const val = slotVal(state, k);
      if (val !== undefined && typeof o === 'object') o[parts[parts.length - 1]] = val;
    }
    // 繰り返し（エンティティ）用の短縮：{{P.count}} = DAT.<param>.count
    if (param != null && v.DAT && v.DAT[param] && typeof v.DAT[param] === 'object') v.P = v.DAT[param];
    if (param != null && v.ROLE && v.ROLE.matrix && typeof v.ROLE.matrix === 'object') v.PM = v.ROLE.matrix[param];
    return v;
  }

  function labelOfParam(db, param) {
    if (param == null) return undefined;
    const ent = db.rules.entities && db.rules.entities.types && db.rules.entities.types[param];
    return ent ? ent.label : param;
  }

  // ---------- 論点 ----------
  function computeTopics(state, db) {
    const out = {};
    const yes = slotVal(state, 'ISS.topics') || [];
    const no = slotVal(state, 'ISS.topics_no') || [];
    for (const t of db.rules.topics) {
      const byRule = cond.evaluate(t.activateWhen, state);
      const forced = t.always || (t.forceWhen && cond.evaluate(t.forceWhen, state));
      let active = forced || byRule || yes.includes(t.id);
      let reason = forced ? '必須の論点' : byRule ? '回答からの規則' : yes.includes(t.id) ? '回答者が「関係ある」' : '';
      if (!forced && no.includes(t.id) && !byRule) { active = false; reason = '回答者が「関係ない」'; }
      out[t.id] = { active: !!active, reason };
    }
    return out;
  }

  // ---------- 競合仮説 ----------
  function computeHypotheses(state, db) {
    const hyps = {};
    const families = {};
    for (const f of db.rules.hypotheses) {
      const famActive = cond.evaluate(f.activateWhen, state);
      let alive = 0, supported = 0;
      for (const h of f.hyps) {
        let status = 'alive';
        if (!famActive) status = 'inactive';
        else if (h.refuteWhen && cond.evaluate(h.refuteWhen, state)) status = 'refuted';
        else if (h.supportWhen && cond.evaluate(h.supportWhen, state)) status = 'supported';
        if (status === 'alive') alive++;
        if (status === 'supported') supported++;
        hyps[h.id] = { id: h.id, family: f.id, label: h.label, status, falsifier: h.falsifier, discriminators: h.discriminators || [] };
      }
      // 2つ以上の仮説が生きていて、まだ支持されたものがない → 判別質問の価値が高い
      families[f.id] = { id: f.id, label: f.label, active: famActive, alive, supported, open: famActive && alive >= 2 && supported === 0, decides: f.decides };
    }
    return { hyps, families };
  }

  // ---------- 矛盾（構造化項目どうし） ----------
  function computeContradictions(state, db, prev) {
    const out = {};
    for (const r of db.rules.contradictions) {
      if (!cond.evaluate(r.when, state)) continue;
      const p = prev && prev[r.id];
      out[r.id] = {
        id: r.id, label: r.label, severity: r.severity || 2,
        status: p && p.status !== 'open' ? p.status : 'open',
        question: 'C@' + r.id,
        slots: cond.referencedSlots(r.when),
      };
    }
    // 回答者間の食い違い（同じ項目に別の値）
    for (const k of Object.keys(state.slots)) {
      const s = state.slots[k];
      if (s.conflict) {
        const id = 'C-RESP@' + k;
        const p = prev && prev[id];
        out[id] = { id, label: '回答者によって答えが違う：' + ((db.slots[k] && db.slots[k].label) || k), severity: 2,
          status: p && p.status !== 'open' ? p.status : 'open', question: 'C@' + id, slots: [k], conflict: s.conflict };
      }
    }
    return out;
  }

  // ---------- 分岐フラグ ----------
  function computeBranches(state, db) {
    const flags = {};
    const boosts = {};
    const mandatorySlots = {};
    for (const b of db.rules.branches) {
      if (!cond.evaluate(b.when, state)) continue;
      flags[b.flag] = { id: b.id, label: b.label };
      if (b.boostTopic) boosts[b.boostTopic] = (boosts[b.boostTopic] || 0) + (b.boost || 1);
      // 分岐で必須になるのは、その分岐を解消する項目だけ（論点まるごとではない）
      for (const sl of b.resolves || []) if (!mandatorySlots[sl]) mandatorySlots[sl] = b.id;
    }
    return { flags, boosts, mandatorySlots };
  }

  // ---------- 要件変換 ----------
  function paramsFor(state, spec) {
    if (!spec) return [undefined];
    const v = slotVal(state, spec);
    return Array.isArray(v) ? v : [];
  }

  function computeRequirements(state, db) {
    const reqs = {};
    const order = [];
    for (const m of db.rules.mappings) {
      for (const param of paramsFor(state, m.forEach)) {
        const ctx = { param };
        if (!cond.evaluate(m.when, state, ctx)) continue;
        const v = vars(state, db, param);
        for (const e of m.emit) {
          const key = util.template(e.key, v, param);
          if (reqs[key]) { // 同じ要件を複数の規則が導いたら根拠を追加
            reqs[key].rules.push(m.id);
            continue;
          }
          const traceSlots = (e.trace || cond.referencedSlots(m.when)).map((s) => cond.slotKey(s, ctx));
          const answerSeqs = util.uniq(traceSlots.map((s) => state.slots[s] && state.slots[s].seq).filter((x) => x != null));
          const origin = e.origin || 'rule'; // customer＝回答そのまま／rule＝規則による推定
          reqs[key] = {
            key, type: e.type, title: util.template(e.title, v, '（未定）'),
            text: util.template(e.text || e.title, v, '（未定）'),
            plain: e.plain ? util.template(e.plain, v, '（未定）') : null,
            moscow: e.moscow || null, topic: e.topic || null,
            origin, rules: [m.id], traceSlots, answerSeqs,
            parent: e.parent ? util.template(e.parent, v, param) : null,
            ac: e.ac ? util.template(e.ac, v, '（未定）') : null,
            confirmImportant: !!e.confirm,
            status: 'unconfirmed',
            sources: m.sources || [],
          };
          order.push(key);
        }
      }
    }
    // 親（事業要求）の付け替え：指定の親がなければ、困りごと（BR-01）につなぐ
    for (const key of order) {
      const r = reqs[key];
      if (r.parent && !reqs[r.parent]) r.parent = reqs['BR-GOAL'] ? 'BR-GOAL' : reqs['BR-01'] ? 'BR-01' : null;
    }
    // MoSCoW：顧客が並べた「最初の版に必ず入れたいこと」の上位3つの論点に属する機能は Must（推定・未確認）
    const must = slotVal(state, 'PRI.must');
    if (Array.isArray(must)) {
      for (const key of order) {
        const r = reqs[key];
        if (r.moscow || !r.topic || !['FR', 'NFR', 'INT'].includes(r.type)) continue;
        const i = must.indexOf(r.topic);
        r.moscow = i >= 0 && i < 3 ? 'Must' : i >= 0 ? 'Should' : 'Could';
        r.moscowBy = 'PRI.must の順位から推定';
      }
    }
    // 顧客確認の結果を反映（確認だけが status を変えられる）
    for (const key of order) {
      const c = state.confirmations[key];
      if (c) { reqs[key].status = c.status; reqs[key].confirmNote = c.note || ''; }
    }
    return { reqs, order };
  }

  const api = { computeTopics, computeHypotheses, computeContradictions, computeBranches, computeRequirements, vars, slotVal, labelOfParam };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.derive = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
