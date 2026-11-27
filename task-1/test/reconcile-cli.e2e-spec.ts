import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('reconcile CLI', () => {
  it('exits non-zero and creates nothing when DB_PATH does not exist', () => {
    const missing = path.join(os.tmpdir(), `missing-${Date.now()}`, 'usage.db');
    const res = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', path.join(__dirname, '..', 'src', 'scripts', 'reconcile-cli.ts')],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DB_PATH: missing },
        encoding: 'utf8',
      },
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/database not found/);
    expect(fs.existsSync(missing)).toBe(false);
  });
});
