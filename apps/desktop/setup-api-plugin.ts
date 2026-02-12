import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Connect, Plugin } from 'vite';

import {
  type ManualActionEvent,
  type RetryStepPayload,
  SetupService,
  type SetupLogEntry,
  type SetupSnapshot,
  type SetupState,
  type SkipManualCheckPayload,
  type StartStepPayload,
} from './setup-service';

type FatalErrorPayload = { message: string };

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function serializeSseMessage(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function setupApiPlugin(): Plugin {
  const service = new SetupService(process.cwd());
  const clients = new Set<ServerResponse>();

  const broadcast = (event: string, payload: unknown): void => {
    const message = serializeSseMessage(event, payload);
    for (const client of clients) {
      client.write(message);
    }
  };

  service.on('setup://log', (payload: SetupLogEntry) => {
    broadcast('setup://log', payload);
  });

  service.on('setup://step-status', (payload: SetupState) => {
    broadcast('setup://step-status', payload);
  });

  service.on('setup://requires-user-action', (payload: ManualActionEvent) => {
    broadcast('setup://requires-user-action', payload);
  });

  service.on('setup://fatal-error', (payload: FatalErrorPayload) => {
    broadcast('setup://fatal-error', payload);
  });

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ): Promise<void> => {
    const method = req.method?.toUpperCase();
    if (!method) {
      next();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/setup/events') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      res.write(': connected\n\n');

      clients.add(res);

      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });

      return;
    }

    try {
      if (method === 'GET' && pathname === '/api/setup/state') {
        sendJson(res, 200, service.getState() satisfies SetupState);
        return;
      }

      if (method === 'GET' && pathname === '/api/setup/snapshot') {
        sendJson(res, 200, service.getSnapshot() satisfies SetupSnapshot);
        return;
      }

      if (method === 'POST' && pathname === '/api/setup/start-step') {
        const raw = (await readJsonBody(req)) as {
          payload?: StartStepPayload;
        };
        const payload = raw.payload ?? (raw as StartStepPayload);
        const state = await service.startStep(payload);
        sendJson(res, 200, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/setup/retry-step') {
        const raw = (await readJsonBody(req)) as {
          payload?: RetryStepPayload;
        };
        const payload = raw.payload ?? (raw as RetryStepPayload);
        const state = await service.retryStep(payload);
        sendJson(res, 200, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/setup/skip-manual-check') {
        const raw = (await readJsonBody(req)) as {
          payload?: SkipManualCheckPayload;
        };
        const payload = raw.payload ?? (raw as SkipManualCheckPayload);
        const state = await service.skipManualCheck(payload);
        sendJson(res, 200, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/setup/cancel') {
        const state = await service.cancel();
        sendJson(res, 200, state);
        return;
      }

      if (method === 'GET' && pathname === '/api/channels/list') {
        const channels = service.getAllChannels();
        sendJson(res, 200, { channels });
        return;
      }

      if (method === 'POST' && pathname === '/api/channels/add') {
        const payload = (await readJsonBody(req)) as {
          channelId: string;
          name: string;
          folder: string;
          trigger: string;
        };
        const result = await service.addChannel(payload);
        sendJson(res, result.success ? 200 : 400, result);
        return;
      }

      if (method === 'POST' && pathname === '/api/channels/delete') {
        const payload = (await readJsonBody(req)) as { channelId: string };
        const result = await service.deleteChannel(payload.channelId);
        sendJson(res, result.success ? 200 : 400, result);
        return;
      }

      if (method === 'POST' && pathname === '/api/channels/update-mounts') {
        const payload = (await readJsonBody(req)) as {
          channelId: string;
          mounts: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
        };
        const result = await service.updateChannelMounts(payload);
        sendJson(res, result.success ? 200 : 400, result);
        return;
      }

      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { message });
    }
  };

  return {
    name: 'nanoclaw-setup-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}
