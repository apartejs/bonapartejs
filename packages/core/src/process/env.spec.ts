/**
 * The environment of a child process: bonaparte's, without anything that
 * looks like a secret (security rule 10) — whatever the name's spelling:
 * `PGPASSWORD`, `OPENAI_APIKEY`, `MYSQL_PWD`, `GITHUB_PAT` hold secrets as
 * surely as `OPENAI_API_KEY`. What a command needs stays: the path, the
 * home, the working folder, git's author.
 */

import { describe, expect, it } from 'vitest';
import { withoutSecrets } from './env.js';

describe('withoutSecrets', () => {
  it('drops every variable whose name says it holds a secret, however it is spelled', () => {
    const secrets = [
      'OPENAI_API_KEY',
      'OPENAI_APIKEY',
      'PGPASSWORD',
      'MYSQL_PWD',
      'GITHUB_PAT',
      'GH_TOKEN',
      'NPM_TOKEN',
      'HF_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'AZURE_CLIENT_SECRET',
      'DATABASE_PASSWORD',
      'GPG_PASSPHRASE',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'NPM_CONFIG__AUTH',
      'Api_Key',
    ];
    const kept = withoutSecrets(Object.fromEntries(secrets.map((name) => [name, 'hidden'])));
    expect(kept).toEqual({});
  });

  it('keeps what a command needs', () => {
    const needed = {
      PATH: 'C:\Windows',
      Path: 'C:\Windows',
      PATHEXT: '.EXE',
      PWD: '/home/someone/project',
      OLDPWD: '/home/someone',
      HOME: '/home/someone',
      USERPROFILE: 'C:\Users\someone',
      TEMP: 'C:\Temp',
      SystemRoot: 'C:\Windows',
      LANG: 'fr_FR.UTF-8',
      GIT_AUTHOR_NAME: 'Someone',
      GIT_AUTHOR_EMAIL: 'someone@example.com',
      NODE_ENV: 'development',
    };
    expect(withoutSecrets(needed)).toEqual(needed);
  });

  it('drops the short names and the values that carry a credential', () => {
    const secrets = {
      DB_PASS: 'hunter2',
      SMTP_PASS: 'x',
      DB_PW: 'x',
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=a;AccountKey=b',
      DATABASE_URL: 'postgres://user:pw@db.example.com/app',
      MIRROR: 'https://someone:token@mirror.example.com/',
    };
    expect(withoutSecrets(secrets)).toEqual({});
    const kept = { REGISTRY_URL: 'https://registry.npmjs.org/', PASSAGE: 'x', COMPASS: 'x' };
    expect(withoutSecrets(kept)).toEqual(kept);
  });
});

