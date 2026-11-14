/** Rebuild portrait assets. Requires python3 and Pillow 13.0.0; see favicon-source.md. */
const args = Bun.argv.slice(2);
if (args.some((arg) => arg !== '--proof')) {
  console.error('Usage: bun apps/site/scripts/favicon.ts [--proof]');
  process.exit(1);
}
const child = Bun.spawn(['python3', '-B', `${import.meta.dir}/favicon.py`, ...args], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);
