/*
 * quality.js — 未決定事項・人間レビュー待ち・ヒアリング品質指標・仕様確定判定
 * 品質は「質問の多さ」ではなく、曖昧さの解消・事実と仮説の区別・トレーサビリティで測る。
 */
(function (root) {
  'use strict';
  const isNode = typeof require === 'function';
  const cond = isNode ? require('./cond.js') : root.FDE.cond;
  const util = isNode ? require('./util.js') : root.FDE.util;
  const engine = isNode ? require('./engine.js') : root.FDE.engine;

  function activeTopic(db, state, key) {
    const m = db.slots[key];
    if (!m || m.template) return false;
    // エンティティ別の項目は、そのエンティティを「扱う」と答えたときだけ対象
    if (m.pattern) {
      const ents = state.slots['DAT.things'] && Array.isArray(state.slots['DAT.things'].value) ? state.slots['DAT.things'].value : [];
      if (!ents.includes(key.split('.')[1])) return false;
    }
    const t = m.topic;
    return !t || (state.topics[t] && state.topics[t].active);
  }

  /** 未決定事項（すべて導出。手入力ではなく状態から毎回作る） */
  function openIssues(db, state) {
    const list = [];
    const push = (o) => list.push(Object.assign({ id: 'OI-' + String(list.length + 1).padStart(3, '0') }, o));
    for (const k of Object.keys(db.slots)) {
      const m = db.slots[k];
      if (!m.critical || !activeTopic(db, state, k)) continue;
      const s = state.slots[k];
      if (!s) push({ kind: '未確認', slot: k, label: m.label, blocking: m.weight >= 3, owner: m.askWho || '顧客', reason: 'まだ聞けていない' });
      else if (s.status === 'dontknow') push({ kind: 'わからない', slot: k, label: m.label, blocking: m.weight >= 3, owner: m.askWho || '顧客（担当者を確認）', reason: '回答者は「わからない」' });
      else if (s.status === 'later') push({ kind: '後で確認', slot: k, label: m.label, blocking: m.weight >= 3, owner: '顧客', reason: '回答者が「後で確認」' });
    }
    for (const c of Object.values(state.contradictions)) {
      if (c.status === 'open') push({ kind: '矛盾', slot: c.slots.join(','), label: c.label, blocking: c.severity >= 3, owner: 'FDE＋顧客', reason: '確認前' });
      else if (c.status === 'accepted') push({ kind: '条件付き', slot: c.slots.join(','), label: c.label, blocking: false, owner: 'FDE', reason: '「場合によって違う」→ 業務ルールとして条件を整理する' });
    }
    for (const f of Object.values(state.families)) {
      if (f.open) push({ kind: '仮説未検証', slot: f.id, label: f.label, blocking: false, owner: 'FDE', reason: '競合する仮説が' + f.alive + '件残っている' });
    }
    for (const k of state.reqOrder) {
      const r = state.reqs[k];
      if (r.status === 'rejected') push({ kind: '否認', slot: k, label: r.title, blocking: r.moscow === 'Must', owner: 'FDE', reason: '顧客が「ちがう」：' + (r.confirmNote || '理由未記入') });
      if (r.status === 'held') push({ kind: '保留', slot: k, label: r.title, blocking: false, owner: '顧客', reason: '確認を保留' });
    }
    for (const o of state.orphans) push({ kind: '前提変更', slot: o.iid, label: '回答 #' + o.seq + ' は使われていない', blocking: false, owner: 'FDE', reason: o.reason });
    if (state.tech && state.tech.missingInputs.length) push({ kind: '技術判断の材料不足', slot: state.tech.missingInputs.join(','), label: '技術構成を決める材料', blocking: true, owner: 'FDE', reason: state.tech.missingInputs.map((k) => engine.slotLabel(db, k)).join('、') });
    return list;
  }

  /** 人間（FDE）レビュー待ち：自動で意味を判定できない自由記述 */
  function reviewQueue(db, state) {
    const out = [];
    for (const a of state.answers) {
      if (a.kind !== 'value' || !a.det) continue;
      const reasons = [];
      if (a.det.abstract) reasons.push('抽象的');
      if (a.det.solutionOnly) reasons.push('手段だけ');
      if (a.det.needsEvidence) reasons.push('根拠なしの評価語');
      if (a.det.speculative) reasons.push('推量');
      if (a.det.correction) reasons.push('訂正の言葉');
      reasons.push('自由記述→要件への変換は人が確認');
      out.push({ seq: a.seq, iid: a.iid, raw: a.value, reasons, explain: a.explain || [], reviewed: !!(state.fdeReviewed && state.fdeReviewed[a.seq]) });
    }
    return out;
  }

  function ratio(a, b) { return b === 0 ? null : util.round(a / b, 2); }

  function metrics(db, state) {
    const crit = Object.keys(db.slots).filter((k) => db.slots[k].critical && activeTopic(db, state, k));
    const answered = crit.filter((k) => state.slots[k] && cond.KNOWN.includes(state.slots[k].status));
    const resolvedAny = crit.filter((k) => state.slots[k] && cond.RESOLVED.includes(state.slots[k].status));

    // Q2 事実と仮説の区別：自由記述のうち、本人が「事実／推測／希望」を選んだもの
    const epiTargets = state.answers.filter((a) => a.kind === 'value' && db.qIndex[a.qid] && db.qIndex[a.qid].epistemic);
    const epiDone = epiTargets.filter((a) => {
      const q = engine.resolveQuestion(db, state, a.iid);
      return q && state.slots[q.slot + '__epi'] && cond.RESOLVED.includes(state.slots[q.slot + '__epi'].status);
    });
    // Q3 競合仮説：有効な仮説群のうち、反証条件があり判別質問を一つ以上聞いたもの
    const fams = Object.values(state.families).filter((f) => f.active);
    const famTestable = fams.filter((f) => {
      const hs = Object.values(state.hyps).filter((h) => h.family === f.id);
      return hs.every((h) => h.falsifier) && hs.some((h) => h.discriminators.some((q) => state.asked[q]));
    });
    // Q4 目的と機能のつながり
    const reqs = state.reqOrder.map((k) => state.reqs[k]);
    const frs = reqs.filter((r) => r.type === 'FR');
    const frLinked = frs.filter((r) => r.parent && state.reqs[r.parent]);
    const brs = reqs.filter((r) => r.type === 'BR');
    const brWithFr = brs.filter((b) => frs.some((f) => f.parent === b.key));
    // Q5 データ・権限・例外
    const ents = reqs.filter((r) => r.type === 'ENT');
    const entClear = ents.filter((r) => {
      const p = r.key.replace(/^ENT-/, '');
      return ['count', 'id'].every((s) => state.slots['DAT.' + p + '.' + s] && cond.RESOLVED.includes(state.slots['DAT.' + p + '.' + s].status));
    });
    const dpeSlots = ['ROLE.see_scope', 'ROLE.edit_scope', 'RULE.exceptions'].filter((k) => db.slots[k]);
    const dpeDone = dpeSlots.filter((k) => state.slots[k] && cond.RESOLVED.includes(state.slots[k].status));
    // Q7 顧客確認
    const conf = Object.values(state.confirmations);
    const confirmed = conf.filter((c) => c.status === 'confirmed');
    // Q8 効率
    const asked = state.answers.length;
    const totalQ = db.questions.filter((q) => !q.generic).length;
    const dk = state.answers.filter((a) => a.kind === 'dontknow' || a.kind === 'later').length;
    const oi = openIssues(db, state);
    const unresolvedCrit = crit.filter((k) => !(state.slots[k] && cond.KNOWN.includes(state.slots[k].status)));

    return {
      Q1_ambiguityResolved: { value: ratio(answered.length, crit.length), detail: answered.length + '/' + crit.length + ' 件の重要項目に回答（わからない・後で確認を含む処理済み ' + resolvedAny.length + '）' },
      Q2_factVsHypothesis: { value: ratio(epiDone.length, epiTargets.length), detail: '自由記述 ' + epiTargets.length + ' 件中 ' + epiDone.length + ' 件を本人が「事実／推測／希望」に分類' },
      Q3_hypothesesTestable: { value: ratio(famTestable.length, fams.length), detail: '有効な仮説群 ' + fams.length + ' のうち反証条件＋判別質問あり ' + famTestable.length },
      Q4_goalToFunction: { value: ratio(frLinked.length, frs.length), detail: '機能要件 ' + frs.length + ' のうち事業要求に紐づく ' + frLinked.length + '／機能につながる事業要求 ' + brWithFr.length + '/' + brs.length },
      Q5_dataRoleException: { value: ratio(entClear.length + dpeDone.length, ents.length + dpeSlots.length), detail: 'データ ' + entClear.length + '/' + ents.length + '（件数と見分け方）・権限と例外 ' + dpeDone.length + '/' + dpeSlots.length },
      Q6_openIssuesIdentified: { value: unresolvedCrit.every((k) => oi.some((o) => o.slot === k)) ? 1 : 0, detail: '未解決の重要項目 ' + unresolvedCrit.length + ' 件すべてを未決定事項に登録（計 ' + oi.length + ' 件、うち実装を止めるもの ' + oi.filter((o) => o.blocking).length + '）' },
      Q7_customerConfirmed: { value: ratio(confirmed.length, conf.length), detail: '確認 ' + conf.length + ' 件中「合っている」' + confirmed.length + '・「ちがう」' + conf.filter((c) => c.status === 'rejected').length },
      Q8_efficiency: { value: ratio(resolvedAny.length, asked), detail: '質問 ' + asked + ' 問／DB ' + totalQ + ' 問（' + (totalQ - asked) + ' 問は規則で不要と判断して出していない）・わからない/後で ' + dk + '・経過 ' + util.round(state.elapsedSec / 60, 1) + ' 分' },
    };
  }

  /** 仕様確定の判定（R01〜R07）。推定のままの要件がある案件を「確定」と呼ばない */
  function readiness(db, state) {
    const reqs = state.reqOrder.map((k) => state.reqs[k]);
    const must = reqs.filter((r) => r.moscow === 'Must' && ['FR', 'NFR'].includes(r.type));
    const oi = openIssues(db, state);
    const checks = [
      { id: 'R01', label: 'Must の機能・非機能要件がすべて顧客確認済み', ok: must.every((r) => r.status === 'confirmed'), hard: true },
      { id: 'R02', label: '実装を止める未決定事項が0件', ok: oi.filter((o) => o.blocking).length === 0, hard: true },
      { id: 'R03', label: '事業要求が1つ以上あり、すべて顧客確認済み', ok: reqs.some((r) => r.type === 'BR') && reqs.filter((r) => r.type === 'BR').every((r) => r.status === 'confirmed'), hard: true },
      { id: 'R04', label: '扱うデータの件数と見分け方がわかっている', ok: reqs.filter((r) => r.type === 'ENT').every((r) => { const p = r.key.replace(/^ENT-/, ''); return state.slots['DAT.' + p + '.count'] && state.slots['DAT.' + p + '.id']; }), hard: false },
      { id: 'R05', label: '技術判断の必須材料がそろっている', ok: state.tech && state.tech.missingInputs.length === 0, hard: false },
      { id: 'R06', label: '個人情報があれば、利用目的・保存期間・閲覧者・外部送信可否が確認済み', ok: !(state.slots['DAT.pii'] && Array.isArray(state.slots['DAT.pii'].value) && state.slots['DAT.pii'].value.some((x) => x !== 'なし')) || ['DAT.retention', 'ROLE.see_scope', 'NFR.external_send'].every((k) => state.slots[k] && cond.KNOWN.includes(state.slots[k].status)), hard: true },
      { id: 'R07', label: '構造化項目どうしの矛盾が未確認のまま残っていない', ok: Object.values(state.contradictions).every((c) => c.status !== 'open'), hard: false },
      { id: 'R08', label: '有効な論点の重要項目に、未確認・わからない・後で確認が残っていない', ok: oi.filter((o) => ['未確認', 'わからない', '後で確認'].includes(o.kind)).length === 0, hard: false },
      { id: 'R09', label: '人間レビュー待ちの自由記述を FDE がすべて確認した', ok: reviewQueue(db, state).every((r) => state.fdeReviewed && state.fdeReviewed[r.seq]), hard: false, manual: true },
    ];
    const hardFail = checks.some((c) => c.hard && !c.ok);
    const softFail = checks.some((c) => !c.hard && !c.ok);
    return { verdict: hardFail ? '未確定' : softFail ? '条件付き' : '仕様確定', checks };
  }

  const api = { activeTopic, openIssues, reviewQueue, metrics, readiness };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.quality = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
