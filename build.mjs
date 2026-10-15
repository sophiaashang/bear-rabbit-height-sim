// 打包成单文件 dist/index.html（three 与全部代码内联，断网可用）
// three.js (MIT) 的版权与许可声明见 THIRD_PARTY_NOTICES.md（下面 legalComments:'none' 会去掉产物内的声明）
import { build } from 'esbuild';
import fs from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/template.html', 'utf8');
if (!tpl.includes('/*__APP__*/')) throw new Error('模板缺少占位符');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', tpl.replace('/*__APP__*/', () => js));
console.log('dist/index.html', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + 'KB');
