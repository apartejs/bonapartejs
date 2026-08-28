import type {
  BackendConfigDto,
  EndpointProbeDto,
  PickFileKind,
} from '@aparte/bonaparte-shared';
import {
  Alert,
  AlertDescription,
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
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { Check, CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface SetupPanelProps {
  initial?: BackendConfigDto;
  busy: boolean;
  error: string | null;
  onSubmit: (config: BackendConfigDto) => void;
}

/**
 * Two intents for a single engine: "bonaparte launches llama.cpp" or "I
 * already have a llama-server running." There's no protocol to choose —
 * bonaparte only drives llama.cpp, the only one that persists context. The
 * URL is simply verified before being accepted.
 */
type Intent = 'managed' | 'existing';

/** The card every first screen wears: centred, one width, a soft entrance. */
export const SETUP_CARD =
  'setup-card w-[min(520px,100%)] gap-5 px-10 py-9 animate-in fade-in slide-in-from-bottom-2 duration-500';
export const SETUP_EYEBROW = 'font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase';
export const SETUP_NOTE =
  'setup-note rounded-lg border bg-muted px-3 py-2.5 text-[12.5px] leading-normal text-muted-foreground';

export function SetupPanel({ initial, busy, error, onSubmit }: SetupPanelProps) {
  const { t } = useTranslate();
  const [intent, setIntent] = useState<Intent>(
    initial && initial.mode !== 'managed' ? 'existing' : 'managed',
  );

  const [binPath, setBinPath] = useState(
    initial?.mode === 'managed' ? initial.binPath : '',
  );
  const [binDetected, setBinDetected] = useState(false);
  const [binMissing, setBinMissing] = useState(false);
  const [wingetCopied, setWingetCopied] = useState(false);

  const [url, setUrl] = useState(initial?.mode === 'remote' ? initial.url : '');
  const [probe, setProbe] = useState<EndpointProbeDto | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);

  // Pre-fills the llama binary detected on the machine (doctor lookup).
  useEffect(() => {
    void window.bonaparte.suggestSetup().then((suggestion) => {
      if (suggestion.binPath) {
        setBinPath((current) => {
          if (current) return current;
          setBinDetected(true);
          return suggestion.binPath as string;
        });
      } else {
        setBinMissing(true);
      }
    });
  }, []);

  const copyWinget = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText('winget install ggml.llamacpp');
      setWingetCopied(true);
      setTimeout(() => setWingetCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the command stays displayed */
    }
  };

  const browse = async (kind: PickFileKind): Promise<void> => {
    const picked = await window.bonaparte.pickFile(kind);
    if (!picked) return;
    setBinPath(picked);
    setBinDetected(false);
  };

  const runProbe = async (): Promise<void> => {
    setProbing(true);
    setProbeFailed(false);
    try {
      const found = await window.bonaparte.probeEndpoint(url);
      setProbe(found);
      setProbeFailed(found === null);
    } finally {
      setProbing(false);
    }
  };

  const canSubmit =
    !busy && (intent === 'managed' ? binPath.trim() !== '' : probe !== null);

  const submit = (): void => {
    if (!canSubmit) return;
    if (intent === 'managed') {
      onSubmit({ mode: 'managed', binPath: binPath.trim() });
      return;
    }
    if (!probe) return;
    onSubmit({ mode: 'remote', url: probe.baseUrl });
  };

  return (
    <div className="setup-wrap grid flex-1 place-items-center overflow-y-auto p-6">
      <Card className={SETUP_CARD}>
        <CardHeader className="gap-1.5 px-0">
          <p className={SETUP_EYEBROW}>{t.setup.eyebrow}</p>
          <h1 data-slot="card-title" className="font-serif text-[26px] leading-tight font-normal">{t.setup.title}</h1>
          <CardDescription className="text-[13.5px] leading-normal">{t.setup.intro}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 px-0">
          <Tabs value={intent} onValueChange={(value) => setIntent(value as Intent)}>
            <TabsList className="segmented">
              <TabsTrigger value="managed">{t.setup.intentManaged}</TabsTrigger>
              <TabsTrigger value="existing">{t.setup.intentExisting}</TabsTrigger>
            </TabsList>
          </Tabs>

          {intent === 'managed' ? (
            <>
              <p className={SETUP_NOTE}>{t.setup.managedNote}</p>
              <div className="field flex flex-col gap-1.5">
                <Label htmlFor="setup-bin">
                  {t.setup.binPath}
                  {binDetected && (
                    <span className="field-hint font-normal text-emerald-700 dark:text-emerald-300">
                      — {t.setup.detected}
                    </span>
                  )}
                </Label>
                <InputGroup>
                  <InputGroupInput
                    id="setup-bin"
                    className="font-mono text-[13px]"
                    value={binPath}
                    onChange={(e) => {
                      setBinPath(e.target.value);
                      setBinDetected(false);
                    }}
                    placeholder={t.setup.binPathPlaceholder}
                    spellCheck={false}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="sm" onClick={() => void browse('binary')}>
                      {t.setup.browse}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>
              {binMissing && !binPath && (
                <Alert className="install-hint border-dashed">
                  <Info aria-hidden="true" />
                  <AlertDescription className="gap-2.5">
                    <p>{t.setup.notInstalled}</p>
                    <code className="block rounded-md bg-muted px-2.5 py-1.5 font-mono text-[12.5px] text-foreground select-all">
                      winget install ggml.llamacpp
                    </code>
                    <div className="install-hint-actions flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => void copyWinget()}>
                        {wingetCopied ? <Check aria-hidden="true" /> : t.setup.installWinget}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void window.bonaparte.openExternal(
                            'https://github.com/ggml-org/llama.cpp/releases',
                          )
                        }
                      >
                        {t.setup.openReleases}
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <>
              <p className={SETUP_NOTE}>{t.setup.existingNote}</p>
              <div className="field flex flex-col gap-1.5">
                <Label htmlFor="setup-url">{t.setup.endpointUrl}</Label>
                <InputGroup>
                  <InputGroupInput
                    id="setup-url"
                    className="font-mono text-[13px]"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setProbe(null);
                      setProbeFailed(false);
                    }}
                    placeholder="http://127.0.0.1:1234/v1"
                    spellCheck={false}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="sm"
                      onClick={() => void runProbe()}
                      disabled={probing || url.trim() === ''}
                    >
                      {probing ? t.setup.probing : t.setup.endpointProbe}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>

              {probeFailed && (
                <Alert variant="destructive" role="alert" className="setup-error">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{t.setup.probeFailed}</AlertDescription>
                </Alert>
              )}

              {probe && (
                <Alert className="probe-result border-emerald-600/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200">
                  <CircleCheck aria-hidden="true" />
                  <AlertDescription className="text-current">
                    <p>
                      <strong>{t.setup.foundLlama}</strong>
                      {' — '}
                      {t.setup.persistenceYes}
                    </p>
                    {probe.model && (
                      <p className="probe-model font-mono text-xs opacity-80 [overflow-wrap:anywhere]">
                        {probe.model}
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </>
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

        <CardFooter className="px-0">
          <Button type="button" size="lg" className="w-full" disabled={!canSubmit} onClick={submit}>
            {busy ? t.setup.starting : t.setup.start}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
