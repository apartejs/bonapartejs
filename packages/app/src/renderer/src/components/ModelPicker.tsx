import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  RadioGroup,
  RadioGroupItem,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { CircleAlert, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { modelFileName } from '../models/filter.js';
import { SETUP_CARD, SETUP_EYEBROW } from './SetupPanel.js';

interface ModelPickerProps {
  busy: boolean;
  error: string | null;
  onPick: (modelPath: string) => void;
  /** Pinned model whose file vanished: named in a notice above the list. */
  missingModel?: string | null;
  /** A message waits for this pick: the notice says it will be sent. */
  pendingMessage?: boolean;
}

function formatSize(bytes: number, units: { gib: string; mib: string }): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} ${units.gib}`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} ${units.mib}`;
}

const HINT = 'text-[13.5px] text-muted-foreground';

export function ModelPicker({
  busy,
  error,
  onPick,
  missingModel,
  pendingMessage,
}: ModelPickerProps) {
  const { t } = useTranslate();
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Filter: each term must appear in the name OR the path, which allows
  // searching "qwen 32 q4" without worrying about order.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (models ?? []).filter((model) => {
    const haystack = `${model.name} ${model.path}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  // We never confirm a selection hidden by the filter: if it falls out of
  // the visible list, the first displayed row becomes the authoritative one.
  const effective =
    selected && visible.some((m) => m.path === selected)
      ? selected
      : (visible[0]?.path ?? null);

  useEffect(() => {
    void window.bonaparte.scanModels().then((found) => {
      setModels(found);
      if (found.length > 0) setSelected(found[0]!.path);
    });
  }, []);

  const browse = async (): Promise<void> => {
    const picked = await window.bonaparte.pickFile('gguf');
    if (picked) onPick(picked);
  };

  return (
    <div className="setup-wrap grid flex-1 place-items-center overflow-y-auto p-6">
      <Card className={SETUP_CARD}>
        <CardHeader className="gap-1.5 px-0">
          <p className={SETUP_EYEBROW}>{t.picker.eyebrow}</p>
          <h1 data-slot="card-title" className="font-serif text-[26px] leading-tight font-normal">{t.picker.title}</h1>
          <CardDescription className="text-[13.5px] leading-normal">{t.picker.intro}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 px-0">
          {missingModel && (
            <Alert
              role="status"
              className="picker-missing border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            >
              <TriangleAlert aria-hidden="true" />
              <AlertDescription className="text-current">
                {t.picker.missingModel.replace('{name}', modelFileName(missingModel))}
                {pendingMessage ? ` ${t.picker.resendAfterPick}` : ''}
              </AlertDescription>
            </Alert>
          )}

          {models !== null && models.length > 0 && (
            <InputGroup className="picker-search">
              <InputGroupInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.picker.searchPlaceholder}
                spellCheck={false}
                autoFocus
                aria-label={t.picker.searchPlaceholder}
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label={t.common.clear} onClick={() => setQuery('')}>
                    <X aria-hidden="true" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          )}

          {models === null ? (
            <p className={cn('picker-scanning', HINT)}>{t.picker.scanning}</p>
          ) : models.length === 0 ? (
            <p className={cn('picker-empty', HINT)}>{t.picker.empty}</p>
          ) : visible.length === 0 ? (
            <p className={cn('picker-empty', HINT)}>{t.picker.noMatch}</p>
          ) : (
            <RadioGroup
              value={effective ?? ''}
              onValueChange={setSelected}
              className="model-list flex max-h-80 flex-col gap-0 overflow-y-auto rounded-lg border"
              aria-label={t.picker.title}
            >
              {visible.map((model) => (
                <label
                  key={model.path}
                  className={cn(
                    'model-row flex cursor-pointer items-center gap-2.5 border-t px-3 py-2.5 first:border-t-0 hover:bg-muted',
                    effective === model.path && 'selected bg-muted shadow-[inset_3px_0_0_var(--primary)]',
                  )}
                  title={model.path}
                >
                  <RadioGroupItem value={model.path} />
                  <span className="model-name min-w-0 flex-1 truncate font-mono text-[13px]">{model.name}</span>
                  <span className="model-meta inline-flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
                    {formatSize(model.sizeBytes, t.units)}
                    <Badge
                      variant="outline"
                      className={cn(
                        'model-source font-mono text-[10px] font-normal tracking-wide uppercase',
                        `source-${model.source}`,
                      )}
                    >
                      {model.source}
                    </Badge>
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}

          {error && (
            <Alert variant="destructive" role="alert" className="setup-error">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>
                {t.setup.failed} — {error}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="picker-actions justify-between gap-2.5 px-0">
          <Button type="button" variant="outline" onClick={() => void browse()} disabled={busy}>
            {t.picker.manual}
          </Button>
          <Button
            type="button"
            disabled={busy || !effective}
            onClick={() => effective && onPick(effective)}
          >
            {busy ? t.setup.starting : t.picker.confirm}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
