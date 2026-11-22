/** 将 Claude Code 的本机状态写入独立模式已有的工作状态仓。 */
import { EXTERNAL_WORK_SESSION_PREFIX, type AttachExternalWorkStatus } from '../host/plugin/work-status-bridge.ts';
import { readBody } from '../host/http.ts';
import { HOST_WORK_STATUS_STATES, type HostWorkStatusState } from '../host/work-status.ts';
import type { RegisteredRoute } from './context.ts';
import { rejectRequest } from './request-security.ts';

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIVE_TTL_MS = 30 * 60_000;
const TERMINAL_TTL_MS = 8_000;

export function registerClaudeCodeStatus(routes: RegisteredRoute[]): AttachExternalWorkStatus {
  return ({ workStatus, nextExternalWorkSeq, publishWorkStatus }) => {
    const expirations = new Map<string, ReturnType<typeof setTimeout>>();
    let disposed = false;
    const route: RegisteredRoute = {
      kind: 'exact',
      path: '/claude-code/status',
      async handler(req, res) {
        if (req.method !== 'POST') return rejectRequest(res, 405, '仅支持 POST');
        // 独立服务已鉴权，并将正文放入有界回放流。
        let event: { sessionId?: unknown; state?: unknown } | null;
        try {
          event = JSON.parse(await readBody(req));
        } catch {
          return rejectRequest(res, 400, '无效的 Claude Code 状态');
        }
        const state = event?.state as HostWorkStatusState | null | undefined;
        if (
          typeof event?.sessionId !== 'string' ||
          !SESSION_ID.test(event.sessionId) ||
          (state !== null && (state === undefined || !HOST_WORK_STATUS_STATES.includes(state)))
        )
          return rejectRequest(res, 400, '无效的 Claude Code 状态');
        if (disposed) return rejectRequest(res, 503, '桌宠正在退出');

        const id = `${EXTERNAL_WORK_SESSION_PREFIX}claude-code:${event.sessionId}`;
        clearTimeout(expirations.get(id));
        if (state === null) {
          expirations.delete(id);
          workStatus.clear(id);
        } else {
          workStatus.setState(id, state, nextExternalWorkSeq());
          const ttl = state === 'success' || state === 'error' ? TERMINAL_TTL_MS : ACTIVE_TTL_MS;
          const timer = setTimeout(() => {
            expirations.delete(id);
            if (workStatus.clear(id)) publishWorkStatus();
          }, ttl);
          timer.unref();
          expirations.set(id, timer);
        }
        publishWorkStatus();
        res.writeHead(204);
        res.end();
      },
    };
    routes.push(route);
    return () => {
      if (disposed) return;
      disposed = true;
      const index = routes.indexOf(route);
      if (index >= 0) routes.splice(index, 1);
      for (const [id, timer] of expirations) {
        clearTimeout(timer);
        workStatus.clear(id);
      }
      expirations.clear();
    };
  };
}
