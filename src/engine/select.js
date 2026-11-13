/*
 * select.js — S5「次の意思決定に重要な質問の選択」と終了判定
 *
 * 決定論的なルール順位（Tier）＋ スコア。重み・閾値は data/params.json の初期設計値で、
 * 実証済みの値ではない（実測ログで調整する前提）。同点は質問IDの辞書順で決まる。
 *
 *  Tier 0  未解決の矛盾の確認（対置型）
 *  Tier 1  直前の回答から予約された追加質問（深掘り・二手目）— 新しいものから
 *  Tier 2  必須確認項目（案件の型・分岐フラグで必須になったもの）
 *  Tier 3  スコア順
 *  終了    必須が残っておらず、最高スコアが停止閾値未満／時間の上限に達した → S10 顧客確認へ
 */
(function (root) {
  'use strict';
  const isNode = typeof require === 'function';
  const cond = isNode ? require('./cond.js') : root.FDE.cond;
  const util = isNode ? require('./util.js') : root.FDE.util;
  const derive = isNode ? require('./derive.js') : root.FDE.derive;
  const engine = isNode ? require('./engine.js') : root.FDE.engine;

  const DEFAULT_COST = { yesno: 8, single: 15, multi: 25, number: 15, scale: 12, text: 45, longtext: 90, cards: 60, steps: 120, rank: 40, date: 15 };

  function costOf(q) {
    return q.costSec || DEFAULT_COST[(q.input && q.input.type) || 'single'] || 20;
  }

  /** 後続影響：この質問のスロットを条件に使う質問の数（DB 読み込み時に一度だけ計算） */
  function downstreamIndex(db) {
    if (db._down) return db._down;
    const count = {};
    const add = (slots) => slots.forEach((s) => { count[s] = (count[s] || 0) + 1; });
    for (const q of db.questions) add(cond.referencedSlots(q.trigger));
    for (const m of db.rules.mappings) add(cond.referencedSlots(m.when));
    for (const k of db.rules.tech.knockouts) add(cond.referencedSlots(k.when));
    for (const c of db.rules.contradictions) add(cond.referencedSlots(c.when));
    db._down = count;
    return count;
  }

  function personaOk(q, state) {
    if (!q.persona || q.persona === '全員') return true;
    return [].concat(q.persona).includes(state.persona) || [].concat(q.persona).includes('全員');
  }

  /** 繰り返し質問（forEach）を具体的な iid に展開 */
  function instances(q, state) {
    if (!q.forEach) return [{ iid: q.id, param: undefined }];
    const v = derive.slotVal(state, q.forEach);
    return (Array.isArray(v) ? v : []).map((p) => ({ iid: q.id + '@' + p, param: p }));
  }

  function isMandatory(q, state, ctx) {
    const pat = q.slot ? q.slot.replace('{param}', '{e}') : null;
    if (pat && state.branches.mandatorySlots[pat]) return 'branch:' + state.branches.mandatorySlots[pat];
    if (q.mandatory === true) return 'always';
    if (q.mandatory && typeof q.mandatory === 'object' && cond.evaluate(q.mandatory, state, ctx)) return 'conditional';
    return false;
  }

  /** 候補を列挙し、スコアの内訳を付けて返す（説明可能性のため内訳を必ず保持） */
  function candidates(db, state) {
    const P = db.params;
    const w = P.weights;
    const down = downstreamIndex(db);
    const remainingMin = P.time.targetMin - state.elapsedSec / 60;
    const pressure = remainingMin < P.time.pressureMin;
    const askedGroups = {};
    for (const iid of Object.keys(state.asked)) {
      const q = db.qIndex[engine.parseIid(iid).qid];
      if (q && q.dedupe) askedGroups[q.dedupe] = true;
    }
    const techMissing = (state.tech && state.tech.missingInputs) || [];
    const discriminating = {};
    for (const h of Object.values(state.hyps)) {
      if (h.status === 'alive' && state.families[h.family] && state.families[h.family].open) {
        for (const qid of h.discriminators) discriminating[qid] = (discriminating[qid] || 0) + 1;
      }
    }
    const out = [];
    for (const q of db.questions) {
      if (q.generic || q.queuedOnly) continue;
      if (!personaOk(q, state)) continue;
      if (q.topic && !(state.topics[q.topic] && state.topics[q.topic].active)) continue;
      if (q.dedupe && askedGroups[q.dedupe]) continue;
      for (const inst of instances(q, state)) {
        if (state.asked[inst.iid]) continue;
        const ctx = { param: inst.param };
        if (q.trigger && !cond.evaluate(q.trigger, state, ctx)) continue;
        if (q.skipIf && cond.evaluate(q.skipIf, state, ctx)) continue;
        // 前提の混入防止：前提にしている項目が回答済みでなければ出さない
        if (q.presupposes && !q.presupposes.every((k) => state.slots[cond.slotKey(k, ctx)] && cond.KNOWN.includes(state.slots[cond.slotKey(k, ctx)].status))) continue;
        const slot = q.slot ? cond.slotKey(q.slot, ctx) : null;
        if (slot && state.slots[slot] && cond.RESOLVED.includes(state.slots[slot].status)) continue; // 既に分かっていることは聞かない
        const meta = (slot && (db.slots[slot] || db.slots[q.slot])) || {};
        const U = slot ? (meta.weight || 1) : 0.5;
        const decides = (q.decides || []).length;
        const D = decides * 0.5 + (discriminating[q.id] || 0) * 1 + (slot && techMissing.includes(slot) ? 1 : 0);
        const I = (q.importance || 3) / 5;
        const F = Math.log2(1 + (slot ? (down[q.slot] || 0) : 0));
        const B = state.branches.boosts[q.topic] || 0;
        const C = costOf(q) / 60;
        const pi = P.phaseOrder.indexOf(q.phase);
        const O = pi < 0 ? 0 : 1 - pi / P.phaseOrder.length; // 会話の自然な順（目的→困りごと→流れ→…）への小さな寄与
        const mandatory = isMandatory(q, state, ctx);
        if (pressure && !mandatory && (q.importance || 3) < P.time.minImportanceUnderPressure) continue;
        const score = w.uncertainty * U + w.decision * D + w.importance * I + w.downstream * F + w.branch * B + w.phaseOrder * O - w.cost * C * (pressure ? 2 : 1);
        out.push({
          iid: inst.iid, qid: q.id, param: inst.param, tier: mandatory ? 2 : 3, mandatory, score: util.round(score, 3),
          parts: { U, D: util.round(D, 2), I, F: util.round(F, 2), B, O: util.round(O, 2), C: util.round(C, 2), pressure },
          cost: costOf(q),
        });
      }
    }
    return util.stableSortBy(out, (c) => (c.tier === 2 ? 1000 : 0) + c.score, (c) => c.iid);
  }

  function confirmCandidates(db, state) {
    const order = db.params.confirm.typeOrder;
    const list = state.reqOrder
      .map((k) => state.reqs[k])
      .filter((r) => r.confirmImportant && r.plain && r.status === 'unconfirmed' && !state.asked['CONFIRM@' + r.key]);
    // Must（実装を止める判定に効くもの）を先に、次に種類の順（事業の思い→事業要求→制約→機能…）
    const rank = (r) => (r.moscow === 'Must' ? 1000 : 0) - (order.indexOf(r.type) < 0 ? 99 : order.indexOf(r.type));
    return util.stableSortBy(list, rank, (r) => r.key)
      .slice(0, Math.max(0, db.params.confirm.maxCards - Object.keys(state.asked).filter((k) => k.startsWith('CONFIRM@')).length));
  }

  /**
   * 次の一問を決める。
   * @returns {{stage, iid, tier, why, score, parts}|{stage:'done'}}
   */
  function next(db, state) {
    const P = db.params;
    // Tier 0：矛盾
    const contra = Object.values(state.contradictions)
      .filter((c) => c.status === 'open' && !state.asked[c.question])
      .sort((a, b) => b.severity - a.severity || (a.id < b.id ? -1 : 1));
    // Tier 1：予約された追加質問（新しい順＝話の流れを切らない）
    const queue = state.queue
      .filter((x) => !state.asked[x.iid] && engine.resolveQuestion(db, state, x.iid))
      .filter((x) => { const q = engine.resolveQuestion(db, state, x.iid); return !q.slot || !(state.slots[q.slot] && cond.RESOLVED.includes(state.slots[q.slot].status)); })
      .sort((a, b) => b.fromSeq - a.fromSeq || (a.iid < b.iid ? -1 : 1));

    const hardStop = state.elapsedSec / 60 >= P.time.hardMaxMin;
    const inConfirm = state.stage === 'confirm' || hardStop;

    if (!inConfirm) {
      if (contra.length) return { stage: state.stage, iid: contra[0].question, tier: 0, why: '回答どうしの食い違いを確かめる：' + contra[0].label };
      if (queue.length) return { stage: state.stage, iid: queue[0].iid, tier: 1, why: queue[0].why };
      const cands = candidates(db, state);
      // 受付段階では受付の質問だけ（S1〜S4 を先に終える）
      // 受付は会話として自然な固定順（order）で進める
      const pool = state.stage === 'intake'
        ? cands.filter((c) => db.qIndex[c.qid].phase === '00_受付').sort((a, b) => (db.qIndex[a.qid].order || 99) - (db.qIndex[b.qid].order || 99))
        : cands;
      const top = pool[0];
      const softStop = state.elapsedSec / 60 >= P.time.targetMin;
      if (top && (state.stage === 'intake' || top.tier === 2 || (!softStop && top.score >= threshold(P, state)))) {
        return { stage: state.stage, iid: top.iid, tier: top.tier, score: top.score, parts: top.parts, why: explain(db, top) };
      }
    }
    // S10 中の追加質問（「ちがう」の後の特定など）
    if (inConfirm && queue.length) return { stage: 'confirm', iid: queue[0].iid, tier: 1, why: queue[0].why };
    // S10：顧客確認
    const conf = confirmCandidates(db, state);
    if (conf.length) return { stage: 'confirm', iid: 'CONFIRM@' + conf[0].key, tier: 9, why: '推定した内容を平易な文で確認する' };
    return { stage: 'done' };
  }

  /** 任意の質問を出す閾値：時間がたつほど上がる（初期設計値） */
  function threshold(P, state) {
    return P.stopScore + (P.stopScoreRisePerTarget || 0) * Math.min(1, state.elapsedSec / 60 / P.time.targetMin);
  }

  function explain(db, c) {
    const q = db.qIndex[c.qid];
    const bits = [];
    if (c.mandatory) bits.push('必須確認（' + c.mandatory + '）');
    if (c.parts.D > 0) bits.push('意思決定に影響');
    if (c.parts.F > 0) bits.push('後続の質問・判定に影響');
    if (c.parts.B > 0) bits.push('分岐フラグで優先');
    if (c.parts.pressure) bits.push('残り時間が少ないため重要度の高い質問だけ');
    return (q.intent || '') + (bits.length ? ' ／ ' + bits.join('・') : '');
  }

  /** 残りの負荷の見積もり（決定論的・保守側に丸める） */
  function estimate(db, state) {
    const P = db.params;
    const cands = candidates(db, state);
    const mand = cands.filter((c) => c.tier === 2);
    const opt = cands.filter((c) => c.tier === 3 && c.score >= threshold(P, state));
    const queueCost = state.queue.filter((x) => !state.asked[x.iid]).length * 30;
    let sec = mand.reduce((a, c) => a + c.cost, 0) + opt.reduce((a, c) => a + c.cost, 0);
    sec = sec * (1 + P.time.expectedFollowupRate) + queueCost;
    const confirmSec = Math.min(P.confirm.maxCards, state.reqOrder.filter((k) => state.reqs[k].confirmImportant && state.reqs[k].status === 'unconfirmed').length) * 8;
    const remainingBudget = Math.max(0, P.time.targetMin * 60 - state.elapsedSec);
    const loopSec = Math.min(sec, remainingBudget);
    const totalSec = loopSec + confirmSec;
    const avg = cands.length ? (mand.concat(opt).reduce((a, c) => a + c.cost, 0) / Math.max(1, mand.length + opt.length)) : 20;
    // 進み具合：有効な論点の重要項目のうち、解決済みの割合
    const crit = Object.keys(db.slots).filter((k) => db.slots[k].critical && topicActiveFor(db, state, k));
    const done = crit.filter((k) => state.slots[k] && cond.RESOLVED.includes(state.slots[k].status));
    return {
      remainingMin: Math.ceil(totalSec / 60),
      remainingQuestions: Math.round(loopSec / Math.max(8, avg)) + Math.ceil(confirmSec / 8),
      elapsedMin: util.round(state.elapsedSec / 60, 1),
      criticalResolved: done.length, criticalTotal: crit.length,
      progress: crit.length ? done.length / crit.length : 0,
      mandatoryLeft: mand.length,
    };
  }

  function topicActiveFor(db, state, slotKey) {
    const quality = isNode ? require('./quality.js') : root.FDE.quality;
    return quality.activeTopic(db, state, slotKey);
  }

  const api = { next, candidates, estimate, confirmCandidates, costOf, downstreamIndex, threshold };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.select = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
