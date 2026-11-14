import { expect, test } from 'bun:test';

test('portrait assets satisfy the source, mask, palette and reproducibility contract', async () => {
  const process = Bun.spawn(['python3', '-B', `${import.meta.dir}/favicon_test.py`], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  console.log(stdout);
  if (stderr) console.error(stderr);
  expect(exitCode).toBe(0);
}, 30_000);
