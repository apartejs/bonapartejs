/**
 * Where the app lives, as the window sees it. The pages of the window and the
 * agent endpoint share one origin, so a turn needs no CORS in the packaged app.
 */

/** The custom scheme Electron serves the app from. */
export const APP_SCHEME = 'bonaparte';

/** The origin of the window's pages. */
export const APP_ORIGIN = 'bonaparte://app';

/** Where the window posts a turn: `bonaparte://app/agent/c/<conversation>`. */
export const AGENT_ENDPOINT = `${APP_ORIGIN}/agent`;
