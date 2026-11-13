/*
 * detect.js — 自由記述の「形式」判定（意味は判定しない）
 *
 * できること：語彙辞書と正規表現による「手がかり」の検出（数字・日付・単位・推量の言い回し・
 *   手段の言葉・困りごとの言葉・抽象語）。結果は「追加質問を出すかどうか」の判断材料にだけ使う。
 * できないこと（明示的な制限）：文の意味の理解、言い換えの同一性判定、皮肉・否定のスコープ、
 *   自由文どうしの意味的な矛盾。これらは人間レビュー（FDE）に回す。
 * 判定はすべて「原文を保持したまま」付ける注記であり、原文を書き換えない。
 */
(function (root) {
  'use strict';
  const util = typeof require === 'function' ? require('./util.js') : root.FDE.util;

  /**
   * @param {string} text 原文
   * @param {object} lex 語彙辞書（data/rules/lexicon.json）
   * @param {object} p   閾値（params.detect）
   */
  function analyzeText(text, lex, p) {
    p = p || {};
    const raw = text == null ? '' : String(text);
    const norm = util.normalize(raw);
    const len = norm.replace(/\s/g, '').length;
    const hits = {
      number: util.matchPatterns(raw, lex.patterns.number),
      date: util.matchPatterns(raw, lex.patterns.date),
      unit: util.matchPatterns(raw, lex.patterns.unit),
      timeRef: util.matchWords(raw, lex.words.time_reference),
      abstract: util.matchWords(raw, lex.words.abstract),
      solution: util.matchWords(raw, lex.words.solution),
      problem: util.matchWords(raw, lex.words.problem),
      hedge: util.matchWords(raw, lex.words.hedge),
      fact: util.matchWords(raw, lex.words.fact),
      evaluative: util.matchWords(raw, lex.words.evaluative),
      desire: util.matchWords(raw, lex.words.desire),
      correction: util.matchWords(raw, lex.words.correction),
      plural: util.matchWords(raw, lex.words.vague_plural),
    };
    const concrete = hits.number.length + hits.date.length + hits.unit.length + hits.timeRef.length + hits.fact.length;
    const minChars = p.abstractMinChars == null ? 15 : p.abstractMinChars;

    const det = {
      empty: len === 0,
      short: len > 0 && len < minChars,
      // 抽象的：短すぎる、または抽象語／ぼかし語があり具体の手がかりが一つもない
      abstract: len > 0 && concrete === 0 && (len < minChars || hits.abstract.length > 0 || hits.plural.length > 0),
      // 解決策だけ：手段の言葉があり、困りごとの言葉がない
      solutionOnly: hits.solution.length > 0 && hits.problem.length === 0,
      // 根拠が必要：評価語（多い・遅い等）があるのに、数字・観察の手がかりがない
      needsEvidence: hits.evaluative.length > 0 && hits.number.length === 0 && hits.fact.length === 0,
      // 推量の言い回しがある（仮説の可能性）
      speculative: hits.hedge.length > 0,
      // 観察事実の手がかりがある（事実の可能性。確定ではない）
      factLike: hits.fact.length + hits.date.length + hits.timeRef.length > 0 && hits.hedge.length === 0,
      hasNumber: hits.number.length > 0,
      wantsChange: hits.desire.length > 0,
      correction: hits.correction.length > 0,
    };
    // 推定の分類ヒント（UI で初期の並び順に使うだけ。確定は回答者の選択）
    let epistemicHint = 'unknown';
    if (det.speculative) epistemicHint = 'guess';
    else if (det.factLike) epistemicHint = 'fact';
    else if (det.wantsChange) epistemicHint = 'wish';

    const explain = Object.keys(hits)
      .filter((k) => hits[k].length)
      .map((k) => k + ':' + util.uniq(hits[k]).slice(0, 5).join('/'));
    return { len, hits, det, epistemicHint, explain };
  }

  /** 数値入力の妥当性（範囲外・桁違いの疑い） */
  function analyzeNumber(n, range) {
    const det = { outOfRange: false, zero: n === 0 };
    if (range) {
      if (range.min != null && n < range.min) det.outOfRange = true;
      if (range.max != null && n > range.max) det.outOfRange = true;
    }
    return { det, explain: [] };
  }

  const api = { analyzeText, analyzeNumber };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.detect = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
