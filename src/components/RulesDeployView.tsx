import { Check, Copy, Download, ExternalLink, FileCode2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OrganizerSettings } from '../shared/types.ts';

interface DeployBundle {
  repoUrl: string;
  imageRef: string;
  files: {
    unraidXml: string;
    caProfileXml: string;
    dockerCompose: string;
    dockerfile: string;
    githubWorkflow: string;
    license: string;
    configYaml: string;
  };
}

interface RulesDeployViewProps {
  settings: OrganizerSettings;
  isBusy: boolean;
  onSaveSettings: (payload: {
    settings?: Partial<OrganizerSettings>;
    yaml?: string;
    rerun: boolean;
  }) => Promise<void>;
}

type BundleTab =
  | 'unraidXml'
  | 'caProfileXml'
  | 'dockerCompose'
  | 'dockerfile'
  | 'githubWorkflow'
  | 'license'
  | 'configYaml';

const BUNDLE_META: Record<BundleTab, { label: string; fileName: string; mime: string }> = {
  unraidXml: {
    label: 'Unraid CA XML',
    fileName: 'immich-autoalbums.xml',
    mime: 'application/xml',
  },
  caProfileXml: {
    label: 'ca_profile.xml',
    fileName: 'ca_profile.xml',
    mime: 'application/xml',
  },
  dockerCompose: {
    label: 'docker-compose.yml',
    fileName: 'docker-compose.yml',
    mime: 'text/yaml',
  },
  dockerfile: {
    label: 'Dockerfile',
    fileName: 'Dockerfile',
    mime: 'text/plain',
  },
  githubWorkflow: {
    label: 'GHCR Action',
    fileName: 'docker-publish.yml',
    mime: 'text/yaml',
  },
  license: {
    label: 'LICENSE',
    fileName: 'LICENSE',
    mime: 'text/plain',
  },
  configYaml: {
    label: 'config.yaml',
    fileName: 'config.yaml',
    mime: 'text/yaml',
  },
};

export function RulesDeployView({
  settings,
  isBusy,
  onSaveSettings,
}: RulesDeployViewProps) {
  const [titlePrefix, setTitlePrefix] = useState(settings.titlePrefix);
  const [useStructuredPrefix, setUseStructuredPrefix] = useState(settings.useStructuredPrefix);
  const [createMasterAlbum, setCreateMasterAlbum] = useState(settings.createMasterAlbum);
  const [createMoodSubalbums, setCreateMoodSubalbums] = useState(settings.createMoodSubalbums);
  const [scanIntervalHours, setScanIntervalHours] = useState(settings.scanIntervalHours);
  const [excludedPathsText, setExcludedPathsText] = useState(settings.excludedPaths.join(', '));
  const [yamlText, setYamlText] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<DeployBundle | null>(null);
  const [activeTab, setActiveTab] = useState<BundleTab>('unraidXml');
  const [copied, setCopied] = useState(false);

  const loadConfigAndBundle = async () => {
    const [settingsRes, bundleRes] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/deploy/bundle'),
    ]);
    if (settingsRes.ok) {
      const data = (await settingsRes.json()) as { yaml: string };
      setYamlText(data.yaml);
    }
    if (bundleRes.ok) {
      const data = (await bundleRes.json()) as DeployBundle;
      setBundle(data);
    }
  };

  useEffect(() => {
    setTitlePrefix(settings.titlePrefix);
    setUseStructuredPrefix(settings.useStructuredPrefix);
    setCreateMasterAlbum(settings.createMasterAlbum);
    setCreateMoodSubalbums(settings.createMoodSubalbums);
    setScanIntervalHours(settings.scanIntervalHours);
    setExcludedPathsText(settings.excludedPaths.join(', '));
    void loadConfigAndBundle();
  }, [settings]);

  const handleSaveForm = async () => {
    setYamlError(null);
    const paths = excludedPathsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await onSaveSettings({
      settings: {
        titlePrefix,
        useStructuredPrefix,
        createMasterAlbum,
        createMoodSubalbums,
        scanIntervalHours,
        excludedPaths: paths,
      },
      rerun: true,
    });
    await loadConfigAndBundle();
  };

  const handleSaveYaml = async () => {
    setYamlError(null);
    try {
      await onSaveSettings({ yaml: yamlText, rerun: true });
      await loadConfigAndBundle();
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'Invalid YAML syntax');
    }
  };

  const currentBundleContent = bundle ? bundle.files[activeTab] : '';

  const handleCopy = async () => {
    if (!currentBundleContent) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentBundleContent);
      } else {
        const ta = document.createElement('textarea');
        ta.value = currentBundleContent;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = () => {
    if (!currentBundleContent) return;
    const meta = BUNDLE_META[activeTab];
    const blob = new Blob([currentBundleContent], { type: meta.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Exclusion Rules & config.yaml Editor */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 items-stretch">
        <section className="flex flex-col justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Exclusion Rules &amp; Album Naming Safeguards
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Configure ignored folders, Immich flat-album prefixes, and periodic scan cadence.
              </p>
            </div>

            <div className="space-y-3.5 pt-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Excluded source path keywords (comma-separated)
                </span>
                <input
                  type="text"
                  value={excludedPathsText}
                  onChange={(e) => setExcludedPathsText(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0B0E14] px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Optional album title prefix
                  </span>
                  <input
                    type="text"
                    value={titlePrefix}
                    onChange={(e) => setTitlePrefix(e.target.value)}
                    placeholder="e.g. [Auto]"
                    className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0B0E14] px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Scheduled scan interval (hours)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={scanIntervalHours}
                    onChange={(e) => setScanIntervalHours(Number(e.target.value))}
                    className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0B0E14] px-3 py-2 text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </label>
              </div>

              <div className="space-y-2.5 pt-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useStructuredPrefix}
                    onChange={(e) => setUseStructuredPrefix(e.target.checked)}
                    className="mt-0.5 rounded border-neutral-300 accent-indigo-600"
                  />
                  <span className="text-xs text-neutral-700 dark:text-neutral-300">
                    <strong className="font-medium text-neutral-900 dark:text-neutral-100">
                      Structured Prefix Naming
                    </strong>{' '}
                    — format titles as <code className="font-mono">YYYY-MM • Event — Chapter</code> so flat Immich lists group chronologically.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createMasterAlbum}
                    onChange={(e) => setCreateMasterAlbum(e.target.checked)}
                    className="mt-0.5 rounded border-neutral-300 accent-indigo-600"
                  />
                  <span className="text-xs text-neutral-700 dark:text-neutral-300">
                    <strong className="font-medium text-neutral-900 dark:text-neutral-100">
                      Create Master Event Album (All)
                    </strong>{' '}
                    — keep an overarching album containing all photos alongside visual sub-chapters.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createMoodSubalbums}
                    onChange={(e) => setCreateMoodSubalbums(e.target.checked)}
                    className="mt-0.5 rounded border-neutral-300 accent-indigo-600"
                  />
                  <span className="text-xs text-neutral-700 dark:text-neutral-300">
                    <strong className="font-medium text-neutral-900 dark:text-neutral-100">
                      Color-Tone Sub-Chapter Splitting
                    </strong>{' '}
                    — split multi-scene events automatically via sliding-window CIELAB EMD.
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-800/80 flex justify-end">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleSaveForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              Save Rules &amp; Re-Run
            </button>
          </div>
        </section>

        {/* Live config.yaml Editor */}
        <section className="flex flex-col justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] p-6">
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Live config.yaml
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Edit directly and apply to persist into SQLite and regenerate deployment manifests.
                </p>
              </div>
            </div>

            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              spellCheck={false}
              rows={14}
              className="mt-3 flex-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#0B0E14] p-3.5 font-mono text-xs leading-relaxed text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {yamlError && (
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{yamlError}</p>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800/80 flex justify-end">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleSaveYaml}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Apply YAML &amp; Re-Run
            </button>
          </div>
        </section>
      </div>

      {/* Unraid Community Applications & GitHub Release Kit */}
      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#131722] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Unraid Community App &amp; Docker Release Kit
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Pre-wired for <span className="font-mono">NishantJh/immich_autoalbums</span> and{' '}
                <span className="font-mono">ghcr.io/nishantjh/immich_autoalbums:latest</span>
              </p>
            </div>
          </div>

          <a
            href={bundle?.repoUrl || 'https://github.com/NishantJh/immich_autoalbums'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
          >
            GitHub Repository
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* 4-Step Unraid Release Checklist */}
        <div className="grid grid-cols-1 divide-y divide-neutral-200 dark:divide-neutral-800 border-b border-neutral-200 dark:border-neutral-800 md:grid-cols-4 md:divide-y-0 md:divide-x bg-neutral-50/50 dark:bg-neutral-900/30">
          <div className="p-4">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              01. Push to GitHub
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Push this workspace to <code className="font-mono">NishantJh/immich_autoalbums</code> on the <code className="font-mono">main</code> branch.
            </p>
          </div>
          <div className="p-4">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              02. Build GHCR Image
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              The included GitHub Action builds and publishes multi-arch <code className="font-mono">amd64/arm64</code> images automatically.
            </p>
          </div>
          <div className="p-4">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              03. Set Package Public
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              In GitHub Packages settings, switch <code className="font-mono">immich_autoalbums</code> visibility to Public so Unraid can pull anonymously.
            </p>
          </div>
          <div className="p-4">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              04. Submit Unraid CA
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Register <code className="font-mono">unraid/immich-autoalbums.xml</code> with Unraid Community Applications moderation.
            </p>
          </div>
        </div>

        {/* File Viewer & Download Bar */}
        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-neutral-100 dark:bg-neutral-900 p-1 border border-neutral-200/80 dark:border-neutral-800">
              {(Object.keys(BUNDLE_META) as BundleTab[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === key
                      ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                  }`}
                >
                  {BUNDLE_META[key].label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 px-3.5 py-1.5 text-xs font-medium text-white dark:text-neutral-900 hover:opacity-90 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download {BUNDLE_META[activeTab].fileName}
              </button>
            </div>
          </div>

          <pre className="mt-4 max-h-96 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#0B0E14] p-4 font-mono text-xs leading-relaxed text-neutral-800 dark:text-neutral-200">
            <code>{currentBundleContent || 'Loading deployment manifest...'}</code>
          </pre>
        </div>
      </section>
    </div>
  );
}
