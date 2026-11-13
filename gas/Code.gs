/** スプレッドシートに貼り付けて「ウェブアプリとしてデプロイ（全員がアクセス可）」。URL を config.js の gasUrl に入れる。 */
function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ['answers', 'requirements', 'openIssues'].forEach(function (k) {
    var name = { answers: '回答', requirements: '要件', openIssues: '未決定' }[k];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var rows = String(d[k] || '').split('\n').map(function (r) { return r.split('\t'); });
    if (sh.getLastRow() === 0) sh.appendRow(rows[0]);
    rows.slice(1).forEach(function (r) { if (r.join('')) sh.appendRow(r); });
  });
  return ContentService.createTextOutput('ok');
}
