/**
 * The built-in browser's sessions (the browser redo, step 2): one factory makes every one, and every one it makes
 * carries the four guards — no permission, no download, every request judged, where each answered from heard.
 * The person's tabs keep theirs; the agent has one per project, never the person's (Paul, 2026-11-20).
 */

import { describe, expect, it } from 'vitest';
import { AGENT_MEMORY_PARTITION, PERSON_PARTITION, browserSessions, partitionOf, type SessionLike } from './sessions.js';

interface FakeSession extends SessionLike {
  partition: string;
  permission?: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void;
  download?: (event: { preventDefault(): void }) => void;
  beforeRequest?: (details: { url: string; webContentsId?: number }, callback: (response: { cancel?: boolean }) => void) => void;
  beforeRedirect?: (details: { url: string; webContentsId?: number; ip?: string }) => void;
  completed?: (details: { url: string; webContentsId?: number; ip?: string }) => void;
}

function fakeSession(partition: string): FakeSession {
  const session: FakeSession = {
    partition,
    setPermissionRequestHandler: (handler) => void (session.permission = handler),
    on: (_event, listener) => void (session.download = listener),
    webRequest: {
      onBeforeRequest: (listener) => void (session.beforeRequest = listener),
      onBeforeRedirect: (listener) => void (session.beforeRedirect = listener),
      onCompleted: (listener) => void (session.completed = listener),
    },
    resolveProxy: async (url) => (url.includes('proxied') ? 'PROXY 10.0.0.1:3128' : 'DIRECT'),
  };
  return session;
}

function rig() {
  const made: FakeSession[] = [];
  const asked: [number, string][] = [];
  const heard: [number, string][] = [];
  const sessionFor = browserSessions({
    fromPartition: (partition) => {
      const session = fakeSession(partition);
      made.push(session);
      return session;
    },
    guards: {
      blocked: async (webContentsId, url) => {
        asked.push([webContentsId, url]);
        return url.includes('10.0.0.5');
      },
      responded: (webContentsId, ip) => void heard.push([webContentsId, ip]),
    },
  });
  return { sessionFor, made, asked, heard };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the browser’s sessions (the browser redo, step 2)', () => {
  it('the person’s tabs keep their own session; the agent has one per project, kept, or one in memory without a project', () => {
    expect(partitionOf('person')).toBe(PERSON_PARTITION);
    expect(PERSON_PARTITION).toBe('persist:bonaparte-browser');
    expect(partitionOf({ conversationId: 'c1', projectId: 'p1' })).toBe('persist:bonaparte-agent-p1');
    expect(partitionOf({ conversationId: 'c2', projectId: 'p1' })).toBe('persist:bonaparte-agent-p1');
    expect(partitionOf({ conversationId: 'c3' })).toBe(AGENT_MEMORY_PARTITION);
    expect(AGENT_MEMORY_PARTITION).toBe('bonaparte-agent');
    // Never the person's, whatever a project is called.
    expect(partitionOf({ conversationId: 'c4', projectId: '../bonaparte-browser' })).not.toBe(PERSON_PARTITION);
    expect(partitionOf({ conversationId: 'c4', projectId: '../bonaparte-browser' })).toMatch(/^persist:bonaparte-agent-[A-Za-z0-9_-]+$|^bonaparte-agent$/);
  });

  it('every partition it makes carries the four guards, put on once', async () => {
    const { sessionFor, made, asked, heard } = rig();
    for (const partition of [PERSON_PARTITION, 'persist:bonaparte-agent-p1', AGENT_MEMORY_PARTITION]) sessionFor(partition);
    // The same partition again is the same session: its guards are not put twice.
    expect(sessionFor('persist:bonaparte-agent-p1')).toBe(made[1]);
    expect(made.map((session) => session.partition)).toEqual([PERSON_PARTITION, 'persist:bonaparte-agent-p1', AGENT_MEMORY_PARTITION]);
    for (const session of made) {
      // No permission, ever.
      let granted: boolean | undefined;
      session.permission!(null, 'media', (answer) => (granted = answer));
      expect(granted).toBe(false);
      // No download.
      let prevented = false;
      session.download!({ preventDefault: () => (prevented = true) });
      expect(prevented).toBe(true);
      // Every request of a page judged; one of no page passes.
      const answers: { cancel?: boolean }[] = [];
      session.beforeRequest!({ url: 'http://10.0.0.5/', webContentsId: 7 }, (response) => answers.push(response));
      session.beforeRequest!({ url: 'https://example.com/', webContentsId: 7 }, (response) => answers.push(response));
      session.beforeRequest!({ url: 'http://10.0.0.5/' }, (response) => answers.push(response));
      await flush();
      // The request of no page is answered at once; the others once judged.
      expect(answers).toEqual([{}, { cancel: true }, { cancel: false }]);
      // Where a response came from, heard on a redirect and at its end — only from a direct connection.
      session.beforeRedirect!({ url: 'http://a.example/', webContentsId: 7, ip: '192.168.1.1' });
      session.completed!({ url: 'http://b.example/', webContentsId: 7, ip: '93.184.216.34' });
      session.completed!({ url: 'http://proxied.example/', webContentsId: 7, ip: '10.0.0.1' });
      await flush();
    }
    expect(asked).toHaveLength(6);
    expect(heard).toEqual(made.flatMap(() => [[7, '192.168.1.1'], [7, '93.184.216.34']]));
  });
});
