#!/usr/bin/env node
/*
 * analyze-logs.js — 書き出した回答ファイル（*_回答.json）を集計し、質問ごとの実測を出す。
 *   node tools/analyze-logs.js <フォルダまたはファイル...> [--tsv]
 * 出すもの：回答数、所要秒の中央値と推定値（costSec）の差、「わからない／後で／該当しない」の率、
 *          訂正された率、深掘りを呼んだ率。→ costSec・重み・質問文の見直しに使う。
 * 個人の回答内容は出力しない（質問IDごとの数だけ）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadDb } = require('./build.js');
const E = require('../src/engine/engine.js');
const S = require('../src/engine/select.js');

const files = [];
for (const a of process.argv.slice(2).filter((x) => !x.startsWith('--'))) {
  const st = fs.statSync(a);
  if (st.isDirectory()) fs.readdirSync(a).filter((f) => f.endsWith('.json')).forEach((f) => files.push(path.join(a, f)));
  else files.push(a);
}
if (!files.length) { console.error('使い方: node tools/analyze-logs.js <回答ファイルのフォルダ>'); process.exit(1); }
const db = E.indexDb(loadDb());
const by = {};
const sessions = [];
for (const f of files) {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (s.format !== 'fde-hearing-session/1') continue;
  const st = E.replay(db, s);
  const edited = new Set(s.log.filter((e) => e.type === 'edit').map((e) => e.iid));
  sessions.push({ id: s.meta.id, n: st.answers.length, min: Math.round(st.elapsedSec / 60), rule: s.meta.ruleVersion });
  for (const a of st.answers) {
    const qid = a.qid === 'C' || a.qid === 'CONFIRM' ? a.qid : a.iid.split('@')[0];
    const o = by[qid] = by[qid] || { qid, n: 0, secs: [], special: 0, edited: 0, deep: 0 };
    o.n++; o.secs.push(a.ms / 1000);
    if (a.kind !== 'value') o.special++;
    if (edited.has(a.iid)) o.edited++;
  }
  // 深掘りを呼んだ：次の回答が汎用深掘り・EPI でその回答のスロットを対象にしている
  for (let i = 0; i < st.answers.length - 1; i++) {
    const a = st.answers[i], b = st.answers[i + 1];
    if (/^(G-|EPI)/.test(b.iid) && by[a.iid.split('@')[0]]) by[a.iid.split('@')[0]].deep++;
  }
}
const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
const rows = Object.values(by).map((o) => {
  const q = db.qIndex[o.qid];
  const est = q ? S.costOf(q) : null;
  const m = Math.round(med(o.secs));
  return { 質問: o.qid, 回答数: o.n, 中央秒: m, 推定秒: est, 差: est ? m - est : '', 特殊回答率: Math.round(o.special / o.n * 100) + '%', 訂正率: Math.round(o.edited / o.n * 100) + '%', 深掘り率: Math.round(o.deep / o.n * 100) + '%', 見直し: est && m > est * 1.5 ? '推定より遅い→文面か形式を見直す' : o.special / o.n > 0.4 ? 'わからない が多い→対象者か聞き方を見直す' : '' };
}).sort((a, b) => b.回答数 - a.回答数);
if (process.argv.includes('--tsv')) {
  const head = Object.keys(rows[0] || {});
  console.log([head.join('\t')].concat(rows.map((r) => head.map((h) => r[h]).join('\t'))).join('\n'));
} else {
  console.log('セッション ' + sessions.length + ' 件：' + sessions.map((s) => s.id + '（' + s.n + '問・' + s.min + '分・' + s.rule + '）').join('、'));
  console.table(rows);
}
