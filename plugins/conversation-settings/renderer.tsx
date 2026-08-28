import type { ResolvedSettingDto } from '@aparte/bonaparte-shared';
import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { SettingsForm } from '@aparte/bonaparte-plugin-sdk/ui';
import { useCallback, useEffect, useState } from 'react';

/** Plugin labels — it does not depend on the app's i18n. */
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
 * Settings for the currently open conversation.
 *
 * Demonstrates the "one setting defined once, rendered everywhere" principle:
 * this view has no form of its own. It shows the same fields as the hub, in
 * the `conversation` scope — so only the ones settable there, each stating
 * whether it is inherited from global.
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
    <div className="plugin-view flex flex-col gap-2.5">
      <h3 className="plugin-view-title font-serif text-sm font-normal text-muted-foreground">{labels.title}</h3>
      <SettingsForm
        settings={settings}
        scope="conversation"
        labels={labels}
        locale={locale}
        onChange={(key, value) => void change(key, value)}
      />
    </div>
  );
}
