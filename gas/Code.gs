/**
 * 受け口（Apps Script）＋要件定義書シート。
 * 1. このシートの「拡張機能 → Apps Script」に全文を貼って保存する。
 * 2. 「デプロイ → デプロイを管理 → 編集 → 新バージョン」でデプロイし直す（URLは変わらない）。
 * 3. シートを開き直すと上部メニュー「要件定義書」が出る。「シートを準備」を一度実行する。
 * 4. 「要件定義書」シートの B2 で案件IDを選ぶと内容が切り替わる。「PDFをダウンロード」で縦向きA4のPDFになる。
 * 注意：エディタの「実行」で doPost を直接動かすとデータが無いので何もしない。動作確認は testPost。
 */
var DOC = '要件定義書';

function doPost(e) {
  if (!e || !e.postData) return ContentService.createTextOutput('no data');
  write_(JSON.parse(e.postData.contents));
  return ContentService.createTextOutput('ok');
}

function write_(d) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = { cases: '案件一覧', answers: '回答', requirements: '要件', openIssues: '未決定' };
  Object.keys(names).forEach(function (k) {
    var sh = ss.getSheetByName(names[k]) || ss.insertSheet(names[k]);
    var rows = String(d[k] || '').split('\n').map(function (r) { return r.split('\t'); });
    if (sh.getLastRow() === 0 && rows[0].join('')) sh.appendRow(rows[0]);
    rows.slice(1).forEach(function (r) { if (r.join('')) sh.appendRow(r); });
  });
  if (ss.getSheetByName(DOC)) refreshList_();
}

function testPost() {
  write_({ answers: '案件ID\t回答#\nテスト\t1', requirements: '案件ID\t要件ID\nテスト\tBR-01', openIssues: '案件ID\tID\nテスト\tOI-001' });
}

// ---------- メニュー ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('要件定義書')
    .addItem('シートを準備', 'setupDoc')
    .addItem('案件IDの一覧を更新', 'refreshList_')
    .addItem('PDFをダウンロード（A4縦）', 'downloadPdf')
    .addToUi();
}

function setupDoc() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DOC) || ss.insertSheet(DOC, 0);
  sh.clear();
  sh.setHiddenGridlines(true);
  // A4縦に収まる幅（合計 約 680px）
  [200, 480, 10, 10].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('A1:B1').merge().setValue('要件定義書').setFontSize(18).setFontWeight('bold').setFontColor('#1c2033');
  sh.getRange('A2').setValue('案件を選ぶ ▶').setFontWeight('bold').setFontColor('#4f5bd5');
  sh.getRange('B2').setBackground('#eef0ff').setNote('▼ ここで案件IDを選ぶと内容が切り替わります');
  refreshList_();
}

/** B2 のプルダウンを、届いた回答の案件IDで作り直す */
function refreshList_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var doc = ss.getSheetByName(DOC); if (!doc) return;
  var list = Object.keys(caseMap_());
  if (!list.length) list = ['（まだ回答がありません）'];
  doc.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
}

/** プルダウンに出す名前 → 案件ID（案件名があれば案件名＋日付、なければID） */
function caseMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), map = {}, named = {};
  var cs = ss.getSheetByName('案件一覧');
  if (cs && cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, 3).getValues().forEach(function (r) {
    if (!r[0]) return; named[r[0]] = true;
    map[(r[1] || '名称なし') + '（' + String(r[2]).slice(0, 10) + '）'] = String(r[0]);
  });
  ['回答', '要件'].forEach(function (n) {
    var sh = ss.getSheetByName(n); if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0] && !named[r[0]]) map[String(r[0])] = String(r[0]); });
  });
  return map;
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() === DOC && e.range.getA1Notation() === 'B2') render_(caseMap_()[String(e.value || '')] || String(e.value || ''));
}

// ---------- 本文の生成（15章。IDは出さず「項目」と「内容」だけ） ----------
var CHAPTERS = [
  '1. プロジェクト概要', '2. 背景・目的・ゴール', '3. ステークホルダー・利用者', '4. システム化の対象範囲', '5. 業務要件',
  '6. 機能要件', '7. 非機能要件', '8. 画面・UI/UX要件', '9. データ要件', '10. 外部システム連携要件',
  '11. 制約条件・前提条件', '12. スケジュール・体制', '13. 受入条件・検収基準', '14. リスク・未決事項', '15. 用語集・参考資料'];
// 質問ID → 章（個別の指定が先、なければ接頭辞）
var Q_EXACT = { 'Q-INT-008': 12, 'Q-INT-009': 12, 'Q-ACC-001': 4, 'Q-ACC-002': 4, 'Q-ACC-003': 13, 'Q-ACC-004': 13, 'Q-ACC-005': 12,
  'Q-ACC-006': 12, 'Q-ACC-007': 12, 'Q-ACC-008': 12, 'Q-ACC-009': 11, 'Q-ACC-010': 11, 'Q-VIS-006': 4, 'Q-VIS-008': 15,
  'Q-CON-005': 12, 'Q-DEL-001': 4, 'Q-DEL-005': 12, 'Q-DEL-006': 15, 'Q-OUT-006': 15, 'Q-OUT-011': 6, 'Q-INT-005': 2, 'Q-INT-006': 2, 'Q-HYP-001': 2 };
var Q_PREFIX = { 'Q-INT': 1, 'Q-VIS': 2, 'Q-PRB': 2, 'Q-KPI': 2, 'Q-ROL': 3, 'Q-ACC': 13, 'Q-CHG': 4, 'Q-FLW': 5, 'Q-RUL': 5, 'Q-MIG': 5,
  'Q-NFR': 7, 'Q-AIF': 6, 'Q-OUT': 8, 'Q-TOC': 8, 'Q-DAT': 9, 'Q-LNK': 10, 'Q-CON': 11, 'Q-DEL': 11, 'G-': 2 };
// 要件の種類 → 章
var R_TYPE = { '事業の思い': 2, '事業要求': 2, '立場': 3, '見える範囲・できること': 3, '業務プロセス': 5, '業務ルール': 5, '状態': 9, '移行': 5,
  '機能要件': 6, '非機能要件': 7, 'データ（まとまり）': 9, 'データ（項目）': 9, 'データ（関係）': 9, '外部連携': 10,
  '制約': 11, '技術・方針の決定': 11, '受け入れ条件': 13, '変更要求': 4 };
var LEAD = { 2: '何のために開発し、何を改善するか', 4: 'どこまで作り、何を作らないか', 6: 'システムが何をできる必要があるか',
  7: '機能以外の品質・運用の条件', 13: 'どうなれば完成と判断するか', 14: '決めないと進めない点・確認が必要な点' };

function chapterOfQ_(qid) {
  var base = String(qid).split('@')[0];
  if (Q_EXACT[base]) return Q_EXACT[base];
  if (base === 'EPI' || base === 'CONFIRM' || base === 'C') return 0;
  for (var p in Q_PREFIX) if (base.indexOf(p) === 0) return Q_PREFIX[p];
  return 2;
}

function rowsOf_(name, id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().filter(function (r) { return String(r[0]) === id; });
}

function render_(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOC);
  sh.getRange(3, 1, Math.max(sh.getMaxRows() - 2, 1), 4).breakApart().clear();
  sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 480); sh.setColumnWidth(3, 10); sh.setColumnWidth(4, 10);
  if (!id) return;
  var body = {}; for (var i = 1; i <= 15; i++) body[i] = [];
  var c = rowsOf_('案件一覧', id)[0];
  if (c) {
    body[1].push(['案件名', c[1]], ['回答日時', String(c[2]).slice(0, 16).replace('T', ' ')], ['回答者', c[3]], ['ヒアリングの判定', c[6]]);
    if (c[9]) body[11].push(['作り方の第一候補（推定）', c[9]]);
  }
  // 回答（質問と回答をそのまま。ドメイン理解・思いなど独自に聞いた情報もここに入る）
  rowsOf_('回答', id).forEach(function (r) {
    var ch = chapterOfQ_(r[2]); if (!ch || !r[3]) return;
    var label = String(r[3]).replace(/[？?。]$/, '');
    body[ch].push([label, String(r[6])]);
  });
  // ルールで整理した要件（未確認は明記）
  rowsOf_('要件', id).forEach(function (r) {
    var ch = R_TYPE[String(r[2])] || 11;
    var text = String(r[4] || r[3]);
    if (String(r[5]) !== '確認済み') text += '　［' + r[5] + '］';
    body[ch].push([String(r[2]), text]);
    if (r[9]) body[13].push([String(r[4] || r[3]).slice(0, 40), r[9]]);
  });
  rowsOf_('未決定', id).forEach(function (r) { body[14].push(['【' + r[2] + '】' + r[3], (r[6] || '') + (r[5] ? '（確認する人：' + r[5] + '）' : '') + (r[4] ? '　※実装を止める' : '')]); });

  var out = [], fmt = [];
  out.push(['', '']); fmt.push('gap');
  out.push(['この文書について', 'ヒアリングの回答をもとに自動で作った下書きです。［未確認（推定）］の内容は、合意してから確定します。']); fmt.push('note');
  CHAPTERS.forEach(function (t, k) {
    var n = k + 1;
    out.push(['', '']); fmt.push('gap');
    out.push([t, '']); fmt.push('h');
    if (LEAD[n]) { out.push([LEAD[n], '']); fmt.push('lead'); }
    if (!body[n].length) { out.push(['', '（回答なし・要確認）']); fmt.push('td'); }
    body[n].forEach(function (r) { out.push([r[0], r[1]]); fmt.push('td'); });
  });
  var start = 3;
  if (sh.getMaxRows() < start + out.length) sh.insertRowsAfter(sh.getMaxRows(), start + out.length - sh.getMaxRows());
  sh.getRange(start, 1, out.length, 2).setValues(out).setWrap(true).setVerticalAlignment('top').setFontSize(10).setFontColor('#1c2033').setFontFamily('Noto Sans JP');
  fmt.forEach(function (k, i) {
    var row = start + i, r = sh.getRange(row, 1, 1, 2);
    if (k === 'h') r.merge().setFontSize(12).setFontWeight('bold').setFontColor('#4f5bd5').setBorder(null, null, true, null, null, null, '#4f5bd5', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    else if (k === 'lead') r.merge().setFontColor('#5b6178').setFontSize(9);
    else if (k === 'td') { r.setBorder(null, null, true, null, null, null, '#e4e7f0', SpreadsheetApp.BorderStyle.SOLID); sh.getRange(row, 1).setFontColor('#5b6178'); }
    else if (k === 'note') { r.setFontColor('#5b6178').setFontSize(9); }
  });
}

// ---------- PDF ----------
function downloadPdf() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DOC);
  if (!sh) { SpreadsheetApp.getUi().alert('先にメニュー「シートを準備」を実行してください'); return; }
  var name = (sh.getRange('B2').getValue() || '要件定義書') + '_要件定義書.pdf';
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + sh.getSheetId() +
    '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER' +
    '&top_margin=0.6&bottom_margin=0.6&left_margin=0.6&right_margin=0.6';
  var html = HtmlService.createHtmlOutput('<p style="font-family:sans-serif">A4縦のPDFを作りました。</p><p><a href="' + url +
    '" target="_blank" download="' + name + '" style="font-family:sans-serif;font-size:16px">' + name + ' をダウンロード</a></p>').setWidth(360).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'PDFをダウンロード');
}
