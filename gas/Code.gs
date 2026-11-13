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
  [96, 400, 104, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('A1:D1').merge().setValue('要件定義書（RFP）').setFontSize(18).setFontWeight('bold').setFontColor('#1c2033');
  sh.getRange('A2').setValue('案件ID').setFontWeight('bold');
  sh.getRange('B2').setBackground('#eef0ff').setNote('▼ ここで案件IDを選ぶと内容が切り替わります');
  refreshList_();
}

/** B2 のプルダウンを、届いた回答の案件IDで作り直す */
function refreshList_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var doc = ss.getSheetByName(DOC); if (!doc) return;
  var ids = {};
  ['案件一覧', '回答', '要件'].forEach(function (n) {
    var sh = ss.getSheetByName(n); if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) ids[r[0]] = true; });
  });
  var list = Object.keys(ids);
  if (!list.length) list = ['（まだ回答がありません）'];
  doc.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() === DOC && e.range.getA1Notation() === 'B2') render_(String(e.value || ''));
}

// ---------- 本文の生成 ----------
var SECTIONS = [
  ['1. 目的と事業要求', ['事業の思い', '事業要求']],
  ['2. 業務の流れと決まりごと', ['業務プロセス', '業務ルール', '状態']],
  ['3. 機能要件', ['機能要件']],
  ['4. 扱う情報（データ）', ['データ（まとまり）', 'データ（項目）', 'データ（関係）']],
  ['5. 使う人と見える範囲', ['立場', '見える範囲・できること']],
  ['6. 外部連携・移行', ['外部連携', '移行']],
  ['7. 非機能要件（規模・安全・止まったとき）', ['非機能要件']],
  ['8. 制約・技術方針・完成の基準', ['制約', '技術・方針の決定', '受け入れ条件', '変更要求']]
];

function rowsOf_(name, id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().filter(function (r) { return String(r[0]) === id; });
}

function render_(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOC);
  var last = Math.max(sh.getMaxRows(), 4);
  sh.getRange(3, 1, last - 2, 4).breakApart().clear();
  if (!id) return;
  var out = [], fmt = [];
  var push = function (row, kind) { out.push(row); fmt.push(kind); };
  var c = rowsOf_('案件一覧', id)[0];
  push(['', '', '', ''], 'gap');
  push(['案件名', c ? c[1] : '', '判定', c ? c[6] : ''], 'info');
  push(['回答日時', c ? String(c[2]).slice(0, 16).replace('T', ' ') : '', '回答者', c ? c[3] : ''], 'info');
  push(['技術の候補', c ? c[9] : '（未確認）', '要件数', c ? c[7] : ''], 'info');
  push(['', '「未確認（推定）」はお客様の合意前の仮の内容です。開発仕様として扱う前に確認してください。', '', ''], 'note');
  var reqs = rowsOf_('要件', id);
  SECTIONS.forEach(function (s) {
    var rs = reqs.filter(function (r) { return s[1].indexOf(String(r[2])) >= 0; });
    push(['', '', '', ''], 'gap');
    push([s[0], '', '', ''], 'h');
    push(['ID', '内容', '状態', '優先'], 'th');
    if (!rs.length) push(['', '（なし）', '', ''], 'td');
    rs.forEach(function (r) {
      var text = String(r[3]) + (r[9] ? '\n受け入れ条件：' + r[9] : '');
      push([r[1], text, r[5], r[8] || ''], 'td');
    });
  });
  var oi = rowsOf_('未決定', id);
  push(['', '', '', ''], 'gap');
  push(['9. 未決定事項（決めないと進めない点）', '', '', ''], 'h');
  push(['ID', '内容（理由）', '確認する人', '止める'], 'th');
  if (!oi.length) push(['', '（なし）', '', ''], 'td');
  oi.forEach(function (r) { push([r[1], '【' + r[2] + '】' + r[3] + (r[6] ? '（' + r[6] + '）' : ''), r[5], r[4] ? '止める' : ''], 'td'); });

  var start = 3;
  if (sh.getMaxRows() < start + out.length) sh.insertRowsAfter(sh.getMaxRows(), start + out.length - sh.getMaxRows());
  var rg = sh.getRange(start, 1, out.length, 4);
  rg.setValues(out).setWrap(true).setVerticalAlignment('top').setFontSize(10).setFontColor('#1c2033');
  fmt.forEach(function (k, i) {
    var r = sh.getRange(start + i, 1, 1, 4);
    if (k === 'h') { r.merge().setFontSize(12).setFontWeight('bold').setFontColor('#4f5bd5').setBorder(null, null, true, null, null, null, '#4f5bd5', SpreadsheetApp.BorderStyle.SOLID_MEDIUM); }
    else if (k === 'th') { r.setBackground('#eef0ff').setFontWeight('bold'); }
    else if (k === 'td') { r.setBorder(null, null, true, null, null, null, '#e4e7f0', SpreadsheetApp.BorderStyle.SOLID); }
    else if (k === 'info') { sh.getRange(start + i, 1).setFontWeight('bold'); sh.getRange(start + i, 3).setFontWeight('bold'); }
    else if (k === 'note') { sh.getRange(start + i, 2, 1, 3).merge().setFontColor('#5b6178').setFontSize(9); }
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
