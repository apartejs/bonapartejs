/**
 * The app's own update that cannot be checked is said in « Mises à jour », in words (audit 2026-11-21, N4): a private
 * repository sends the person to the releases, never « erreur inconnue ».
 */

import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.js';
import { fr } from '../i18n/fr.js';
import { appCheckLine } from './app-check.js';

describe('why the app’s update could not be checked, in words', () => {
  it('a private repository: download the new installer from the releases', () => {
    expect(appCheckLine(fr.updates, { reason: 'private', status: 404, detail: null })).toBe(
      'La mise à jour de l’app n’a pas pu être vérifiée : les releases de bonaparte sont dans un dépôt GitHub privé, que l’app ne peut pas lire. Télécharge le nouvel installeur depuis les releases du dépôt, connecté à GitHub.',
    );
    expect(appCheckLine(en.updates, { reason: 'private', status: 404, detail: null })).toMatch(/^The app’s update could not be checked: .*private GitHub repository.*Download the new installer from the repository’s releases/);
  });

  it('no network, nothing published, GitHub refusing', () => {
    expect(appCheckLine(fr.updates, { reason: 'offline', status: null, detail: null })).toBe(
      'La mise à jour de l’app n’a pas pu être vérifiée : pas de réseau. Elle est vérifiée de nouveau à chaque ouverture de cette fenêtre, et toutes les six heures.',
    );
    expect(appCheckLine(fr.updates, { reason: 'unpublished', status: null, detail: null })).toContain('aucune version n’est encore publiée sur GitHub');
    expect(appCheckLine(fr.updates, { reason: 'refused', status: 403, detail: null })).toContain('GitHub a refusé la demande (HTTP 403)');
    expect(appCheckLine(en.updates, { reason: 'refused', status: 429, detail: null })).toContain('GitHub refused the request (HTTP 429)');
  });

  it('anything else in the updater’s own words, its status when it had one — never « erreur inconnue »', () => {
    expect(appCheckLine(fr.updates, { reason: 'other', status: 502, detail: 'Bad Gateway' })).toBe(
      'La mise à jour de l’app n’a pas pu être vérifiée : le programme de mise à jour dit « Bad Gateway » (HTTP 502).',
    );
    expect(appCheckLine(en.updates, { reason: 'other', status: null, detail: 'sha512 checksum mismatch' })).toBe(
      'The app’s update could not be checked: the updater says “sha512 checksum mismatch”.',
    );
    for (const words of [fr.updates, en.updates]) {
      expect(appCheckLine(words, { reason: 'other', status: null, detail: null })).not.toMatch(/inconnu|unknown/i);
    }
  });
});
