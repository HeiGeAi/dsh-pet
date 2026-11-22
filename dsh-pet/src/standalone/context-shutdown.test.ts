/**
 * 独立模式伪 ctx 的「停机能力」测试（issue #178：托盘退出）。
 *
 * 纯函数层：`createStandaloneContext({ shutdown })` 必须把能力以 `shutdownApp` 挂到 ctx 上，
 * 且只在传入时挂——DSH 宿主用的是真 ctx，这条字段缺席正是「托盘不显示退出」的依据
 * （宿主路由 /quit 按 `typeof ctx.shutdownApp === 'function'` 判 canQuit）。
 *
 * 停机本身仍走 cli.ts 已有的 `/shutdown` 收尾，这里不重复测那条路径。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

import { setDefaultLogger } from '../host/log-file.ts';
import { createHostSetup, type HostSetupContext } from '../host/plugin/setup.ts';
import { createStandaloneContext } from './context.ts';
import type { StandaloneLogger } from './context.ts';

const silentLogger: StandaloneLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('standalone 伪 ctx 的停机能力（托盘退出）', () => {
  test('传入 shutdown → ctx.shutdownApp 可调用，且原样透传 reason', () => {
    const reasons: string[] = [];
    const sc = createStandaloneContext({
      port: 0,
      logger: silentLogger,
      shutdown: (reason) => reasons.push(reason),
    });
    const shutdownApp = (sc.ctx as { shutdownApp?: (reason: string) => void }).shutdownApp;
    assert.equal(typeof shutdownApp, 'function', '传入 shutdown 时必须挂出 shutdownApp');
    shutdownApp?.('托盘退出');
    assert.deepEqual(reasons, ['托盘退出']);
  });

  test('不传 shutdown → 不挂该字段（DSH 侧与旧调用方行为不变）', () => {
    const sc = createStandaloneContext({ port: 0, logger: silentLogger });
    assert.equal('shutdownApp' in sc.ctx, false, '没有停机能力时不得凭空造一个');
  });
});

test('context disposal waits for plugin log writes', async (t) => {
  const context = createStandaloneContext({ port: 0, logger: silentLogger });
  const { log } = createHostSetup(context.ctx as unknown as HostSetupContext);
  t.after(() => {
    log.dispose();
    setDefaultLogger(null);
  });
  let resolve = (): void => {};
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  const flush = t.mock.method(log, 'flush', () => promise);
  let disposed = false;
  const teardown = context.dispose().then(() => {
    disposed = true;
  });
  try {
    await setImmediate();
    assert.equal(flush.mock.callCount(), 1);
    assert.equal(disposed, false, 'temporary storage must remain available until log writes finish');
  } finally {
    resolve();
    await teardown;
  }
});
