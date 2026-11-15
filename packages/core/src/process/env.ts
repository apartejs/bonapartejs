/**
 * The environment a child process gets: bonaparte's, without anything that
 * looks like a secret — an API key, a token, a password (security rule 10).
 * A crash report, a verbose log or a command the model runs could print it.
 */

/** Names that hold a secret, wherever the word stands in them: `PGPASSWORD`, `OPENAI_APIKEY`, `MYSQL_PWD`. */
const SECRET_WORD = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|PWD/i;
/** Short words that are a secret only as a word of their own: `GITHUB_PAT`, `NPM_CONFIG__AUTH` — not `PATH`, not `GIT_AUTHOR_NAME`. */
const SECRET_PART = /(?:^|_)(?:PAT|AUTH)(?:_|$)/i;
/** The shell's working folders: `PWD` names a place, not a password. */
const NOT_SECRET = /^(?:OLD)?PWD$/i;

function holdsSecret(name: string): boolean {
  if (NOT_SECRET.test(name)) return false;
  return SECRET_WORD.test(name) || SECRET_PART.test(name);
}

export function withoutSecrets(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || holdsSecret(name)) continue;
    env[name] = value;
  }
  return env;
}
