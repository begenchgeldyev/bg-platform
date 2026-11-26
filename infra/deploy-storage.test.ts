import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const workflow = Bun.YAML.parse(await Bun.file(new URL('../.github/workflows/deploy.yml', import.meta.url)).text()) as {
  jobs: { deploy: { steps: { with?: { script?: string } }[] } };
};
const script = workflow.jobs.deploy.steps.find((step) => step.with?.script)?.with?.script;
if (!script) throw new Error('Missing remote deployment script');
const remote = script.match(/<<'DEPLOY'\n([\s\S]*)\nDEPLOY\s*$/)?.[1];
if (!remote) throw new Error('Missing remote Bash heredoc');
const gitVerification = remote.indexOf('  git_repo cat-file');
if (gitVerification < 0) throw new Error('Missing end of Git preflight snippet');
const preflight = remote.slice(0, gitVerification).replace('REPO=/opt/apps/begenchgeldyev-website', 'REPO="$TEST_REPO"');

let directory: string;

beforeAll(async () => {
  const temporary = Bun.spawnSync(['mktemp', '-d', `${Bun.env.TMPDIR ?? '/tmp'}/deploy-storage.XXXXXX`]);
  expect(temporary.exitCode).toBe(0);
  directory = temporary.stdout.toString().trim();
  expect(Bun.spawnSync(['mkdir', '-p', `${directory}/bin`, `${directory}/repo/.git`]).exitCode).toBe(0);
  await Bun.write(
    `${directory}/bin/df`,
    `#!/bin/bash
printf '%s|%s\\n' "$1" "$2" >> "$DF_CALLS"
case "$1" in
  -Pk) printf '%s\\n' "$DF_BLOCKS"; exit "\${DF_BLOCKS_EXIT:-0}" ;;
  -Pi) printf '%s\\n' "$DF_INODES"; exit "\${DF_INODES_EXIT:-0}" ;;
  *) exit 99 ;;
esac
`,
  );
  for (const command of ['git', 'docker']) {
    await Bun.write(`${directory}/bin/${command}`, `#!/bin/bash\nprintf '%s\\n' "$*" >> "$${command.toUpperCase()}_CALLS"\n`);
  }
  expect(Bun.spawnSync(['chmod', '+x', `${directory}/bin/df`, `${directory}/bin/git`, `${directory}/bin/docker`]).exitCode).toBe(0);
});

afterAll(() => {
  if (directory?.includes('/deploy-storage.')) {
    expect(Bun.spawnSync(['rm', '-rf', '--', directory]).exitCode).toBe(0);
  }
});

function dfOutput(available: string, inodes = false) {
  return `Filesystem ${inodes ? 'Inodes IUsed IFree IUse%' : '1024-blocks Used Available Capacity'} Mounted on\n/dev/root 4000000 1000000 ${available} 25% /`;
}

async function runPreflight(
  options: { blocks?: string; inodes?: string; blocksExit?: number; inodesExit?: number; integration?: boolean } = {},
) {
  await Promise.all(['df', 'git', 'docker'].map((command) => Bun.write(`${directory}/${command}.log`, '')));
  const block = remote.match(/^ {2}check_deploy_storage\(\) \{[\s\S]*?^ {2}\}/m)?.[0];
  expect(block, 'The inline storage check must exist in the actual production script').toBeDefined();
  const source = options.integration ? preflight : `set -euo pipefail\n${block}\ncheck_deploy_storage "$TEST_REPO"`;
  if (!source) throw new Error('Missing deployment preflight');
  const result = Bun.spawnSync(['bash', '-c', source], {
    env: {
      ...process.env,
      PATH: `${directory}/bin:${process.env.PATH}`,
      TEST_REPO: `${directory}/repo`,
      GIT_SHA: 'a'.repeat(40),
      DF_BLOCKS: options.blocks ?? dfOutput('2097152'),
      DF_INODES: options.inodes ?? dfOutput('2048', true),
      DF_BLOCKS_EXIT: String(options.blocksExit ?? 0),
      DF_INODES_EXIT: String(options.inodesExit ?? 0),
      DF_CALLS: `${directory}/df.log`,
      GIT_CALLS: `${directory}/git.log`,
      DOCKER_CALLS: `${directory}/docker.log`,
    },
  });
  return {
    exitCode: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
    dfCalls: await Bun.file(`${directory}/df.log`).text(),
    gitCalls: await Bun.file(`${directory}/git.log`).text(),
  };
}

describe('inline deployment storage preflight', () => {
  for (const [name, blocks, inodes, allowed] of [
    ['zero free space', '0', '2048', false],
    ['below 1 GiB', '1048575', '2048', false],
    ['exactly both thresholds', '1048576', '1024', true],
    ['enough storage', '2097152', '2048', true],
    ['insufficient free inodes', '2097152', '1023', false],
    ['zero free inodes', '2097152', '0', false],
    ['leading zero numeric values', '001048576', '001024', true],
  ] as const) {
    test(name, async () => {
      const result = await runPreflight({ blocks: dfOutput(blocks), inodes: dfOutput(inodes, true) });
      expect(result.exitCode === 0).toBe(allowed);
      expect(result.output).toContain(`${blocks} KiB`);
      expect(result.output).toContain(`${inodes} free inodes`);
      expect(result.output).toContain('1048576 KiB');
      expect(result.output).toContain('1024 free inodes');
      expect(result.dfCalls).toBe(`-Pk|${directory}/repo\n-Pi|${directory}/repo\n`);
      if (!allowed) expect(result.output).toContain('free space/inodes safely before retrying');
    });
  }

  for (const [name, options] of [
    ['block df failure despite valid output', { blocksExit: 1 }],
    ['inode df failure despite valid output', { inodesExit: 1 }],
    ['malformed available blocks', { blocks: dfOutput('unknown') }],
    ['malformed free inodes', { inodes: dfOutput('1e6', true) }],
    ['negative available blocks', { blocks: dfOutput('-1') }],
    ['missing df data row', { blocks: 'Filesystem 1024-blocks Used Available Capacity Mounted on' }],
    ['empty df output', { inodes: '' }],
    ['multiple df data rows', { blocks: `${dfOutput('2097152')}\n/dev/other 4000000 1000000 2097152 25% /other` }],
  ] as const) {
    test(`fails closed on ${name}`, async () => {
      const result = await runPreflight({ ...options, integration: true });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain('Deployment storage preflight failed');
      expect(result.output).toContain('1048576 KiB');
      expect(result.output).toContain('1024 free inodes');
      expect(result.gitCalls).toBe('');
    });
  }

  test('full filesystem stops the production snippet before any Git invocation', async () => {
    const result = await runPreflight({ blocks: dfOutput('0'), integration: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('0 KiB');
    expect(result.gitCalls).toBe('');
  });

  test('sufficient storage lets the production snippet reach Git configuration and fetch', async () => {
    const result = await runPreflight({ integration: true });
    expect(result.exitCode).toBe(0);
    expect(result.gitCalls).toContain('remote set-url origin https://github.com/begenchgeldyev/bg-platform.git');
    expect(result.gitCalls).toContain('fetch --prune origin main');
  });
});
