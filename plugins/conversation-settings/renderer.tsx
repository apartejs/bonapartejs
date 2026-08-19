import type { ResolvedSettingDto } from '@aparte/bonaparte-shared';
import { SettingsForm, type ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useState } from 'react';

/** Libellés du plugin — il ne dépend pas de l'i18n de l'app. */
const LABELS = {
  fr: {
    title: 'Cette conversation',
    advanced: 'Réglages avancés',
    inherited: 'hérité',
    reset: 'Rétablir',
    kvWarning: 'Changer ce réglage invalide les états de contexte déjà sauvegardés.',
  },
  en: {
    title: 'This conversation',
    advanced: 'Advanced settings',
    inherited: 'inherited',
    reset: 'Reset',
    kvWarning: 'Changing this setting invalidates the context states already saved.',
  },
} as const;

/**
 * Réglages de la conversation ouverte.
 *
 * Démonstration du principe « un réglage défini une fois, rendu partout » :
 * cette vue n'a aucun formulaire à elle. Elle affiche les mêmes champs que le
 * hub, dans la portée `conversation` — donc uniquement ceux qui s'y règlent,
 * chacun disant s'il est hérité du global.
 */
export default function ConversationSettingsView({
  conversationId,
  locale,
}: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [settings, setSettings] = useState<ResolvedSettingDto[]>([]);

  const refresh = useCallback(async () => {
    setSettings(await window.bonaparte.getSettings('conversation'));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, conversationId]);

  const change = useCallback(
    async (key: string, value: unknown) => {
      await window.bonaparte.setSetting('conversation', key, value);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="plugin-view">
      <h3 className="plugin-view-title">{labels.title}</h3>
      <SettingsForm
        settings={settings}
        scope="conversation"
        labels={labels}
        onChange={(key, value) => void change(key, value)}
      />
    </div>
  );
}
