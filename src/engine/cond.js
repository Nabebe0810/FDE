/*
 * cond.js — 条件式（発動条件・スキップ条件・導出ルール）の評価器
 *
 * 条件は JSON で書く。AI による意味推定は一切しない。評価対象は「構造化された項目（スロット）」
 * 「検出フラグ」「有効な論点」「回答済みの質問」だけ。
 *
 *  { "slot": "PRJ.audience", "eq": "社外" }        値が等しい
 *  { "slot": "X", "in": ["a","b"] }                値がどれか
 *  { "slot": "X", "has": "a" }                     複数選択の値に a を含む
 *  { "slot": "X", "hasAny": ["a","b"] }            複数選択の値にどれかを含む
 *  { "slot": "X", "gte": 10 } / "lte" / "gt" / "lt" 数値比較
 *  { "slot": "X", "known": true }                  回答済み（値あり）
 *  { "slot": "X", "resolved": true }               回答済み・該当しない・わからない・後で確認のどれか
 *  { "slot": "X", "status": "dontknow" }           状態の一致
 *  { "slot": "X", "count_gte": 2 } / "count_lte"     複数選択・一覧の件数
 *  { "slot": "X", "gtSlot": "Y" } / "ltSlot"       数値スロットどうしの比較
 *  { "slot": "X", "at": "行", "in": [..] }         マトリクス・配分入力の1要素を取り出して比較
 *  { "flag": "abstract@BR.problem" }               検出フラグが立っている（* で前方一致可）
 *  { "topic": "data" }                             論点が有効
 *  { "answered": "Q-PRJ-001" }                     その質問に回答済み
 *  { "persona": ["経営者","管理者"] }              回答者の立場
 *  { "det": "abstract" }                           直前の回答の検出結果（追加質問の判定専用）
 *  { "hyp": "HC-VOLUME", "status": "alive" }       仮説の状態
 *  { "all": [..] } / { "any": [..] } / { "not": {..} }
 *  値に "$param" と書くと、繰り返し質問のパラメータ（例：エンティティ名）に置き換わる。
 *  slot 名の中の {param} もパラメータに置き換わる（例：DAT.{param}.count）。
 */
(function (root) {
  'use strict';

  const RESOLVED = ['answered', 'na', 'dontknow', 'later', 'confirmed'];
  const KNOWN = ['answered', 'confirmed'];

  function slotKey(key, ctx) {
    return ctx && ctx.param != null ? String(key).replace('{param}', ctx.param) : key;
  }

  function sub(v, ctx) {
    if (v === '$param') return ctx ? ctx.param : undefined;
    if (Array.isArray(v)) return v.map((x) => sub(x, ctx));
    return v;
  }

  function flagMatch(flags, pattern) {
    if (!flags) return false;
    if (pattern.endsWith('*')) {
      const p = pattern.slice(0, -1);
      return Object.keys(flags).some((f) => flags[f] && f.startsWith(p));
    }
    return !!flags[pattern];
  }

  /**
   * @param {object} c 条件
   * @param {object} state エンジン状態（slots, flags, topics, asked, hyps, persona）
   * @param {object} ctx { param, det }（任意）
   */
  function evaluate(c, state, ctx) {
    if (c == null || c === true) return true;
    if (c === false) return false;
    if (Array.isArray(c)) return c.every((x) => evaluate(x, state, ctx));
    if (c.all) return c.all.every((x) => evaluate(x, state, ctx));
    if (c.any) return c.any.some((x) => evaluate(x, state, ctx));
    if (c.not) return !evaluate(c.not, state, ctx);

    if (c.flag) return flagMatch(state.flags, slotKey(c.flag, ctx));
    if (c.topic) return !!(state.topics && state.topics[c.topic] && state.topics[c.topic].active);
    if (c.answered) return !!(state.asked && state.asked[slotKey(c.answered, ctx)]);
    if (c.persona) return [].concat(c.persona).includes(state.persona);
    if (c.det) return !!(ctx && ctx.det && ctx.det[c.det]);
    if (c.hyp) {
      const h = state.hyps && state.hyps[c.hyp];
      if (!h) return false;
      return c.status ? h.status === c.status : true;
    }

    if (c.slot) {
      const key = slotKey(c.slot, ctx);
      const s = state.slots && state.slots[key];
      const status = s ? s.status : 'unknown';
      let val = s ? s.value : undefined;
      if ('at' in c) val = val && typeof val === 'object' ? val[sub(c.at, ctx)] : undefined; // マトリクス・配分の1要素
      if ('known' in c) return (KNOWN.includes(status)) === !!c.known;
      if ('resolved' in c) return (RESOLVED.includes(status)) === !!c.resolved;
      if ('status' in c) return [].concat(c.status).includes(status);
      if (!KNOWN.includes(status)) return false; // 値の比較は回答済みのときだけ
      if ('eq' in c) return val === sub(c.eq, ctx);
      if ('in' in c) return sub(c.in, ctx).includes(val);
      if ('has' in c) return Array.isArray(val) && val.includes(sub(c.has, ctx));
      if ('hasAny' in c) return Array.isArray(val) && sub(c.hasAny, ctx).some((x) => val.includes(x));
      if ('count_gte' in c) return Array.isArray(val) && val.length >= c.count_gte;
      if ('count_lte' in c) return Array.isArray(val) && val.length <= c.count_lte;
      if ('gtSlot' in c || 'ltSlot' in c) {
        const o = state.slots[slotKey(c.gtSlot || c.ltSlot, ctx)];
        if (!o || !KNOWN.includes(o.status) || typeof o.value !== 'number' || typeof val !== 'number') return false;
        return 'gtSlot' in c ? val > o.value : val < o.value;
      }
      if ('gte' in c) return typeof val === 'number' && val >= c.gte;
      if ('lte' in c) return typeof val === 'number' && val <= c.lte;
      if ('gt' in c) return typeof val === 'number' && val > c.gt;
      if ('lt' in c) return typeof val === 'number' && val < c.lt;
      if ('truthy' in c) return !!val === !!c.truthy;
      return val != null;
    }
    throw new Error('未知の条件: ' + JSON.stringify(c));
  }

  /** 条件が参照するスロット名を列挙（依存グラフ・後続影響の計算に使う） */
  function referencedSlots(c, out) {
    out = out || [];
    if (c == null || typeof c !== 'object') return out;
    if (Array.isArray(c)) { c.forEach((x) => referencedSlots(x, out)); return out; }
    if (c.slot && !out.includes(c.slot)) out.push(c.slot);
    ['all', 'any'].forEach((k) => c[k] && c[k].forEach((x) => referencedSlots(x, out)));
    if (c.not) referencedSlots(c.not, out);
    return out;
  }

  const api = { evaluate, referencedSlots, RESOLVED, KNOWN, slotKey };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FDE = root.FDE || {}; root.FDE.cond = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
