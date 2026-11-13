#!/usr/bin/env node
/*
 * simulate.js — 仮想の回答者でヒアリングを最後まで自動実行し、質問数・推定時間・深掘り・判定を測る。
 *   node tools/simulate.js            … 全シナリオの要約
 *   node tools/simulate.js <名前> -v  … 1シナリオの質問の流れを表示
 *   node tools/simulate.js <名前> --md … 要件定義書を表示
 * 回答時間は各質問の costSec（推定値）で数える。実測は書き出した回答ファイルを tools/analyze-logs.js で集計する。
 */
'use strict';
const path = require('path');
const { loadDb } = require('./build.js');
const E = require('../src/engine/engine.js');
const S = require('../src/engine/select.js');
const Q = require('../src/engine/quality.js');
const R = require('../src/engine/report.js');

const SCENARIOS = require('./scenarios.js');

function pickValue(q, scen, state, db) {
  const t = q.input.type;
  const key = q.slot && q.slot.replace(/__\w+$/, '');
  const ans = scen.answers;
  // シナリオに書かれた回答（スロット名 or 汎用質問ID@スロット）
  const byIid = ans[q.iid];
  if (byIid !== undefined) return byIid;
  if (q.slot && ans[q.slot] !== undefined) return ans[q.slot];
  if (q.type === 'confirm') return scen.reject && scen.reject.includes(q.reqKey) ? { kind: 'value', value: false, note: '対象が違う' } : { kind: 'value', value: true };
  if (q.type === 'contrast') return { kind: 'value', value: 'both' };
  if (scen.policy === 'dontknow' && (q.importance || 3) <= 4 && !q.generic) return { kind: 'dontknow' };
  const opts = q.input.options || [];
  switch (t) {
    case 'yesno': return true;
    case 'single': case 'select': return opts.length ? opts[0].v : 'x';
    case 'slider': case 'scale': return opts[Math.floor((opts.length - 1) / 2)].v;
    case 'multi': return opts.slice(0, 2).map((o) => o.v);
    case 'cards': return { yes: opts.slice(0, 2).map((o) => o.v), no: opts.slice(2).map((o) => o.v), unknown: [] };
    case 'points': return opts.length ? { [opts[0].v]: 6, [opts[1] ? opts[1].v : opts[0].v]: 4 } : {};
    case 'rank': return opts.slice(0, 3).map((o) => o.v);
    case 'matrix': { const rows = require('../src/engine/derive.js').slotVal(state, q.input.rowsFrom) || []; return Object.fromEntries(rows.map((r, i) => [r, q.input.columns[i % q.input.columns.length].v])); }
    case 'number': return 10;
    case 'month': return '2027-04';
    case 'steps': return ['受付', '確認', '登録', '連絡'];
    case 'text': case 'longtext': return scen.policy === 'abstract' ? 'いろいろ効率化したい' : '先週、担当のAさんが申込3件を手で転記して1件まちがえた';
    default: return null;
  }
  void key; void db;
}

function run(name, opts) {
  opts = opts || {};
  const scen = SCENARIOS[name];
  const db = E.indexDb(loadDb());
  db.params.time.targetMin = scen.budgetMin || db.params.time.targetMin;
  const session = E.createSession(db, { id: 'sim-' + name, title: scen.title, role: scen.role, createdAt: '2026-11-13T00:00:00Z' });
  let state = E.replay(db, session);
  const trail = [];
  for (let i = 0; i < 400; i++) {
    const n = S.next(db, state);
    if (n.stage === 'done') break;
    const q = E.resolveQuestion(db, state, n.iid);
    let v = pickValue(q, scen, state, db);
    const payload = v && typeof v === 'object' && v.kind ? v : { kind: 'value', value: v };
    payload.ms = (q.costSec || S.costOf(q)) * 1000;
    trail.push({ iid: n.iid, tier: n.tier, text: q.text, type: q.input.type, sec: payload.ms / 1000, ans: payload.kind === 'value' ? payload.value : payload.kind });
    state = E.answer(db, session, n.iid, payload);
    if (scen.after && scen.after[n.iid]) { state = scen.after[n.iid](db, session, state) || state; }
  }
  const qn = trail.filter((t) => !t.iid.startsWith('CONFIRM@')).length;
  const cn = trail.length - qn;
  const deep = trail.filter((t) => t.tier === 1).length;
  const sec = trail.reduce((a, t) => a + t.sec, 0);
  const rd = Q.readiness(db, state);
  const result = {
    name, title: scen.title, questions: qn, confirms: cn, deepdives: deep, contradictionsAsked: trail.filter((t) => t.tier === 0).length,
    minutes: Math.round(sec / 60 * 10) / 10, requirements: state.reqOrder.length, openIssues: Q.openIssues(db, state).length,
    verdict: rd.verdict, tech: state.tech.ranked.slice(0, 3).map((a) => a.id + ':' + a.status + ':' + a.score).join(' '),
    dbTotal: db.questions.filter((q) => !q.generic).length,
  };
  if (opts.verbose) trail.forEach((t, i) => console.log(String(i + 1).padStart(3), 'T' + t.tier, t.iid.padEnd(28), t.type.padEnd(8), String(t.sec).padStart(4) + 's', t.text.slice(0, 50), '→', JSON.stringify(t.ans).slice(0, 60)));
  if (opts.md) console.log(R.markdown(db, state, session));
  return { result, state, session, db, trail };
}

if (require.main === module) {
  const name = process.argv[2];
  if (name && SCENARIOS[name]) {
    const { result } = run(name, { verbose: process.argv.includes('-v'), md: process.argv.includes('--md') });
    if (!process.argv.includes('--md')) console.log(result);
  } else {
    const rows = Object.keys(SCENARIOS).map((n) => run(n).result);
    console.table(rows.map((r) => ({ シナリオ: r.name, 質問: r.questions, 確認: r.confirms, 深掘り: r.deepdives, 矛盾確認: r.contradictionsAsked, 推定分: r.minutes, 要件: r.requirements, 未決定: r.openIssues, 判定: r.verdict, 技術上位: r.tech })));
    console.log('DBの質問数（汎用を除く）：' + rows[0].dbTotal + '。1回で出すのはその一部。');
  }
}
module.exports = { run, SCENARIOS };
void path;
