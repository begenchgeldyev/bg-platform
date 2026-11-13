// Standalone replay helper; not part of the website application.
import { join } from 'node:path';

const files = new Map([
  ['/files/OpenTUIMono-Regular.woff2', 'files/OpenTUIMono-Regular.woff2'],
  ['/files/OpenTUIMono-Bold.woff2', 'files/OpenTUIMono-Bold.woff2'],
]);
const shim = `<script>window.toggleSelect=function(button){document.querySelectorAll('[data-choice]').forEach(function(item){item.classList.toggle('selected',item===button)});window.selectedChoice=button.dataset.choice};</script>`;

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT) || 8677,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/gallery-options-v3.html') {
      const source = await Bun.file(join(import.meta.dir, 'gallery-options-v3.html')).text();
      return new Response(source.replace('</head>', `${shim}</head>`), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    const file = files.get(path);
    if (file) return new Response(Bun.file(join(import.meta.dir, file)), { headers: { 'Content-Type': 'font/woff2' } });
    return new Response('Not found', { status: 404 });
  },
});
console.log('Prototype replay: http://localhost:8677 (or the selected PORT)');
