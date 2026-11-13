/*
 * scenarios.js — シミュレーションとテストに使う仮想の案件（すべて説明用の架空の設定）
 * answers はスロット名（または iid）→ 回答値。書いていない質問は既定の方針で答える。
 */
'use strict';
module.exports = {
  internal_approval: {
    title: '社内の経費申請（架空）', role: '管理者',
    answers: {
      'PRJ.request_raw': '経費の申請を紙でしていて、承認まで平均5日かかる。先月は差し戻しが12件あった',
      'PRJ.kind': '新規', 'PRJ.audience': '社内', 'PRJ.category': ['申請・承認', '記録・一覧・集計'],
      'ISS.topics': { yes: ['flow', 'rules'], no: ['integration', 'migration', 'toc', 'ai', 'change', 'vision'], unknown: [] },
      'BR.problem_type': ['時間がかかる', 'ミス・漏れがある'],
      'BR.problem': '先月、申請から承認まで平均5日かかり、差し戻しが12件あった',
      'BR.cause_yes': { yes: ['HC-WAIT', 'HC-REKEY'], no: ['HC-VOLUME', 'HC-SKILL'], unknown: ['HC-VARIANCE', 'HC-SCATTER', 'HC-RULE'] },
      'PRJ.decision_maker': '上司・経営者',
      'EPI@PRJ.request_raw': 'fact', 'EPI@BR.problem': 'fact',
      'ASIS.tools': ['紙', 'Excel', 'メール'], 'ASIS.volume': '月10〜100件', 'RULE.approval': true,
      'DAT.things': { yes: ['staff', 'document', 'payment'], no: [], unknown: [] },
      'NFR.users_total': '11〜100人', 'NFR.concurrency': '1〜5人', 'ROLE.login': '必要', 'ROLE.see_scope': '立場ごとに違う',
      'CON.budget_monthly': '0円', 'CON.workspace': 'Google Workspace', 'CON.maintainer': '社内にスプレッドシートなら直せる人がいる',
      'OUT.publish': '社内だけで使う', 'NFR.sensitivity': '少し困る', 'ROLE.google_accounts': '全員持っている',
      'AI.want': ['AIは使わない'], 'INT.systems': ['なし'],
    },
  },
  toc_work: {
    title: '受講生向けワークツール（架空）', role: '経営者',
    answers: {
      'PRJ.request_raw': '受講生が自分の強みを書き出すワークを、スマホでできるツールにしたい',
      'PRJ.kind': '新規', 'PRJ.audience': '一般の個人', 'PRJ.category': ['学習・ワーク', '診断・自己理解'],
      'ISS.topics': { yes: ['toc', 'vision', 'ai'], no: ['flow', 'rules', 'integration', 'migration', 'change'], unknown: [] },
      'BR.problem_type': ['新しいことができない', 'お客様が増えない・離れる'],
      'BR.problem': 'ワークを紙で配っていて、提出率が先月は4割だった',
      'BR.cause_yes': { yes: ['HC-SKILL'], no: ['HC-VOLUME', 'HC-WAIT', 'HC-RULE'], unknown: ['HC-VARIANCE', 'HC-SCATTER', 'HC-REKEY'] },
      'PRJ.decision_maker': '自分',
      'EPI@PRJ.request_raw': 'wish', 'EPI@BR.problem': 'fact',
      'DAT.things': { yes: ['customer', 'content'], no: [], unknown: [] },
      'NFR.users_total': '101〜1000人', 'NFR.concurrency': '6〜30人', 'ROLE.login': 'URLを開くだけで使いたい', 'ROLE.see_scope': '全員が全部見てよい',
      'ROLE.operator_view': '見なくてよい（本人の端末だけでよい）', 'OUT.open_from': 'LINE', 'OUT.devices': ['スマホ', 'パソコン'],
      'OUT.outputs': ['PDF・印刷物'], 'OUT.publish': 'URLを知っている人だけ', 'DAT.carry_over': '無料版から本番へ', 'OUT.required_input': '全部書かないと進めない',
      'CON.budget_monthly': '月3千円まで', 'CON.workspace': '個人のGoogleアカウントだけ', 'CON.maintainer': '社内にいない（外部に頼む）',
      'NFR.sensitivity': '少し困る', 'NFR.external_send': '名前などを消せば送ってよい', 'AI.want': ['文章の要約・言い換え'],
      'TOC.next_action': '申し込み・購入', 'TOC.resume': '必要',
    },
  },
  sales_crm: {
    title: '営業の顧客管理（架空）', role: '経営者',
    answers: {
      'PRJ.request_raw': '営業5人が顧客をそれぞれのExcelで管理していて、誰が何を進めているか見えない',
      'PRJ.kind': '改修', 'PRJ.audience': '社内', 'PRJ.category': ['顧客管理・営業'],
      'ISS.topics': { yes: ['flow', 'integration', 'migration', 'vision'], no: ['toc', 'ai'], unknown: ['rules', 'change'] },
      'BR.problem_type': ['情報が散らばっている', '状況が見えない'],
      'BR.problem': '先週、同じお客様に2人の営業が別々に電話していた',
      'BR.cause_yes': { yes: ['HC-SCATTER', 'HC-VARIANCE'], no: ['HC-WAIT'], unknown: ['HC-VOLUME', 'HC-REKEY', 'HC-RULE', 'HC-SKILL'] },
      'PRJ.decision_maker': '自分',
      'EPI@PRJ.request_raw': 'fact', 'EPI@BR.problem': 'fact',
      'ASIS.tools': ['Excel', 'メール', '電話', '既存のサービス・システム'], 'ASIS.variation': '人によって大きく違う',
      'DAT.things': { yes: ['customer', 'order', 'staff', 'task'], no: ['inventory'], unknown: [] },
      'REL.customer_order': '何回もある', 'REL.customer_staff': '決まった1人',
      'NFR.users_total': '10人以下', 'NFR.concurrency': '1〜5人', 'ROLE.login': '必要', 'ROLE.see_scope': '立場ごとに違う',
      'CON.budget_monthly': '月1万円まで', 'CON.workspace': 'Google Workspace', 'CON.maintainer': '社内にスプレッドシートなら直せる人がいる',
      'OUT.publish': '社内だけで使う', 'NFR.sensitivity': 'とても困る', 'INT.systems': ['カレンダー', 'メール配信'], 'AI.want': ['AIは使わない'],
      'MIG.existing_data': '移す',
    },
    reject: ['FR-LIST'],
  },
  contradiction: {
    title: '矛盾を含む回答（架空）', role: '管理者',
    answers: {
      'PRJ.request_raw': '会員が自分の予約だけ見られるページを、ログインなしで作りたい',
      'PRJ.kind': '新規', 'PRJ.audience': '一般の個人', 'PRJ.category': ['予約・受付'],
      'ISS.topics': { yes: ['toc'], no: ['ai', 'change'], unknown: [] },
      'BR.problem_type': ['連絡・確認が遅い'], 'BR.problem': '予約の確認の電話が毎日10件ある',
      'ROLE.login': 'URLを開くだけで使いたい', 'ROLE.see_scope': '自分の分だけ',
      'NFR.users_total': '10人以下', 'NFR.concurrency': '31〜100人',
      'C@C-02': 'login', 'C@C-01': 'total',
    },
  },
  abstract: {
    title: '抽象的な回答が多い（架空）', role: '経営者', policy: 'abstract',
    answers: { 'PRJ.request_raw': 'DXで業務を効率化したい', 'BR.problem': 'いろいろ効率化したい' },
  },
  dontknow: {
    title: '「わからない」が多い（架空）', role: '現場', policy: 'dontknow',
    answers: { 'PRJ.request_raw': '日報を書くのに毎日30分かかっている', 'PRJ.audience': '社内', 'PRJ.category': ['記録・一覧・集計'], 'BR.problem': '日報に毎日30分かかる' },
  },
};
