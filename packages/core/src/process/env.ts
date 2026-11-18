/**
 * The environment a child process gets: bonaparte's, without anything that
 * looks like a secret — an API key, a token, a password (security rule 10).
 * A crash report, a verbose log or a command the model runs could print it.
 */

/** Names that hold a secret, wherever the word stands in them: `PGPASSWORD`, `OPENAI_APIKEY`, `MYSQL_PWD`. */
const SECRET_WORD = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|PWD|CONNECTION_?STRING/i;
/**
 * Short words that are a secret only as a word of their own: `GITHUB_PAT`, `DB_PASS`, `SENTRY_DSN`,
 * `NPM_CONFIG__AUTH`, and `PW` at the end (`DB_PW`) — not `PATH`, `PASSAGE`, `GIT_AUTHOR_NAME`, nor
 * Playwright's `PW_*` settings.
 */
const SECRET_PART = /(?:^|_)(?:PAT|PASS|DSN|AUTH)(?:_|$)|_PW$/i;
/**
 * The shell's working folders: `PWD` names a place, not a password. `SSH_AUTH_SOCK` names the ssh-agent's socket,
 * not a key: without it a push over SSH cannot sign (audit 13.4).
 */
const NOT_SECRET = /^(?:(?:OLD)?PWD|SSH_AUTH_SOCK)$/i;
/** A value that carries a credential, whatever its name: `scheme://user:password@`, `AccountKey=`. */
const SECRET_VALUE = /:\/\/[^/@\s:]+:[^/@\s]+@|AccountKey=/i;

export function holdsSecret(name: string, value: string): boolean {
  if (SECRET_VALUE.test(value)) return true;
  if (NOT_SECRET.test(name)) return false;
  return SECRET_WORD.test(name) || SECRET_PART.test(name);
}

export function withoutSecrets(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || holdsSecret(name, value)) continue;
    env[name] = value;
  }
  return env;
}
