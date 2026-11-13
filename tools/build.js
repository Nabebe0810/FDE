#!/usr/bin/env node
/*
 * build.js — data/ の JSON を1つの DB にまとめ、検査し、ブラウザ用の src/generated/db.js を書き出す。
 *   node tools/build.js            … 検査＋書き出し
 *   node tools/build.js --check    … 検査だけ（エラーがあれば終了コード1）
 * 外部パッケージ不要（Node 18+）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const JARGON = ['要件', '仕様', 'KPI', 'ROI', 'API', 'DB', 'データベース', 'エンティティ', '属性', '権限', '認証', '非機能', 'ワークフロー', 'ステータス', 'マスタ', 'UI', 'UX', 'MVP', 'スコープ', 'ステークホルダー', 'トランザクション', 'バッチ', 'インテグレーション'];
const PARALLEL = ['また、', 'および', 'ならびに', 'それと', 'あと、'];
const TYPES = ['yesno', 'single', 'select', 'slider', 'scale', 'multi', 'cards', 'points', 'rank', 'matrix', 'number', 'month', 'text', 'longtext', 'steps'];

function loadDb() {
  const rawSlots = read('data/slots.json');
  const values = read('data/values.json');
  const entities = read('data/rules/entities.json');
  const slots = {};
  const vals = {};
  for (const k of Object.keys(rawSlots)) {
    if (k.startsWith('_')) continue;
    if (k.includes('{e}')) {
      for (const e of Object.keys(entities.types)) {
        const key = k.replace('{e}', e);
        slots[key] = Object.assign({}, rawSlots[k], { label: rawSlots[k].label.replace('{e}', entities.types[e].label), pattern: k });
        if (values[k]) vals[key] = values[k];
      }
      slots[k] = Object.assign({}, rawSlots[k], { pattern: k, template: true, critical: false });
      if (values[k]) vals[k] = values[k];
    } else {
      slots[k] = rawSlots[k];
      if (values[k]) vals[k] = values[k];
    }
  }
  const qdir = path.join(ROOT, 'data/questions');
  const questions = [];
  for (const f of fs.readdirSync(qdir).filter((x) => x.endsWith('.json')).sort()) {
    for (const q of read('data/questions/' + f)) questions.push(Object.assign({ _file: f }, q));
  }
  const rules = {
    lexicon: read('data/rules/lexicon.json'),
    topics: read('data/rules/topics.json'),
    entities,
    hypotheses: read('data/rules/hypotheses.json'),
    contradictions: read('data/rules/contradictions.json'),
    branches: read('data/rules/branches.json'),
    deepdive: read('data/rules/deepdive.json'),
    mappings: read('data/rules/mappings.json'),
    tech: read('data/rules/tech.json'),
  };
  const params = read('data/params.json');
  const sources = read('data/sources.json');
  return { version: params.ruleVersion + '+' + questions.length + 'q', params, slots, values: vals, questions, rules, sources };
}

/** 条件式の中のスロット参照を検査 */
function checkCond(c, where, errs, db) {
  if (c == null || typeof c !== 'object') return;
  if (Array.isArray(c)) return c.forEach((x) => checkCond(x, where, errs, db));
  if (c.slot) {
    const base = c.slot.replace('{param}', 'customer').replace(/__\w+$/, '');
    const known = db.slots[base] || db.slots[c.slot] || c.slot.includes('{param}') || /__\w+$/.test(c.slot);
    if (!known) errs.push(where + ': 未定義のスロット ' + c.slot);
    const vals = db.values[c.slot] || db.values[base];
    const check = (v) => { if (vals && typeof v === 'string' && v !== '$param' && !vals.includes(v)) errs.push(where + ': ' + c.slot + ' に無い値 "' + v + '"'); };
    ['eq', 'has'].forEach((k) => k in c && check(c[k]));
    ['in', 'hasAny'].forEach((k) => k in c && [].concat(c[k]).forEach(check));
  }
  if (c.topic && !db.rules.topics.find((t) => t.id === c.topic)) errs.push(where + ': 未定義の論点 ' + c.topic);
  ['all', 'any'].forEach((k) => c[k] && c[k].forEach((x) => checkCond(x, where, errs, db)));
  if (c.not) checkCond(c.not, where, errs, db);
}

function validate(db) {
  const errs = [];
  const warns = [];
  const ids = {};
  const phases = db.params.phaseOrder;
  const topics = db.rules.topics.map((t) => t.id);
  for (const q of db.questions) {
    const w = q._file + ' ' + q.id;
    if (ids[q.id]) errs.push(w + ': ID重複');
    ids[q.id] = true;
    if (!phases.includes(q.phase)) errs.push(w + ': phase が不正 ' + q.phase);
    if (!topics.includes(q.topic)) errs.push(w + ': topic が不正 ' + q.topic);
    if (!q.text) errs.push(w + ': text がない');
    if (!q.intent) errs.push(w + ': intent がない');
    if (!Array.isArray(q.decides) || !q.decides.length) errs.push(w + ': decides（回答で決まること）が空');
    if (!q.input || !TYPES.includes(q.input.type)) errs.push(w + ': input.type が不正');
    if (!q.sources || !q.sources.length) errs.push(w + ': sources がない');
    if (!q.generic) {
      if (!q.slot) errs.push(w + ': slot がない');
      else {
        const base = q.slot.replace('{param}', 'customer');
        if (!db.slots[base]) errs.push(w + ': 未定義のスロット ' + q.slot);
      }
      if (q.slot && q.slot.includes('{param}') && !q.forEach) errs.push(w + ': {param} を使うなら forEach が必要');
      if (!q.importance) errs.push(w + ': importance がない');
      if (!q.outputs || !q.outputs.length) errs.push(w + ': outputs がない');
    }
    // 文面の検査（一問一論点・専門用語・長さ）
    const t = q.text || '';
    const qm = (t.match(/[？?]/g) || []).length;
    if (qm !== 1 && !/(ください|選んでください|教えてください)。?$/.test(t)) errs.push(w + ': 疑問符は1つ（または「〜ください。」）にする');
    if (qm > 1) errs.push(w + ': 疑問符が2つ以上（一問一論点）');
    for (const j of JARGON) if (t.includes(j)) errs.push(w + ': 専門用語「' + j + '」');
    for (const p of PARALLEL) if (t.includes(p)) errs.push(w + ': 論点の並列「' + p + '」');
    if (t.replace(/\{\{[^}]+\}\}/g, '○○').length > 70) warns.push(w + ': 質問文が70字超（' + t.length + '）');
    // 選択肢の値
    const slotVals = q.slot ? (db.values[q.slot] || db.values[q.slot.replace('{param}', 'customer')]) : null;
    if (q.input && q.input.options) {
      for (const o of q.input.options) {
        if (slotVals && !slotVals.includes(o.v)) errs.push(w + ': 選択肢 "' + o.v + '" は values.json の ' + q.slot + ' に無い');
        if (o.set) for (const k of Object.keys(o.set)) if (!db.slots[k]) errs.push(w + ': set 先のスロット ' + k + ' が未定義');
      }
      if (['single', 'select', 'slider', 'scale'].includes(q.input.type) && q.input.options.length < 2) errs.push(w + ': 選択肢が2つ未満');
      if (q.input.type === 'single' && q.input.options.length > 7) warns.push(w + ': 選択肢が8つ以上 → select を推奨');
    } else if (q.input && ['single', 'select', 'slider', 'scale', 'multi', 'points', 'rank'].includes(q.input.type) && !q.input.optionsFrom) {
      errs.push(w + ': options がない');
    }
    if (q.input && q.input.type === 'matrix' && (!q.input.rowsFrom || !q.input.columns)) errs.push(w + ': matrix には rowsFrom と columns が必要');
    checkCond(q.trigger, w + ' trigger', errs, db);
    checkCond(q.skipIf, w + ' skipIf', errs, db);
    if (q.mandatory && typeof q.mandatory === 'object') checkCond(q.mandatory, w + ' mandatory', errs, db);
    for (const p of q.presupposes || []) if (!db.slots[p]) errs.push(w + ': presupposes のスロット ' + p + ' が未定義');
  }
  for (const q of db.questions) {
    for (const f of q.followups || []) {
      const target = f.ask.split('@')[0];
      if (!ids[target]) errs.push(q.id + ': followups の行き先 ' + f.ask + ' が無い');
      checkCond(f.when, q.id + ' followup', errs, db);
    }
    for (const o of (q.input && q.input.options) || []) if (o.ask && !ids[o.ask.split('@')[0]]) errs.push(q.id + ': 選択肢の ask 先 ' + o.ask + ' が無い');
  }
  for (const h of db.rules.hypotheses) {
    checkCond(h.activateWhen, h.id, errs, db);
    for (const x of h.hyps) {
      checkCond(x.supportWhen, x.id, errs, db); checkCond(x.refuteWhen, x.id, errs, db);
      if (!x.falsifier) errs.push(x.id + ': 反証条件がない');
      for (const d of x.discriminators || []) if (!ids[d]) errs.push(x.id + ': 判別質問 ' + d + ' が無い');
    }
  }
  for (const r of db.rules.contradictions) { checkCond(r.when, r.id, errs, db); r.options.forEach((o) => o.set && Object.keys(o.set).forEach((k) => { if (!db.slots[k]) errs.push(r.id + ': set 先 ' + k + ' 未定義'); })); }
  for (const r of db.rules.branches) checkCond(r.when, r.id, errs, db);
  for (const t of db.rules.topics) { checkCond(t.activateWhen, 'topic ' + t.id, errs, db); }
  for (const m of db.rules.mappings) {
    checkCond(m.when, m.id, errs, db);
    if (!m.emit || !m.emit.length) errs.push(m.id + ': emit がない');
    for (const e of m.emit || []) if (!e.type || !e.key || !e.title) errs.push(m.id + ': emit に type/key/title が必要');
  }
  for (const k of db.rules.tech.knockouts) checkCond(k.when, k.id, errs, db);
  for (const k of db.rules.tech.requiredInputs) if (!db.slots[k]) errs.push('tech.requiredInputs: ' + k + ' が未定義');
  // 重要スロットに質問があるか（聞く手段のない項目は未決定事項から消えない）
  const asked = new Set(db.questions.filter((q) => q.slot).map((q) => q.slot.replace('{param}', '{e}')));
  for (const k of Object.keys(db.slots)) {
    const s = db.slots[k];
    if (s.critical && !s.pattern && !asked.has(k) && !k.startsWith('ISS.')) warns.push('重要スロット ' + k + ' を聞く質問がない');
  }
  return { errs, warns };
}

function main() {
  const db = loadDb();
  const { errs, warns } = validate(db);
  warns.forEach((w) => console.warn('注意: ' + w));
  errs.forEach((e) => console.error('エラー: ' + e));
  const n = db.questions.length;
  console.log(`質問 ${n} 問（汎用 ${db.questions.filter((q) => q.generic).length}）／スロット ${Object.keys(db.slots).length}／要件変換 ${db.rules.mappings.length}／矛盾 ${db.rules.contradictions.length}／分岐 ${db.rules.branches.length}／エラー ${errs.length}・注意 ${warns.length}`);
  if (errs.length) process.exit(1);
  if (process.argv.includes('--check')) return;
  for (const q of db.questions) delete q._file;
  const out = '/* 自動生成（tools/build.js）。直接編集しない。 */\n(function (root) { root.FDE = root.FDE || {}; root.FDE.DB = ' + JSON.stringify(db) + '; })(typeof globalThis !== "undefined" ? globalThis : this);\n';
  fs.mkdirSync(path.join(ROOT, 'src/generated'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src/generated/db.js'), out);
  console.log('書き出し: src/generated/db.js (' + Math.round(out.length / 1024) + 'KB)');
}

if (require.main === module) main();
module.exports = { loadDb, validate };
