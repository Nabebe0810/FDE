/*
 * report.js — 出力（要件定義書 Markdown／スプレッドシート貼り付け用 TSV）
 * 推定と確認済みを必ず分けて書く。お客様が訂正した点を先頭に置く（訂正は重要な情報）。
 */
(function (root) {
  'use strict';
  const isNode = typeof require === 'function';
  const engine = isNode ? require('./engine.js') : root.FDE.engine;
  const quality = isNode ? require('./quality.js') : root.FDE.quality;
  const derive = isNode ? require('./derive.js') : root.FDE.derive;

  const STATUS = { unconfirmed: '未確認（推定）', confirmed: '確認済み', rejected: 'ちがう（否認）', held: '保留', na: '該当しない' };
  const ORIGIN = { customer: 'お客様の回答', rule: 'ルールによる推定' };
  const EPI = { fact: '事実（見た・数えた）', heard: '伝聞', guess: '推測', wish: '希望', mixed: '混在' };
  const TYPE = { VIS: '事業の思い', BR: '事業要求', SR: '関係者要求', FR: '機能要件', NFR: '非機能要件', BP: '業務プロセス', RULE: '業務ルール', ENT: 'データ（まとまり）', ATTR: 'データ（項目）', REL: 'データ（関係）', STATE: '状態', ROLE: '立場', PERM: '見える範囲・できること', INT: '外部連携', CON: '制約', MIG: '移行', AC: '受け入れ条件', ADR: '技術・方針の決定', CR: '変更要求' };

  function fmt(v) {
    if (v == null) return '';
    if (v === true) return 'はい';
    if (v === false) return 'いいえ';
    if (Array.isArray(v)) return v.join('、');
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => k + ':' + (Array.isArray(x) ? x.join('/') : x)).join('、');
    return String(v);
  }
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '｜').replace(/\n/g, ' ');

  function answerText(db, state, a) {
    const t = answerText0(db, state, a);
    return a.note ? t + '（' + a.note + '）' : t;
  }
  function answerText0(db, state, a) {
    if (a.kind !== 'value') return '［' + engine.SPECIAL[a.kind] + '］';
    const q = engine.resolveQuestion(db, state, a.iid);
    if (q && q.input && q.input.options && !Array.isArray(a.value) && typeof a.value !== 'object') {
      const o = q.input.options.find((x) => x.v === a.value);
      if (o) return o.label;
    }
    if (q && q.input && q.input.type === 'yesno') return a.value ? (q.input.yes || 'はい') : (q.input.no || 'いいえ');
    if (a.value && typeof a.value === 'object' && !Array.isArray(a.value) && 'yes' in a.value) {
      const lab = (v) => { const o = q && q.input && q.input.options && q.input.options.find((x) => x.v === v); return o ? o.label : v; };
      return '当てはまる：' + (a.value.yes || []).map(lab).join('、') + '／ちがう：' + (a.value.no || []).map(lab).join('、') + '／わからない：' + (a.value.unknown || []).map(lab).join('、');
    }
    return fmt(a.value);
  }

  function epistemicOf(state, slot) {
    const e = state.slots[slot + '__epi'];
    return e && e.value ? EPI[e.value] || e.value : '';
  }

  function markdown(db, state, session) {
    const L = [];
    const meta = session.meta;
    const rd = quality.readiness(db, state);
    const mt = quality.metrics(db, state);
    const oi = quality.openIssues(db, state);
    const rv = quality.reviewQueue(db, state);
    const reqs = state.reqOrder.map((k) => state.reqs[k]);
    const byType = (t) => reqs.filter((r) => r.type === t);

    L.push('# 要件定義書（ヒアリング結果）— ' + (meta.title || meta.id));
    L.push('');
    L.push('| 項目 | 内容 |', '|---|---|');
    L.push('| 案件ID | ' + meta.id + ' |');
    L.push('| 回答者 | ' + meta.respondents.map((r) => r.name + '（' + r.role + '）').join('、') + ' |');
    L.push('| 作成 | ' + meta.createdAt + ' |');
    L.push('| 質問DB・ルール版 | ' + db.version + '（ルール ' + db.params.ruleVersion + '）|');
    L.push('| 判定 | **' + rd.verdict + '**（「未確定」「条件付き」は開発仕様として扱わない）|');
    L.push('| 回答数・経過 | ' + state.answers.length + ' 問・' + Math.round(state.elapsedSec / 60) + ' 分 |');
    L.push('');
    L.push('> この文書はルールで自動生成しています。「未確認（推定）」はお客様の合意前の仮の内容です。自由記述の意味はツールでは判定していません（§14 人間レビュー）。');
    L.push('');

    L.push('## 1. お客様が訂正・否定した点');
    if (!state.corrections.length) L.push('なし');
    else {
      L.push('| # | 種類 | 訂正前 | 訂正後 |', '|---|---|---|---|');
      for (const c of state.corrections) L.push('| ' + c.seq + ' | ' + ({ edit: '回答の訂正', retract: '回答の取り消し', 'confirm-reject': '確認で「ちがう」', 'text-correction-word': '訂正の言葉' })[c.kind] + ' | ' + esc(fmt(c.before)) + ' | ' + esc(fmt(c.after)) + ' |');
    }
    L.push('');

    L.push('## 2. 依頼者の理解（事業・思い・言葉）');
    const visKeys = Object.keys(db.slots).filter((k) => k.startsWith('VIS.'));
    L.push('| 項目 | 回答 | 分類 |', '|---|---|---|');
    for (const k of visKeys) {
      const s = state.slots[k];
      if (s) L.push('| ' + db.slots[k].label + ' | ' + esc(s.status === 'answered' ? fmt(s.value) : '［' + (engine.SPECIAL[s.status] || s.status) + '］') + ' | ' + (epistemicOf(state, k) || (s.origin === 'text' ? '未分類' : '選択')) + ' |');
    }
    if (state.slots['VIS.tradeoff']) L.push('', '迷ったときの優先（10点配分）：' + fmt(state.slots['VIS.tradeoff'].value));
    L.push('');

    const reqTable = (list, cols) => {
      if (!list.length) { L.push('（なし）', ''); return; }
      L.push('| ID | 内容 | 状態 | 出どころ | 根拠（回答#・ルール） |' + (cols ? ' 受け入れ条件 | 優先 |' : ''), '|---|---|---|---|---|' + (cols ? '---|---|' : ''));
      for (const r of list) {
        L.push('| ' + r.key + ' | ' + esc(r.title) + (r.parent ? '（←' + r.parent + '）' : '') + ' | ' + STATUS[r.status] + ' | ' + ORIGIN[r.origin] + ' | ' + (r.answerSeqs.length ? '#' + r.answerSeqs.join(',#') : '-') + ' / ' + r.rules.join(',') + ' |' + (cols ? ' ' + esc(r.ac || '') + ' | ' + (r.moscow || '未定') + ' |' : ''));
      }
      L.push('');
    };

    L.push('## 3. 事業要求と成果の測り方');
    const pr = state.slots['BR.problem'];
    if (pr && pr.value) L.push('- 困りごと（原文）：「' + pr.value + '」— 本人の分類：' + (epistemicOf(state, 'BR.problem') || '未分類') + '／根拠：' + fmt((state.slots['BR.evidence'] || state.slots['BR.problem__evidence'] || {}).value || '未確認'));
    const req = state.slots['PRJ.request_raw'];
    if (req && req.value) L.push('- 相談の原文：「' + req.value + '」');
    L.push('');
    reqTable(byType('BR').concat(byType('VIS')));

    L.push('## 4. 業務プロセスと業務ルール');
    reqTable(byType('BP').concat(byType('RULE')).concat(byType('STATE').filter((r) => r.key === 'STATE-APPROVAL')));

    L.push('## 5. 機能要件');
    reqTable(byType('FR'), true);

    L.push('## 6. データ（扱う情報・項目・関係・状態）');
    reqTable(byType('ENT').concat(byType('ATTR')).concat(byType('REL')).concat(byType('STATE').filter((r) => r.key !== 'STATE-APPROVAL')));
    const ents = derive.slotVal(state, 'DAT.things') || [];
    if (ents.length) {
      L.push('```mermaid', 'erDiagram');
      for (const e of ents) L.push('  ' + e + ' { string id "' + fmt(derive.slotVal(state, 'DAT.' + e + '.id') || '見分け方未定') + '" }');
      for (const r of db.rules.entities.relations) {
        if (!ents.includes(r.a) || !ents.includes(r.b)) continue;
        const v = derive.slotVal(state, r.slot);
        const rel = v == null ? '}o..o{' : v === r.one ? '||--||' : '||--o{';
        L.push('  ' + r.a + ' ' + rel + ' ' + r.b + ' : "' + (v == null ? '未確認' : v) + '"');
      }
      L.push('```', '');
    }

    L.push('## 7. 使う人と見える範囲');
    reqTable(byType('ROLE').concat(byType('PERM')));

    L.push('## 8. 外部連携・移行');
    reqTable(byType('INT').concat(byType('MIG')));

    L.push('## 9. 非機能要件');
    reqTable(byType('NFR'), true);

    L.push('## 10. 制約・受け入れ条件・決定');
    reqTable(byType('CON').concat(byType('AC')).concat(byType('ADR')).concat(byType('CR')), true);

    L.push('## 11. 技術構成の候補（ノックアウト → 重み付け。確定ではない）');
    const t = state.tech;
    L.push('材料：' + (t.confident ? 'そろっている' : '不足（' + t.missingInputs.map((k) => engine.slotLabel(db, k)).join('、') + '）') + '。上限・料金の確認日：' + t.checkedAt);
    L.push('', '| 順 | 構成 | 判定 | 点（1〜5） | 除外・注意の理由 | トレードオフ |', '|---|---|---|---|---|---|');
    t.ranked.forEach((a, i) => L.push('| ' + (i + 1) + ' | ' + a.id + ' ' + a.label + ' | ' + ({ candidate: '候補', check: '要確認', excluded: '除外' })[a.status] + ' | ' + a.score + ' | ' + esc(a.reasons.concat(a.warnings.map((w) => '注意：' + w)).join('／')) + ' | ' + esc(t.tradeoffs[a.id]) + ' |'));
    const top = t.ranked.filter((a) => a.status !== 'excluded').slice(0, 2);
    L.push('', '### ADR 下書き：技術構成', '- ステータス：提案（顧客・FDEの合意前）', '- 検討した案：' + top.map((a) => a.id + ' ' + a.label).join(' ／ '));
    if (top.length === 2 && Math.abs(top[0].score - top[1].score) < 0.3) L.push('- 上位2案の差が小さい → 「やり直しのしやすさ」で決める（zip 04 §5 の運用ルール）');
    L.push('- 除外した案：' + t.ranked.filter((a) => a.status === 'excluded').map((a) => a.id + '（' + a.reasons.join('・') + '）').join('、'));
    L.push('- 見直しのきっかけ：利用人数・月間件数・見える範囲の条件が変わったとき', '');

    L.push('## 12. 未決定事項');
    if (!oi.length) L.push('なし');
    else {
      L.push('| ID | 種類 | 内容 | 実装を止めるか | 確認する人 | 理由 |', '|---|---|---|---|---|---|');
      for (const o of oi) L.push('| ' + o.id + ' | ' + o.kind + ' | ' + esc(o.label) + ' | ' + (o.blocking ? '止める' : '') + ' | ' + esc(o.owner) + ' | ' + esc(o.reason) + ' |');
    }
    L.push('');

    L.push('## 13. 仮説（競合仮説と反証条件）');
    for (const f of Object.values(state.families).filter((x) => x.active)) {
      L.push('### ' + f.label + (f.open ? '（未決着）' : ''), '決まること：' + (f.decides || []).join('、'), '', '| 仮説 | 状態 | 反証条件 |', '|---|---|---|');
      for (const h of Object.values(state.hyps).filter((x) => x.family === f.id)) L.push('| ' + h.label + ' | ' + ({ alive: '未検証', supported: '支持', refuted: '反証', inactive: '-' })[h.status] + ' | ' + esc(h.falsifier) + ' |');
      L.push('');
    }

    L.push('## 14. 人間レビュー待ち（自由記述：ツールは意味を判定していない）');
    if (!rv.length) L.push('なし');
    else {
      L.push('| 回答# | 原文 | 本人の分類 | 自動の手がかり |', '|---|---|---|---|');
      for (const r of rv) {
        const q = engine.resolveQuestion(db, state, r.iid);
        L.push('| ' + r.seq + ' | ' + esc(r.raw) + ' | ' + (q && q.slot ? epistemicOf(state, q.slot) || '未分類' : '') + ' | ' + esc(r.reasons.join('・')) + ' |');
      }
    }
    L.push('');

    L.push('## 15. 矛盾の確認');
    const cs = Object.values(state.contradictions);
    if (!cs.length) L.push('なし（構造化項目どうしの検出規則に該当なし。自由記述どうしの矛盾は検出していない）');
    else for (const c of cs) L.push('- ' + c.label + '：' + ({ open: '未確認', accepted: '確認済み（「場合による」等）' })[c.status]);
    L.push('');

    L.push('## 16. ヒアリング品質と仕様確定の判定');
    L.push('| 指標 | 値 | 内訳 |', '|---|---|---|');
    for (const k of Object.keys(mt)) L.push('| ' + k + ' | ' + (mt[k].value == null ? '-' : mt[k].value) + ' | ' + esc(mt[k].detail) + ' |');
    L.push('', '| 判定ルール | 結果 |', '|---|---|');
    for (const c of rd.checks) L.push('| ' + c.id + ' ' + c.label + (c.hard ? '（必須）' : '') + ' | ' + (c.ok ? '○' : '×') + ' |');
    L.push('');

    L.push('## 17. 回答ログ');
    L.push('| # | 質問 | 回答 | 秒 | 回答者 |', '|---|---|---|---|---|');
    for (const a of state.answers) {
      const q = engine.resolveQuestion(db, state, a.iid);
      L.push('| ' + a.seq + ' | ' + esc(q ? q.text : a.iid) + ' | ' + esc(answerText(db, state, a)) + ' | ' + Math.round(a.ms / 1000) + ' | ' + a.persona + ' |');
    }
    return L.join('\n');
  }

  /** スプレッドシートに貼る用（タブ区切り）。1行目が見出し */
  function tsv(rows) {
    return rows.map((r) => r.map((c) => String(c == null ? '' : c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  }

  function sheets(db, state, session) {
    const reqs = state.reqOrder.map((k) => state.reqs[k]);
    const rd = quality.readiness(db, state);
    const oi = quality.openIssues(db, state);
    return {
      cases: tsv([['案件ID', '案件名', '回答日時', '回答者', '回答数', '所要分', '判定', '要件数', '未決定数', '技術の第1候補', 'ルール版'],
        [session.meta.id, session.meta.title || '', new Date().toISOString(), session.meta.respondents.map((r) => r.name).join('、'), state.answers.length, Math.round(state.elapsedSec / 60), rd.verdict, reqs.length, oi.length,
          (state.tech.ranked.find((a) => a.status !== 'excluded') || {}).label || '', db.params.ruleVersion]]),
      requirements: tsv([['案件ID', '要件ID', '種類', '内容', '顧客向けの文', '状態', '出どころ', '親', '優先', '受け入れ条件', '根拠の回答#', '変換ルール', '根拠資料']]
        .concat(reqs.map((r) => [session.meta.id, r.key, TYPE[r.type] || r.type, r.title, r.plain || '', STATUS[r.status], ORIGIN[r.origin], r.parent || '', r.moscow || '', r.ac || '', r.answerSeqs.join(','), r.rules.join(','), r.sources.join(',')]))),
      openIssues: tsv([['案件ID', 'ID', '種類', '内容', '実装を止める', '確認する人', '理由']]
        .concat(quality.openIssues(db, state).map((o) => [session.meta.id, o.id, o.kind, o.label, o.blocking ? 'はい' : '', o.owner, o.reason]))),
      answers: tsv([['案件ID', '回答#', '質問ID', '質問', '何を判定するか', '回答で決まること', '回答', '本人の分類', '秒', '回答者の立場', 'ルール版']]
        .concat(state.answers.map((a) => {
          const q = engine.resolveQuestion(db, state, a.iid);
          return [session.meta.id, a.seq, a.iid, q ? q.text : '', q ? q.intent : '', q && q.decides ? q.decides.join('／') : '', answerText(db, state, a), q && q.slot ? epistemicOf(state, q.slot) : '', Math.round(a.ms / 1000), a.persona, db.params.ruleVersion];
        }))),
    };
  }

  const api = { markdown, sheets, answerText, fmt, STATUS, ORIGIN, TYPE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.report = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
