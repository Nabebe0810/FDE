#!/usr/bin/env node
/* bundle.js — index.html と CSS・JS を1つの HTML にまとめる（dist/fde-hearing.html）。
 * ファイルを開くだけで動く（サーバー不要・通信なし）。Claude の Artifacts 等にもそのまま置ける。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => '<style>\n' + fs.readFileSync(path.join(ROOT, p), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => '<script>\n' + fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/fde-hearing.html'), html);
console.log('書き出し: dist/fde-hearing.html (' + Math.round(html.length / 1024) + 'KB)');
