/**
 * 受け口（Apps Script）。このシートの「拡張機能 → Apps Script」に貼り、
 * 「デプロイ → ウェブアプリ（実行：自分／アクセス：全員）」で公開して、URL を config.js の gasUrl に入れる。
 * 注意：エディタの「実行」ボタンで doPost を直接動かすと e が無いのでエラーになる。動作確認は testPost を実行する。
 */
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
}
/** エディタから実行する動作確認用（各シートに見出しとテスト行が1行入る） */
function testPost() {
  write_({ answers: '案件ID\t回答#\nテスト\t1', requirements: '案件ID\t要件ID\nテスト\tBR-01', openIssues: '案件ID\tID\nテスト\tOI-001' });
}
