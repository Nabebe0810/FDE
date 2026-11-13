/* node --test tests/  — 外部パッケージ不要 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDb, validate } = require('../tools/build.js');
const E = require('../src/engine/engine.js');
const S = require('../src/engine/select.js');
const Q = require('../src/engine/quality.js');
const D = require('../src/engine/detect.js');
const R = require('../src/engine/report.js');
const sim = require('../tools/simulate.js');

const fresh = () => E.indexDb(loadDb());
function start(db, role) { const s = E.createSession(db, { id: 't', role: role || '経営者', createdAt: '2026-11-13T00:00:00Z' }); return { s, st: E.replay(db, s) }; }
function ans(db, s, iid, value, kind) { return E.answer(db, s, iid, { kind: kind || 'value', value, ms: 10000 }); }

test('質問DB・ルールの検査にエラーがない（一問一論点・専門用語・値の整合・決まること）', () => {
  const { errs } = validate(loadDb());
  assert.deepEqual(errs, []);
});

test('決定論：同じ回答ログ＋同じルール版なら、同じ質問列・同じ要件になる', () => {
  const a = sim.run('sales_crm'), b = sim.run('sales_crm');
  assert.deepEqual(a.trail.map((t) => t.iid), b.trail.map((t) => t.iid));
  assert.deepEqual(a.state.reqOrder, b.state.reqOrder);
  const again = E.replay(a.db, JSON.parse(JSON.stringify(a.session)));
  assert.deepEqual(again.reqOrder, a.state.reqOrder);
});

test('受付は固定順で始まり、最初の質問は相談の原文', () => {
  const db = fresh(); const { st } = start(db);
  assert.equal(S.next(db, st).iid, 'Q-INT-001');
});

test('手段だけの相談 → 元の困りごとを聞く深掘りが予約され、原文は手段として保存される', () => {
  const db = fresh(); const { s } = start(db);
  const st = ans(db, s, 'Q-INT-001', 'LINEで予約できるアプリを作りたい');
  assert.ok(st.queue.some((x) => x.iid === 'G-PROBLEM@PRJ.request_raw'));
  assert.equal(st.slots['BR.means'].value, 'LINEで予約できるアプリを作りたい');
  assert.equal(st.slots['PRJ.request_raw'].value, 'LINEで予約できるアプリを作りたい', '原文は書き換えない');
});

test('抽象的な回答 → 直近の一件を聞く（具体要求型）、二手目も抽象的なら時点に狭め、三手目はしない', () => {
  const db = fresh(); const { s } = start(db);
  let st = ans(db, s, 'Q-INT-001', '業務を効率化したい');
  assert.ok(st.queue.some((x) => x.iid === 'G-CONCRETE@PRJ.request_raw'));
  st = ans(db, s, 'G-CONCRETE@PRJ.request_raw', 'いろいろ');
  assert.ok(st.queue.some((x) => x.iid === 'G-TIME@PRJ.request_raw'));
  st = ans(db, s, 'G-TIME@PRJ.request_raw', '最近');
  assert.ok(!st.queue.some((x) => x.iid.startsWith('G-') && x.iid.endsWith('@PRJ.request_raw') && !st.asked[x.iid] && x.depth > 2));
});

test('根拠のない評価語 → 根拠の種類を聞く', () => {
  const db = fresh(); const { s } = start(db);
  const st = ans(db, s, 'Q-INT-006', '問い合わせがすごく多くて大変です');
  assert.ok(st.queue.some((x) => x.iid === 'G-EVIDENCE@BR.problem'));
});

test('形式判定は意味を推定しない（手がかりだけ）', () => {
  const lex = fresh().rules.lexicon;
  const a = D.analyzeText('先週、申込が3件漏れた', lex, {});
  assert.equal(a.det.abstract, false); assert.equal(a.det.factLike, true);
  const b = D.analyzeText('たぶん効率化できると思う', lex, {});
  assert.equal(b.det.speculative, true); assert.equal(b.det.abstract, true);
});

test('構造化項目の矛盾 → 対置型の確認が最優先（Tier 0）で出る', () => {
  const db = fresh(); const { s } = start(db);
  ans(db, s, 'Q-ROL-004', 'URLを開くだけで使いたい');
  const st = ans(db, s, 'Q-ROL-002', '自分の分だけ');
  assert.equal(st.contradictions['C-02'].status, 'open');
  const n = S.next(db, st);
  assert.equal(n.iid, 'C@C-02'); assert.equal(n.tier, 0);
  const st2 = ans(db, s, 'C@C-02', 'login');
  assert.equal(st2.slots['ROLE.login'].value, '必要');
  assert.ok(!st2.contradictions['C-02'], '解消すると矛盾は消える');
});

test('回答者間の食い違いを残し、対置型で確かめる', () => {
  const db = fresh(); const { s } = start(db, '経営者');
  ans(db, s, 'Q-NFR-001', '11〜100人');
  E.switchRespondent(db, s, { id: 'R2', name: '現場', role: '現場' });
  const st = ans(db, s, 'Q-NFR-001', '101〜1000人');
  assert.ok(st.contradictions['C-RESP@NFR.users_total']);
});

test('分岐フラグ：成果の測り方が不明 → 測り方の質問が必須になる', () => {
  const db = fresh(); const { s } = start(db);
  const st = ans(db, s, 'Q-KPI-001', '時間を減らす');
  assert.ok(st.flags.kpi_unknown);
  const c = S.candidates(db, st).find((x) => x.qid === 'Q-KPI-002');
  assert.ok(c && c.tier === 2);
});

test('前の回答の訂正：後続の分岐が作り直され、訂正前の値は訂正ログに残る', () => {
  const db = fresh(); const { s } = start(db);
  ans(db, s, 'Q-INT-003', '一般の個人');
  let st = ans(db, s, 'Q-TOC-004', '必要');
  assert.ok(st.reqs['FR-RESUME']);
  const target = s.log.find((e) => e.iid === 'Q-INT-003').seq;
  st = E.edit(db, s, target, { kind: 'value', value: '社内', ms: 1000 });
  assert.equal(st.topics.toc.active, false);
  assert.ok(!st.reqs['FR-RESUME'], '前提が変わった回答は要件に使わない');
  assert.ok(st.orphans.some((o) => o.iid === 'Q-TOC-004'));
  assert.ok(st.corrections.some((c) => c.kind === 'edit' && c.before === '一般の個人'));
});

test('推定した要件は「未確認」で作られ、顧客確認でしか確定しない。否定すると外れた部分を聞く', () => {
  const db = fresh(); const { s } = start(db);
  let st = ans(db, s, 'Q-ROL-004', '必要');
  assert.equal(st.reqs['FR-LOGIN'].status, 'unconfirmed');
  st = ans(db, s, 'CONFIRM@FR-LOGIN', false);
  assert.equal(st.reqs['FR-LOGIN'].status, 'rejected');
  assert.ok(st.queue.some((x) => x.iid === 'G-NEG@FR-LOGIN'));
  assert.ok(Q.openIssues(db, st).some((o) => o.kind === '否認'));
});

test('「わからない」は無理に答えさせず、未決定事項と確認担当の質問にする', () => {
  const db = fresh(); const { s } = start(db);
  const st = ans(db, s, 'Q-NFR-001', null, 'dontknow');
  assert.ok(st.queue.some((x) => x.iid === 'G-WHOKNOWS@NFR.users_total'));
  assert.ok(Q.openIssues(db, st).some((o) => o.slot === 'NFR.users_total' && o.kind === 'わからない'));
});

test('前提の混入防止：前提の項目が未回答なら、その質問は出ない', () => {
  const db = fresh(); const { st } = start(db);
  const withPre = db.questions.filter((q) => q.presupposes && q.presupposes.length);
  assert.ok(withPre.length > 0);
  const ids = S.candidates(db, st).map((c) => c.qid);
  for (const q of withPre) assert.ok(!ids.includes(q.id), q.id + ' が前提なしで候補に入った');
});

test('技術選定：費用0円・保守者なし → サーバー型（G）を除外し、理由を残す', () => {
  const db = fresh(); const { s } = start(db);
  ans(db, s, 'Q-CON-001', '0円');
  const st = ans(db, s, 'Q-CON-005', '社内にいない（外部に頼む）');
  const g = st.tech.ranked.find((a) => a.id === 'G');
  assert.equal(g.status, 'excluded'); assert.ok(g.reasons.length >= 1);
});

test('時間の上限を超えたら顧客確認へ移る', () => {
  const db = fresh(); db.params.time.hardMaxMin = 1; const { s } = start(db);
  ans(db, s, 'Q-INT-001', '先週、申込3件の転記で1件まちがえた');
  const st = E.answer(db, s, 'Q-INT-002', { kind: 'value', value: '新規', ms: 2 * 60 * 1000 });
  const n = S.next(db, st);
  assert.ok(n.stage === 'confirm' || n.stage === 'done');
});

test('全シナリオ：推定45分以内、DBの7割未満の質問数で終わる（全質問を毎回出さない）', () => {
  for (const name of Object.keys(sim.SCENARIOS)) {
    const { result } = sim.run(name);
    assert.ok(result.minutes <= 45, name + ' ' + result.minutes + '分');
    assert.ok(result.questions < result.dbTotal * 0.7, name + ' ' + result.questions + '問');
  }
});

test('要件定義書：訂正した点・未確認の区別・未決定事項・技術候補・品質を含む', () => {
  const { db, state, session } = sim.run('sales_crm');
  const md = R.markdown(db, state, session);
  for (const h of ['## 1. お客様が訂正・否定した点', '未確認（推定）', '## 11. 技術構成の候補', '## 12. 未決定事項', '## 16. ヒアリング品質']) assert.ok(md.includes(h), h);
  const sh = R.sheets(db, state, session);
  assert.ok(sh.requirements.split('\n').length > 10);
});
