/**
 * The built-in web search (task 10.4): its manifest, read before anything of it runs, and its Node half. Its
 * one tool searches the web as the app does — the public engine read in a hidden page, or an online provider
 * whose key the app keeps — and asks before it goes out, in every mode, while « Demander avant chaque accès au
 * réseau » is ticked. Reading a page is the core's `web_fetch`.
 */

import { defineManifest } from '@aparte/bonaparte-plugin-sdk';

export { formatResults, webSearch } from './node.js';

export const webSearchManifest = defineManifest({
  id: 'web-search',
  name: { en: 'Web search', fr: 'Recherche web' },
  version: '1.0.0',
  description: {
    en: 'Search and read pages online. Nothing leaves without asking you.',
    fr: 'Chercher et lire des pages en ligne. Rien ne sort sans te le demander.',
  },
  effects: [{ effect: 'network', what: { en: 'searches on a public engine, or the online provider you chose', fr: 'cherche sur un moteur public, ou chez le fournisseur en ligne choisi' } }],
  contributes: {
    tools: [
      {
        name: 'web_search',
        description:
          'Search the web and return the top results (title, URL, snippet). Use it for anything you are not sure about: a library’s API, an error message, a recent fact. Then read a promising result with web_fetch.',
        effect: 'network',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for, as you would type it in a search engine.' },
            maxResults: { type: 'integer', minimum: 1, maximum: 10, description: 'How many results to return (default 6).' },
          },
          required: ['query'],
        },
      },
    ],
  },
});
