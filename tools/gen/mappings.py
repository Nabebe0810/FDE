# 要件変換マッピングの生成元（繰り返し部分をまとめて書くため）。出力: data/rules/mappings.json
# 実行: python3 -I tools/gen/mappings.py
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ent = json.load(open(os.path.join(ROOT, 'data/rules/entities.json')))
M = []
def m(id, when, emit, src, forEach=None):
    r = {"id": id, "when": when, "emit": emit, "sources": src}
    if forEach: r["forEach"] = forEach
    M.append(r)
K = lambda s: {"slot": s, "known": True}

# ---- 依頼者理解・事業要求 ----
m("M-VIS-01", K("VIS.mission"), [{"type": "VIS", "key": "VIS-MISSION", "title": "事業の使命：{{VIS.mission}}", "plain": "この事業は「{{VIS.mission}}」を目指している", "origin": "customer", "confirm": True}], ["C:VS7", "A:09_コンセプト"])
m("M-VIS-02", K("VIS.not_do"), [{"type": "CON", "key": "CON-NOTDO", "title": "やらないこと：{{VIS.not_do}}", "plain": "「{{VIS.not_do}}」はやらない（作るものにも入れない）", "origin": "customer", "confirm": True}], ["C:VS7 採否テスト", "B:§1.2 スコープ外"])
m("M-BR-01", K("BR.problem"), [{"type": "BR", "key": "BR-01", "title": "困りごとの解消：{{BR.problem}}", "plain": "いちばんの困りごとは「{{BR.problem}}」で、主に{{BR.who_suffers}}が困っている", "origin": "customer", "confirm": True}], ["C:VS1", "A:08_顧客課題"])
m("M-BR-02", K("BR.goal_type"), [{"type": "BR", "key": "BR-GOAL", "title": "得たい成果：{{BR.goal_type}}", "plain": "この仕組みでいちばん得たい成果は「{{BR.goal_type}}」", "origin": "customer", "confirm": True, "parent": "BR-01"}], ["A:09_コンセプト", "B:§1"])
m("M-BR-03", K("BR.kpi_metric"), [{"type": "BR", "key": "BR-KPI", "title": "成果の指標：{{BR.kpi_metric}}（現状 {{BR.kpi_baseline}} → 目標 {{BR.kpi_target}}、{{BR.kpi_when}}）", "plain": "成果は「{{BR.kpi_metric}}」で測る（今 {{BR.kpi_baseline}} → 目標 {{BR.kpi_target}}、期限 {{BR.kpi_when}}）", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "ac": "{{BR.kpi_when}}に{{BR.kpi_metric}}が{{BR.kpi_target}}になっている（測り方：{{BR.kpi_measurable}}）"}], ["A:20_KPI", "A:13_検証"])
m("M-BR-04", K("BR.roi_hours"), [{"type": "BR", "key": "BR-ROI", "title": "費用対効果の材料：作業時間 {{BR.roi_hours}}・関わる人 {{BR.roi_people}}", "plain": "今その作業に{{BR.roi_hours}}・{{BR.roi_people}}がかかっている", "origin": "customer", "confirm": False, "parent": "BR-GOAL"}], ["zip:BR.roi_*", "zip:BR.roi_*"])
m("M-BR-05", K("BR.success_check"), [{"type": "AC", "key": "AC-BR", "title": "うまくいったと判断する場面：{{BR.success_check}}", "plain": "「{{BR.success_check}}」となれば、うまくいったと判断する", "origin": "customer", "confirm": True, "parent": "BR-GOAL"}], ["A:13_検証", "B:§7 受け入れ基準"])
m("M-ADR-00", {"any": [{"hyp": "HS-RULE", "status": "supported"}, {"hyp": "HS-CONFIG", "status": "supported"}, {"hyp": "HS-SAAS", "status": "alive"}]}, [{"type": "ADR", "key": "ADR-000", "title": "作るか・作らないか：ルール変更・設定変更・既製サービスの案を比較する", "plain": "作る前に、仕事のルールや今の道具の設定を変える案・既製サービスの案とも比べる", "origin": "rule", "confirm": True}], ["C:原則4", "A:14_比較評価", "zip:04 H類型"])

# ---- 制約 ----
m("M-CON-01", K("PRJ.deadline"), [{"type": "CON", "key": "CON-DEADLINE", "title": "使い始めたい時期：{{PRJ.deadline}}（理由：{{PRJ.deadline_reason}}）", "plain": "{{PRJ.deadline}}に使い始めたい（理由：{{PRJ.deadline_reason}}）", "origin": "customer", "confirm": True}], ["zip:Q-PRJ-005", "D:§4 #13"])
m("M-CON-02", K("CON.budget_monthly"), [{"type": "CON", "key": "CON-BUDGET", "title": "毎月の費用の上限：{{CON.budget_monthly}}（初期 {{CON.budget_initial}}）", "plain": "毎月の費用は{{CON.budget_monthly}}までにする", "origin": "customer", "confirm": True}], ["zip:04 判断軸"])
m("M-CON-03", K("CON.maintainer"), [{"type": "CON", "key": "CON-MAINT", "title": "保守体制：{{CON.maintainer}}", "plain": "作った後の手直しは「{{CON.maintainer}}」体制で行う", "origin": "customer", "confirm": True}], ["zip:04 判断軸"])
m("M-CON-04", {"slot": "PRJ.conformance_docs", "eq": "ある"}, [{"type": "CON", "key": "CON-CONFORM", "title": "準拠する資料あり（合わせる度合い：{{PRJ.conformance_level}}）", "plain": "決められた資料に合わせて作る（度合い：{{PRJ.conformance_level}}）。資料の一覧を最初にもらう", "origin": "rule", "confirm": True, "ac": "画面の項目名・順番が資料と一致している"}], ["D:§4 #7", "D:依頼22"])
m("M-CON-05", {"slot": "OUT.words_rule", "in": ["ある", "これから決める"]}, [{"type": "CON", "key": "CON-WORDS", "title": "画面で使う言葉・使わない言葉の一覧を作り、全画面・出力物で守る", "plain": "画面やPDFで使わない言葉の決まりを一覧にして守る", "origin": "rule", "confirm": True, "ac": "禁止語の一覧で全画面・出力物を検索し、0件である"}], ["D:§4 #6", "D:依頼25"])
m("M-CON-06", K("CON.workspace"), [{"type": "CON", "key": "CON-PLATFORM", "title": "契約中のサービス：{{CON.workspace}}", "plain": "会社では{{CON.workspace}}を使っている", "origin": "customer", "confirm": False}], ["zip:04"])

# ---- 機能要件（画面・出力） ----
outs = [("一覧表", "FR-LIST", "情報を一覧で見て、絞り込み・並べ替えができる", "一覧で見て、探せるようにする"),
        ("集計・グラフ", "FR-AGG", "件数・金額などを集計してグラフで見られる", "数字をまとめてグラフで見られるようにする"),
        ("PDF・印刷物", "FR-PDF", "決められた形のPDFを作れる", "PDFを作れるようにする"),
        ("メールのお知らせ", "FR-MAIL", "決まったときにメールでお知らせする", "メールでお知らせが届くようにする"),
        ("LINEのお知らせ", "FR-LINE", "決まったときにLINEでお知らせする", "LINEでお知らせが届くようにする"),
        ("CSV・Excel出力", "FR-CSV", "一覧をCSV・Excelで書き出せる", "表計算ソフトに書き出せるようにする")]
for v, key, t, p in outs:
    em = {"type": "FR", "key": key, "title": t, "plain": p, "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "output"}
    if key == "FR-PDF": em["ac"] = "PDFは「{{OUT.pdf_limit}}」の決まりに収まり、余計な文字が出ない"
    m("M-" + key, {"slot": "OUT.outputs", "has": v}, [em], ["B:§4 画面と機能", "D:§4 #5"])
m("M-FR-LOGIN", {"slot": "ROLE.login", "eq": "必要"}, [
    {"type": "FR", "key": "FR-LOGIN", "title": "使う人がログインして使う", "plain": "使う人はログインしてから使う", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "roles"},
    {"type": "NFR", "key": "NFR-AUTH", "title": "本人確認の方式を決める（アカウント状況：{{ROLE.google_accounts}}）", "origin": "rule", "topic": "nfr"}], ["B:§3", "zip:Q-ROL-004"])
m("M-FR-NOLOGIN", {"slot": "ROLE.login", "eq": "URLを開くだけで使いたい"}, [
    {"type": "FR", "key": "FR-NOLOGIN", "title": "URLを開くだけで使える（ログインなし）", "plain": "URLを開くだけで、登録なしで使える", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "roles"}], ["D:依頼08", "D:§4 #2"])
m("M-FR-APPROVAL", {"slot": "RULE.approval", "eq": True}, [
    {"type": "FR", "key": "FR-APPROVAL", "title": "申請と承認（段数：{{RULE.approval_levels}}、差し戻し：{{RULE.reject_flow}}）", "plain": "申請して、決まった人が許可・差し戻しをできるようにする（{{RULE.approval_levels}}）", "origin": "rule", "confirm": True, "parent": "BR-GOAL", "topic": "rules"},
    {"type": "STATE", "key": "STATE-APPROVAL", "title": "申請の状態：下書き → 申請中 → 承認／差し戻し → 完了", "origin": "rule"},
    {"type": "ROLE", "key": "ROLE-APPROVER", "title": "承認する人", "origin": "rule"},
    {"type": "AC", "key": "AC-APPROVAL", "title": "承認されるまで「完了」にならない／差し戻すと申請者に戻る", "origin": "rule", "parent": "FR-APPROVAL"}], ["B:§5 状態遷移", "zip:RULE.*"])
m("M-FR-CARRY", {"slot": "DAT.carry_over", "in": ["別の端末へ", "無料版から本番へ", "次の版へ"]}, [
    {"type": "FR", "key": "FR-CARRY", "title": "入力した内容を{{DAT.carry_over}}引き継げる（書き出し・読み込み）", "plain": "書いた内容を{{DAT.carry_over}}引き継げるようにする", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "data", "ac": "引き継いだ先で、同じ内容がそのまま表示される"}], ["D:依頼08", "D:依頼13", "D:§2 つづきコード"])
m("M-FR-RESUME", {"slot": "TOC.resume", "in": ["必要", "あると良い"]}, [
    {"type": "FR", "key": "FR-RESUME", "title": "途中で保存し、あとで続きから再開できる", "plain": "途中でやめても、あとで続きから始められる", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "toc"}], ["D:§2", "D:§4 #3"])
m("M-FR-REQUIRED", {"slot": "OUT.required_input", "eq": "全部書かないと進めない"}, [
    {"type": "FR", "key": "FR-REQUIRED", "title": "必須の欄が空のままでは次へ進めない", "plain": "必須の欄を書かないと次へ進めないようにする", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "output", "ac": "空欄や仮の文字（…など）のままでは完了にならない"}], ["D:依頼16", "D:依頼26"])
m("M-FR-PROGRESS", {"slot": "OUT.progress_guide", "eq": True}, [
    {"type": "FR", "key": "FR-PROGRESS", "title": "進み具合に合わせて、次にやることを案内する", "plain": "進み具合に合わせて「次はこれ」と案内する", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "output", "ac": "まだ終えていない段階の案内が、終えた後に出ない"}], ["D:依頼28"])
m("M-FR-FILES", {"slot": "DAT.files", "eq": True}, [{"type": "FR", "key": "FR-FILES", "title": "写真・ファイルを添付して保存できる", "plain": "写真やファイルを付けて残せる", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "data"}], ["zip:Q-DAT"])
m("M-FR-TOCNEXT", K("TOC.next_action"), [{"type": "FR", "key": "FR-NEXT", "title": "使い終わった人を「{{TOC.next_action}}」へ案内する", "plain": "使い終わった人に「{{TOC.next_action}}」をすすめる画面を出す", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "toc", "ac": "最後の画面を閉じても、案内を見逃さない"}], ["D:依頼11", "D:依頼14"])
m("M-FR-FREE", {"slot": "TOC.free_paid", "eq": "無料版を別に作る"}, [{"type": "FR", "key": "FR-TRIAL", "title": "無料の体験版を別に用意する（本番へ引き継げる）", "plain": "無料で試せる体験版を別に作り、書いた内容は本番へ引き継げる", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "toc"}], ["D:依頼08"])
m("M-FR-ADMIN", {"slot": "ROLE.admin_ops", "has": "$param"}, [{"type": "FR", "key": "FR-ADMIN-{{param}}", "title": "管理する人が「{{param}}」をできる", "plain": "管理する人が「{{param}}」をできるようにする", "origin": "customer", "confirm": False, "parent": "BR-GOAL", "topic": "roles"}], ["B:§3"], forEach="ROLE.admin_ops")
m("M-FR-OPVIEW", {"slot": "ROLE.operator_view", "in": ["見る必要がある", "まとめた数字だけ見たい"]}, [{"type": "FR", "key": "FR-OPVIEW", "title": "運営側が利用者の入力を{{ROLE.operator_view}}", "plain": "運営側が、利用者が入力した内容を{{ROLE.operator_view}}", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "roles"}], ["zip:04 K-06"])
m("M-FR-AI", {"all": [{"slot": "AI.want", "has": "$param"}, {"not": {"slot": "AI.want", "has": "AIは使わない"}}]}, [
    {"type": "FR", "key": "FR-AI-{{param}}", "title": "AIによる「{{param}}」（確認する人：{{AI.checker}}）", "plain": "「{{param}}」をAIに任せ、結果は{{AI.checker}}が確かめる", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "ai", "ac": "良い例・悪い例（{{AI.quality_example}}）に照らして合格の出力になる"}], ["D:依頼01", "D:§4 #10 #11"], forEach="AI.want")
m("M-INT", {"all": [{"slot": "INT.systems", "has": "$param"}, {"not": {"slot": "INT.systems", "has": "なし"}}]}, [
    {"type": "INT", "key": "INT-{{param}}", "title": "「{{param}}」とつなぐ（向き：{{INT.direction}}、タイミング：{{INT.timing}}）", "plain": "「{{param}}」と情報をやり取りする（{{INT.direction}}）", "origin": "customer", "confirm": True, "parent": "BR-GOAL", "topic": "integration"}], ["B:§9", "zip:INT.*"], forEach="INT.systems")
m("M-MIG", {"slot": "MIG.existing_data", "in": ["移す", "一部だけ移す"]}, [
    {"type": "MIG", "key": "MIG-01", "title": "今ある情報を新しい仕組みへ移す（{{MIG.existing_data}}、整い具合：{{MIG.data_quality}}）", "plain": "今ある情報を新しい仕組みへ{{MIG.existing_data}}", "origin": "customer", "confirm": True, "topic": "migration", "ac": "移した件数と元の件数が一致する"}], ["zip:13_移行導入"])

# ---- 業務プロセス・ルール ----
m("M-BP-01", K("ASIS.steps"), [{"type": "BP", "key": "BP-ASIS", "title": "今の流れ（実際の一件）：{{ASIS.steps}}", "plain": "今の流れは「{{ASIS.steps}}」の順になっている", "origin": "customer", "confirm": True}], ["STD:BABOK", "B:§4"])
m("M-BP-02", K("TOBE.change"), [{"type": "BP", "key": "BP-TOBE", "title": "変えたい段階：{{TOBE.change}}（変えたくないこと：{{TOBE.keep}}）", "plain": "「{{TOBE.change}}」を変えたい", "origin": "customer", "confirm": True, "parent": "BR-01"}], ["STD:As-Is/To-Be"])
m("M-RULE-01", K("RULE.calc_detail"), [{"type": "RULE", "key": "RULE-CALC", "title": "計算・判定のルール：{{RULE.calc_detail}}", "origin": "customer"}], ["zip:RULE.*"])
m("M-RULE-02", K("RULE.exceptions"), [{"type": "RULE", "key": "RULE-EXC", "title": "例外の対応：{{RULE.exceptions}}（頻度：{{RULE.exception_freq}}）", "plain": "いつもと違う対応として「{{RULE.exceptions}}」がある", "origin": "customer", "confirm": True}], ["C:原則10 例外を削らない", "zip:06_ルール例外"])
m("M-RULE-03", {"slot": "RULE.deadlines", "eq": True}, [{"type": "RULE", "key": "RULE-DEADLINE", "title": "期限・締め日のルールがある（中身はFDEが確認）", "origin": "rule"}], ["zip:RULE.*"])

# ---- データ ----
m("M-ENT", {"slot": "DAT.things", "has": "$param"}, [
    {"type": "ENT", "key": "ENT-{{param}}", "title": "{{paramLabel}}（件数 {{P.count}}・増え方 {{P.growth}}・見分け方 {{P.id}}・正本 {{P.master}}）", "plain": "「{{paramLabel}}」の情報を扱う（全部で{{P.count}}）", "origin": "customer", "confirm": True, "topic": "data",
     "trace": ["DAT.things", "DAT.{param}.count", "DAT.{param}.id", "DAT.{param}.growth"]}], ["B:§5", "zip:03 第2部"], forEach="DAT.things")
m("M-ATTR", {"slot": "DAT.{param}.attrs", "known": True}, [{"type": "ATTR", "key": "ATTR-{{param}}", "title": "{{paramLabel}}の項目：{{P.attrs}}", "origin": "customer", "parent": "ENT-{{param}}"}], ["B:§5"], forEach="DAT.things")
m("M-ID-NONE", {"slot": "DAT.{param}.id", "eq": "見分ける方法がない"}, [{"type": "ATTR", "key": "ATTR-ID-{{param}}", "title": "{{paramLabel}}に番号を新しく付ける（提案・未確認）", "plain": "「{{paramLabel}}」に、見分けるための番号を新しく付ける", "origin": "rule", "confirm": True, "parent": "ENT-{{param}}"}], ["zip:03 推定ルール"], forEach="DAT.things")
m("M-STATE", {"slot": "DAT.{param}.status", "eq": True}, [{"type": "STATE", "key": "STATE-{{param}}", "title": "{{paramLabel}}に状態を持たせる（例：受付 → 対応中 → 完了。状態の一覧はFDEが確認）", "origin": "rule", "parent": "ENT-{{param}}"}], ["B:§5 状態遷移"], forEach="DAT.things")
for r in ent["relations"]:
    a, b = ent["types"][r["a"]]["label"], ent["types"][r["b"]]["label"]
    m("M-" + r["slot"].replace(".", "-"), K(r["slot"]), [{"type": "REL", "key": "REL-" + r["a"] + "-" + r["b"], "title": a + " と " + b + "：{{" + r["slot"] + "}}（想定の対応：" + r["card"] + "。回答により確定）", "origin": "customer"}], ["B:§5", "zip:03 第2部"])
m("M-PII", {"slot": "DAT.pii", "hasAny": ["名前", "連絡先", "住所", "生年月日", "お金・口座", "健康・病歴", "本人の考え・悩み"]}, [
    {"type": "NFR", "key": "NFR-PII", "title": "個人の情報（{{DAT.pii}}）を扱う：利用目的・保存期間（{{DAT.retention}}）・見られる人・外部送信（{{NFR.external_send}}）を決める", "plain": "{{DAT.pii}}を扱うので、残す期間は{{DAT.retention}}、外部のサービスへは「{{NFR.external_send}}」とする", "origin": "rule", "confirm": True, "topic": "nfr", "moscow": "Must"}], ["zip:03 R06", "STD:個人情報保護法（要専門確認）"])
m("M-HIST", {"slot": "DAT.history", "in": ["必要", "あると良い"]}, [{"type": "NFR", "key": "NFR-HISTORY", "title": "誰がいつ何を変えたかの記録を残す（{{DAT.history}}）", "plain": "誰がいつ何を変えたかを記録する", "origin": "customer", "confirm": True, "topic": "nfr"}], ["B:§8 監査可能性"])

# ---- 使う人・見える範囲 ----
m("M-ROLE", {"slot": "ROLE.list", "has": "$param"}, [{"type": "ROLE", "key": "ROLE-{{param}}", "title": "立場：{{param}}", "origin": "customer"}], ["B:§3"], forEach="ROLE.list")
for col, word in [("変える", "見る・変える"), ("見る", "見るだけ"), ("なし", "見せない")]:
    m("M-PERM-" + col, {"slot": "ROLE.matrix", "at": "$param", "eq": col}, [{"type": "PERM", "key": "PERM-{{param}}", "title": "「{{param}}」は" + word, "plain": "「{{param}}」は、情報を" + word, "origin": "customer", "confirm": True, "parent": "ROLE-{{param}}"}], ["B:§3", "STD:RBAC"], forEach="ROLE.list")
m("M-PERM-ROW", {"slot": "ROLE.see_scope", "eq": "自分の分だけ"}, [{"type": "PERM", "key": "PERM-ROW", "title": "利用者は自分の情報だけを見られる（行単位の制限）", "plain": "使う人は、自分の情報だけを見られる", "origin": "customer", "confirm": True, "moscow": "Must", "ac": "別の人のURLやIDを入れても、他人の情報は表示されない"}], ["B:§3", "zip:04 K-03"])
m("M-PERM-EDIT", K("ROLE.edit_scope"), [{"type": "PERM", "key": "PERM-EDIT", "title": "変更できる人：{{ROLE.edit_scope}}", "plain": "情報を変えられるのは「{{ROLE.edit_scope}}」", "origin": "customer", "confirm": True}], ["B:§3"])

# ---- 非機能 ----
m("M-NFR-SCALE", K("NFR.users_total"), [{"type": "NFR", "key": "NFR-SCALE", "title": "利用規模：{{NFR.users_total}}（同時 {{NFR.concurrency}}、1年後 {{NFR.users_growth}}）", "plain": "使う人は{{NFR.users_total}}、同時に使うのは{{NFR.concurrency}}くらい", "origin": "customer", "confirm": True, "topic": "nfr"}], ["zip:04 判断軸", "STD:ISO/IEC 25010"])
m("M-NFR-AVAIL", K("NFR.downtime"), [{"type": "NFR", "key": "NFR-AVAIL", "title": "止まったときに待てる時間：{{NFR.downtime}}（使う時間帯：{{NFR.usage_hours}}）", "plain": "止まっても{{NFR.downtime}}", "origin": "customer", "confirm": True, "topic": "nfr"}], ["zip:04 判断軸"])
m("M-NFR-SEC", K("NFR.sensitivity"), [{"type": "NFR", "key": "NFR-SEC", "title": "情報が漏れたときの影響：{{NFR.sensitivity}}", "plain": "この情報が漏れると「{{NFR.sensitivity}}」", "origin": "customer", "confirm": True, "topic": "nfr"}], ["zip:04 判断軸", "STD:OWASP ASVS（要確認）"])
m("M-NFR-EXT", K("NFR.external_send"), [{"type": "NFR", "key": "NFR-EXT", "title": "外部サービス（AI等）への送信：{{NFR.external_send}}", "plain": "情報を外部のサービス（AIなど）へは「{{NFR.external_send}}」", "origin": "customer", "confirm": True, "topic": "nfr", "moscow": "Must"}], ["zip:Q-AI-004"])
m("M-NFR-DEVICE", K("OUT.devices"), [{"type": "NFR", "key": "NFR-DEVICE", "title": "使う端末：{{OUT.devices}}", "plain": "{{OUT.devices}}で使えるようにする", "origin": "customer", "confirm": True, "topic": "output", "ac": "{{OUT.devices}}の画面幅で、横にはみ出さず最後まで操作できる"}], ["D:依頼01", "D:§4 #4"])
m("M-NFR-LINE", {"slot": "OUT.open_from", "eq": "LINE"}, [{"type": "NFR", "key": "NFR-INAPP", "title": "LINEの中のブラウザで開いても使える（端末ごとに外のブラウザで開く手順を案内）", "plain": "LINEから開いても使えるようにし、iPhone・Android・パソコンそれぞれの開き方を案内する", "origin": "rule", "confirm": True, "topic": "toc"}], ["D:依頼13"])
m("M-NFR-AUDIT", {"slot": "NFR.audit", "eq": "必要"}, [{"type": "NFR", "key": "NFR-AUDIT", "title": "監査に耐える記録（操作記録・保存期間）が必要", "origin": "customer", "topic": "nfr"}], ["B:§8"])
m("M-NFR-OFFLINE", {"slot": "NFR.offline", "eq": True}, [{"type": "NFR", "key": "NFR-OFFLINE", "title": "電波のない場所でも入力でき、つながったら送る", "plain": "電波がない場所でも使えるようにする", "origin": "customer", "confirm": True, "topic": "nfr"}], ["zip:04 C類型"])

# ---- 出力の決まり・公開 ----
m("M-ADR-PUB", K("OUT.publish"), [{"type": "ADR", "key": "ADR-PUBLISH", "title": "公開のしかた：{{OUT.publish}}", "plain": "公開のしかたは「{{OUT.publish}}」", "origin": "customer", "confirm": True}], ["D:依頼15", "D:§4 #1"])
m("M-AC-01", K("AC.done_definition"), [{"type": "AC", "key": "AC-DONE", "title": "完成の状態：{{AC.done_definition}}（確かめ方：{{AC.check_method}}）", "plain": "「{{AC.done_definition}}」ができたら完成とし、{{AC.check_method}}で確かめる", "origin": "customer", "confirm": True}], ["B:§4.3 受け入れ基準", "D:§4 #19"])
m("M-AC-02", K("AC.feedback_style"), [{"type": "CON", "key": "CON-FEEDBACK", "title": "修正の伝え方：{{AC.feedback_style}}（意見が違うときの優先：{{PRJ.review_priority}}）", "origin": "customer"}], ["D:§4 #16", "D:依頼26"])
m("M-CR", {"slot": "CR.kind", "has": "$param"}, [{"type": "CR", "key": "CR-{{param}}", "title": "修正依頼：{{param}}（急ぎ：{{CR.urgency}}・場所：{{CR.where}}・既存の決定と：{{CR.conflict}}）", "origin": "customer"}], ["D:§3", "zip:15_変更要求"], forEach="CR.kind")

json.dump(M, open(os.path.join(ROOT, 'data/rules/mappings.json'), 'w'), ensure_ascii=False, indent=1)
print(len(M), 'mappings')
