/*
 * tech.js — ビジネス条件と技術構成の接続（3段：ノックアウト → 重み付け → ADR 下書き）
 *
 * 入力：利用人数・同時利用・データ量・権限・更新頻度・連携・監査・機密性・費用・運用体制などのスロット
 * 出力：候補構成ごとの状態（候補／要確認／除外）、理由、トレードオフ、足りない入力
 * 数値（上限・料金）は data/rules/tech.json に出典と確認日つきで置き、ここでは判定だけをする。
 */
(function (root) {
  'use strict';
  const isNode = typeof require === 'function';
  const cond = isNode ? require('./cond.js') : root.FDE.cond;
  const util = isNode ? require('./util.js') : root.FDE.util;

  function evaluate(db, state) {
    const T = db.rules.tech;
    const missingInputs = T.requiredInputs.filter((k) => !(state.slots[k] && cond.RESOLVED.includes(state.slots[k].status)));
    const unknownInputs = T.requiredInputs.filter((k) => state.slots[k] && ['dontknow', 'later'].includes(state.slots[k].status));
    const arch = {};
    for (const a of T.architectures) arch[a.id] = { id: a.id, label: a.label, plain: a.plain, status: 'candidate', reasons: [], warnings: [], score: 0, scoreParts: [] };

    // 第1段：ノックアウト
    for (const k of T.knockouts) {
      if (!cond.evaluate(k.when, state)) continue;
      for (const id of Object.keys(k.effects)) {
        const eff = k.effects[id];
        if (!arch[id]) continue;
        if (eff === 'x') { arch[id].status = 'excluded'; arch[id].reasons.push(k.label); }
        else if (eff === 'plus') { arch[id].bonus = (arch[id].bonus || 0) + 0.5; arch[id].reasons.push('有利：' + k.label); }
        else if (eff === 'warn') { if (arch[id].status === 'candidate') arch[id].status = 'check'; arch[id].warnings.push(k.label); }
      }
    }
    // 第2段：重み付け（重みは事業上の優先から決まる。初期設計値）
    let weightSum = 0;
    for (const c of T.criteria) {
      let wt = c.weight || 1;
      if (c.weightWhen) for (const ww of c.weightWhen) if (cond.evaluate(ww.when, state)) wt = ww.weight;
      weightSum += wt;
      for (const id of Object.keys(arch)) {
        const s = (c.scores[id] == null ? 3 : c.scores[id]);
        arch[id].score += wt * s;
        arch[id].scoreParts.push({ criterion: c.label, weight: wt, score: s });
      }
    }
    for (const id of Object.keys(arch)) arch[id].score = util.round(arch[id].score / Math.max(1, weightSum) + (arch[id].bonus || 0), 2);
    const ranked = util.stableSortBy(Object.values(arch),
      (a) => (a.status === 'candidate' ? 100 : a.status === 'check' ? 50 : 0) + a.score, (a) => a.id);
    const confident = missingInputs.length === 0;
    return { ranked, missingInputs, unknownInputs, confident, tradeoffs: T.tradeoffs, checkedAt: T.checkedAt };
  }

  const api = { evaluate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.tech = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
