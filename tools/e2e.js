#!/usr/bin/env node
/*
 * e2e.js — 実ブラウザで通しの回答を自動で行い、表示崩れ・エラー・外部通信を検査する（Playwright が必要）。
 *   node tools/e2e.js [出力フォルダ]
 * スマホ幅（390px）で、各入力形式（テキスト・選択・スライダー・カード仕分け・配分・並べ替え・表）を操作する。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, '..', 'dist', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

async function kindOf(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.card'); if (!c) return 'none';
    if (document.querySelector('.nav.three')) return 'confirm';
    if (c.querySelector('.tiles')) return 'cards';
    if (c.querySelector('.yn')) return 'yesno';
    if (c.querySelector('.matrix')) return 'matrix';
    if (c.querySelector('.pts')) return 'points';
    if (c.querySelector('.rank')) return 'rank';
    if (c.querySelector('.slider')) return 'slider';
    if (c.querySelector('.chips')) return 'multi';
    if (c.querySelector('ol.steps')) return 'steps';
    if (c.querySelector('select')) return 'select';
    if (c.querySelector('.opts')) return 'single';
    if (c.querySelector('textarea')) return 'longtext';
    if (c.querySelector('input[type=number]')) return 'number';
    if (c.querySelector('input[type=text]')) return 'text';
    return 'other';
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && !r.url().startsWith('https://script.google.com/')) requests.push(r.url()); });
  await page.goto(process.env.PAGE_URL || ('file://' + path.join(__dirname, '..', 'dist', 'fde-hearing.html')));
  await page.waitForTimeout(500);
  await page.fill('#f-title', 'E2E 架空案件');
  await page.click('text=始める');
  const seen = {};
  const shots = new Set();
  let overflow = 0;
  let cards = 0;
  for (let i = 0; i < 200; i++) {
    if (await page.$('text=ありがとうございました')) break;
    const kind = await kindOf(page);
    cards++;
    seen[kind] = (seen[kind] || 0) + 1;
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) overflow++;
    if (!shots.has(kind)) { shots.add(kind); await page.screenshot({ path: path.join(OUT, String(shots.size).padStart(2, '0') + '_' + kind + '.png') }); }
    const card = page.locator('.card');
    switch (kind) {
      case 'cards': await page.locator('.tile').nth(0).click(); await page.locator('.tile').nth(1).click(); await page.click('.nav .go'); break;
      case 'confirm': await page.click('.nav .go'); break;
      case 'yesno': await page.click('.yn .y'); break;
      case 'matrix': {
        const rows = await page.$$('.matrix tbody tr');
        for (const r of rows) await (await r.$$('button'))[0].click();
        await page.click('.nav .go'); break;
      }
      case 'points':
        await page.locator('.pts input[type=range]').nth(0).fill('6');
        await page.locator('.pts input[type=range]').nth(1).fill('4');
        await page.click('.nav .go'); break;
      case 'rank': await page.locator('.rank .chip').nth(0).click(); await page.locator('.rank .chip').nth(0).click(); await page.locator('.rank-item .mv').nth(1).click(); await page.click('.nav .go'); break;
      case 'slider': await page.locator('.ticks button').nth(1).click(); await page.click('.nav .go'); break;
      case 'multi': await page.locator('.chips .chip').first().click(); await page.click('.nav .go'); break;
      case 'steps': {
        const ins = page.locator('ol.steps input');
        await ins.nth(0).fill('電話を受ける'); await ins.nth(1).fill('台帳に書く');
        await page.click('.nav .go'); break;
      }
      case 'select': {
        const v = await page.$eval('.card select', (s) => s.options[1].value);
        await page.selectOption('.card select', v); await page.click('.nav .go'); break;
      }
      case 'single': await page.locator('.opts .opt').first().click(); if (await page.$('input.other')) { await page.fill('input.other', 'ほかの内容'); await page.click('text=これで次へ'); } break;
      case 'longtext': await card.locator('textarea').fill('先週、申込3件を手で転記して1件まちがえた'); await page.click('.nav .go'); break;
      case 'text': await card.locator('input[type=text]').fill('先週の月曜に起きた'); await page.click('.nav .go'); break;
      case 'number': await card.locator('input[type=number]').fill('12'); await page.click('.nav .go'); break;
      default: await page.click('.special button');
    }
    if (i === 4) { await page.click('text=← 戻る'); await page.click('text=最新へ'); }
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '90_done.png') });
  await page.click('text=答えを見直す');
  page.once('dialog', (d) => d.accept('2407')); await page.click('text=担当者用');
  for (const tab of ['要件', '未決定', '仮説・矛盾', '技術候補', '品質', '人間レビュー', '回答・計測', '依頼者理解', '書き出し']) {
    await page.click('.tabs >> text=' + tab);
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.click('.tabs >> text=次の質問の理由');
  await page.screenshot({ path: path.join(OUT, '91_fde.png') });
  const result = { cards, seen, overflowCards: overflow, errors, externalRequests: requests };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result));
  await browser.close();
  if (errors.length || requests.length || overflow) process.exit(1);
})();
