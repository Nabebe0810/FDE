/*
 * util.js — 決定論的な小道具（文字正規化・辞書照合・テンプレート展開）
 * ブラウザ（file:// でも動く classic script）と Node（require）の両方で使えるよう UMD 風に書く。
 */
(function (root) {
  'use strict';

  /** 全角英数・記号を半角へ、カタカナ長音などはそのまま。比較用の正規化。 */
  function normalize(text) {
    if (text == null) return '';
    return String(text)
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/　/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** 辞書（語の配列）のうち text に含まれる語を返す。重複なし・辞書の順。 */
  function matchWords(text, words) {
    const t = normalize(text);
    if (!t) return [];
    const hits = [];
    for (const w of words || []) {
      const nw = normalize(w);
      if (nw && t.includes(nw) && !hits.includes(w)) hits.push(w);
    }
    return hits;
  }

  /** 正規表現パターン（文字列）の配列で照合し、一致した部分文字列を返す。 */
  function matchPatterns(text, patterns) {
    const t = normalize(text);
    const hits = [];
    for (const p of patterns || []) {
      const re = new RegExp(p, 'g');
      let m;
      while ((m = re.exec(t)) !== null) {
        hits.push(m[0]);
        if (m[0] === '') re.lastIndex++;
      }
    }
    return hits;
  }

  /** {{a.b}} 形式の置換。値がなければ fallback（既定は「それ」）。 */
  function template(str, vars, fallback) {
    if (!str) return '';
    return String(str).replace(/\{\{\s*([\w.\-@]+)\s*\}\}/g, (_, key) => {
      const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
      if (v == null || v === '') return fallback == null ? 'それ' : fallback;
      return Array.isArray(v) ? v.join('、') : String(v);
    });
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  /** 安定ソート（同点は key で辞書順）— 同じ入力なら必ず同じ順になる。 */
  function stableSortBy(arr, scoreFn, keyFn) {
    return arr
      .map((x, i) => ({ x, i, s: scoreFn(x), k: keyFn ? keyFn(x) : String(i) }))
      .sort((a, b) => (b.s - a.s) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) || (a.i - b.i))
      .map((o) => o.x);
  }

  function round(n, d) {
    const f = Math.pow(10, d == null ? 2 : d);
    return Math.round(n * f) / f;
  }

  /** 決定論的な連番 ID（状態の中のカウンタを使う。乱数・時刻を使わない） */
  function nextId(state, prefix) {
    state.counters = state.counters || {};
    state.counters[prefix] = (state.counters[prefix] || 0) + 1;
    return prefix + '-' + String(state.counters[prefix]).padStart(3, '0');
  }

  const api = { normalize, matchWords, matchPatterns, template, clone, uniq, stableSortBy, round, nextId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.util = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
