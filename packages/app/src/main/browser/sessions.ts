/**
 * The built-in browser's sessions (the browser redo, step 2). The person's tabs keep their own session; the agent
 * has one per project, kept (`persist:`), or one in memory of its own for a conversation with no project — never
 * the person's: their cookies never serve the agent (Paul, 2026-11-20). Every session comes out of one factory,
 * which puts the four guards on it: no permission, no download, every request judged — in an agent's session, one
 * no page names (a service worker's) too —, and where each answered from heard (audit 13.4). No Electron here:
 * what it needs of a session is said below, and a test gives a fake one.
 */

import { createHash } from 'node:crypto';

/** Who a tab is for: the person, or a conversation's agent (and the project the core knows it in). */
export type TabOwner = 'person' | { conversationId: string; projectId?: string };

/** The person's tabs: kept across launches (Paul, 2026-11-20). */
export const PERSON_PARTITION = 'persist:bonaparte-browser';
/** An agent's tab with no project: in memory, one per conversation, gone at quit (review of step 2). */
const AGENT_MEMORY_PREFIX = 'bonaparte-agent-conversation-';

const SAFE_NAME = /^[A-Za-z0-9_-]{1,128}$/;

/** The partition a tab's session lives in: the person's, its project's — one per project, kept —, or its conversation's. */
export function partitionOf(owner: TabOwner): string {
  if (owner === 'person') return PERSON_PARTITION;
  const { projectId, conversationId } = owner;
  // A project's id is the core's (a UUID); anything else never names a partition, the person's least of all.
  if (projectId && SAFE_NAME.test(projectId)) return `persist:bonaparte-agent-${projectId}`;
  // A conversation's id is the window's (a UUID); another one is named by its hash, never by itself.
  const name = SAFE_NAME.test(conversationId) && !/^h[0-9a-f]{32}$/.test(conversationId)
    ? conversationId
    : `h${createHash('sha256').update(conversationId).digest('hex').slice(0, 32)}`;
  return `${AGENT_MEMORY_PREFIX}${name}`;
}

/** The person's session: every other one is an agent's. */
const isAgentPartition = (partition: string): boolean => partition !== PERSON_PARTITION;

interface RequestDetails {
  url: string;
  webContentsId?: number;
}

/** What the browser uses of an Electron session. */
export interface SessionLike {
  setPermissionRequestHandler(handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void): void;
  on(event: 'will-download', listener: (event: { preventDefault(): void }) => void): void;
  webRequest: {
    onBeforeRequest(listener: (details: RequestDetails, callback: (response: { cancel?: boolean }) => void) => void): void;
    onBeforeRedirect(listener: (details: RequestDetails & { ip?: string }) => void): void;
    onCompleted(listener: (details: RequestDetails & { ip?: string }) => void): void;
  };
  resolveProxy(url: string): Promise<string>;
}

/** What judges a page's requests, and hears where it answered from: the browser's views. */
export interface SessionGuards {
  blocked(webContentsId: number, url: string): Promise<boolean>;
  /** A request no page names (a service worker's), in an agent's session: judged as a page the agent opened. */
  blockedWithoutPage(url: string, partition: string): Promise<boolean>;
  responded(webContentsId: number, ip: string): void;
}

/** The four guards, on one session. */
function guard(session: SessionLike, guards: SessionGuards, partition: string): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.on('will-download', (event) => event.preventDefault());
  // Where Chromium really connected decides what the agent may read; a private address written as one is never asked
  // by a page the agent opened (audit 13.4).
  session.webRequest.onBeforeRequest((details, callback) => {
    if (details.webContentsId === undefined) {
      // The person's session is theirs; in an agent's, a service worker is the agent's page by other means: judged,
      // and cancelled when it cannot be (review of step 2).
      if (!isAgentPartition(partition)) return callback({});
      guards.blockedWithoutPage(details.url, partition).then(
        (cancel) => callback({ cancel }),
        () => callback({ cancel: true }),
      );
      return;
    }
    guards.blocked(details.webContentsId, details.url).then(
      (cancel) => callback({ cancel }),
      () => callback({}),
    );
  });
  // Behind a proxy, the address Electron gives is the proxy's: only a direct connection says where the page is.
  const responded = (details: RequestDetails & { ip?: string }): void => {
    const { webContentsId, ip } = details;
    if (webContentsId === undefined || !ip) return;
    void session.resolveProxy(details.url).then(
      (proxy) => {
        if (proxy.trim().toUpperCase() === 'DIRECT') guards.responded(webContentsId, ip);
      },
      () => undefined,
    );
  };
  // The address a request was really sent to: Electron says it once the response is over, or at a redirect.
  session.webRequest.onBeforeRedirect((details) => responded(details));
  session.webRequest.onCompleted((details) => responded(details));
}

/** The one factory of the browser's sessions: each partition made once, its guards put on it then. */
export function browserSessions<S>(options: { fromPartition(partition: string): S; guards: SessionGuards }): (partition: string) => S {
  const made = new Map<string, S>();
  return (partition) => {
    const known = made.get(partition);
    if (known) return known;
    const session = options.fromPartition(partition);
    guard(session as unknown as SessionLike, options.guards, partition);
    made.set(partition, session);
    return session;
  };
}
