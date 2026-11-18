/**
 * The service no longer answers (task 9.3; board « Quand quelque chose casse », « Service branché »): above the
 * composer, which service, at which address, and that the message is kept — in the thread, where « Réessayer »
 * sends it again. « Passer au moteur intégré » goes on with the built-in engine, its re-reading said first.
 */

import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

export interface ServiceDownCardProps {
  messages: Messages;
  service: string;
  /** Where it was reached: its host, as the person typed it. */
  host: string;
  /** The conversation is still on that service: it can go on with the built-in engine. */
  onService: boolean;
  onRetry(): void;
  onBuiltin(): void;
}

export function ServiceDownCard({ messages, service, host, onService, onRetry, onBuiltin }: ServiceDownCardProps) {
  const words = messages.serviceDown;
  return (
    <div className="aparte-alert aparte-alert--danger service-down" role="alert">
      <Icon name="engine" />
      <div className="aparte-alert__body">
        <p className="service-down__kind">{words.kind}</p>
        <p className="aparte-alert__title">{words.title}</p>
        <p className="aparte-alert__message">{words.line(service)}</p>
        <p className="engine-unloaded__detail">{words.kept(host)}</p>
        <div className="engine-unloaded__actions">
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onRetry}>
            {words.retry}
          </button>
          {onService ? (
            <button type="button" className="aparte-btn aparte-btn--outline" onClick={onBuiltin}>
              {words.builtin}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
