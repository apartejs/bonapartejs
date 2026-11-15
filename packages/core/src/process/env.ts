/**
 * The environment a child process gets: bonaparte's, without anything that
 * looks like a secret — an API key, a token, a password (security rule 10).
 * A crash report, a verbose log or a command the model runs could print it.
 */

/** Names that hold a secret. */
const SECRET_NAME = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)(?:_|$)/i;

export function withoutSecrets(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || SECRET_NAME.test(name)) continue;
    env[name] = value;
  }
  return env;
}
