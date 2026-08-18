/**
 * CLI bonaparte — point d'entrée `npx @aparte/bonaparte`.
 * v1 : `doctor` (vérification des dépendances machine) et lancement de l'app.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const HELP = `('.') bonaparte v${version}

Usage:
  bonaparte            Lance l'application (bientôt)
  bonaparte doctor     Vérifie les dépendances machine (bientôt)
  bonaparte --version  Affiche la version
  bonaparte --help     Affiche cette aide
`;

async function main(): Promise<number> {
  const arg = process.argv[2];

  switch (arg) {
    case '--version':
    case '-v':
      console.log(version);
      return 0;
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      return 0;
    case 'doctor':
      console.error('doctor: pas encore implémenté (J1-2).');
      return 1;
    default:
      console.error(`Commande inconnue : ${arg}\n`);
      console.log(HELP);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
