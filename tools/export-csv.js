#!/usr/bin/env node
/* export-csv.js — 質問DBを CSV（UTF-8 BOM付き）に書き出す。スプレッドシートでのレビュー・修正用。
 * 正本は data/questions/*.json。スプレッドシートで直した内容は JSON に戻してから build/test を通す。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadDb } = require('./build.js');
const db = loadDb();
const cols = ['id', 'phase', 'step', 'topic', 'persona', 'text', 'help', 'intent', 'decides', 'technique', 'slot', 'input.type', 'options', 'trigger', 'skipIf', 'presupposes', 'mandatory', 'importance', 'costSec', 'followups', 'deepdive', 'epistemic', 'patterns', 'hypothesis', 'falsifier', 'outputs', 'sources'];
const cell = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const get = (q, c) => c === 'input.type' ? q.input.type : c === 'options' ? (q.input.options || []).map((o) => o.v + '=' + o.label).join(' / ') || q.input.optionsFrom || '' : Array.isArray(q[c]) && c !== 'followups' ? q[c].join(' / ') : q[c];
const out = '﻿' + [cols.join(',')].concat(db.questions.map((q) => cols.map((c) => cell(get(q, c))).join(','))).join('\n');
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'questions.csv'), out);
console.log('書き出し: dist/questions.csv（' + db.questions.length + ' 問）');
