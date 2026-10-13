"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { POPULAR_SEARCHES } from "@/lib/dictionary";
import { dictionaryRepository } from "@/lib/dictionary-repository";
import { lookupWord, normalizeCatalanInput, suggestWords } from "@/lib/lookup";
import { normalizeSearchInput, searchCacheKey } from "@/lib/search-normalization";
import { findCatalanVoice, speakCatalan } from "@/lib/speech";
import { refreshSavedSnapshots } from "@/lib/saved-refresh";
import {
  addHistory,
  cacheLookup,
  clearHistory,
  getCachedLookup,
  getHistory,
  getSavedWords,
  getStorageEstimate,
  removeSavedWord,
  requestPersistentStorage,
  saveWord,
  updateSavedSnapshot,
} from "@/lib/storage";
import type {
  FoundLookup,
  DictionaryManifest,
  HistoryRecord,
  LookupResponse,
  OfflineInstallProgress,
  SavedRecord,
  SearchLanguage,
  SearchManifest,
  SearchSuggestion,
} from "@/lib/types";
import { primaryChinese, primarySpanish } from "@/lib/types";

const PART_OF_SPEECH: Record<string, string> = {
  verb: "verb · 动词",
  noun: "noun · 名词",
  "proper noun": "nom propi · 专有名词",
  adjective: "adjective · 形容词",
  adverb: "adverb · 副词",
  article: "article · 冠词",
  conjunction: "conjunction · 连词",
  contraction: "contraction · 缩合词",
  determiner: "determiner · 限定词",
  expression: "expression · 表达",
  interjection: "interjection · 感叹词",
  numeral: "numeral · 数词",
  particle: "particle · 小品词",
  preposition: "preposition · 介词",
  pronoun: "pronoun · 代词",
};

type View = "search" | "saved";

const SEARCH_LANGUAGES: Array<{ value: SearchLanguage; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "zh", label: "中文" },
  { value: "es", label: "Español" },
  { value: "ca", label: "Català" },
];
const LANGUAGE_LABELS = { zh: "中文", es: "Español", ca: "Català" };

function inputLanguage(query: string, mode?: SearchLanguage): string | undefined {
  if (mode === "zh" || /\p{Script=Han}/u.test(query)) return "zh-Hans";
  return mode && mode !== "auto" ? mode : undefined;
}

function historyRecordForLookup(found: FoundLookup): HistoryRecord {
  return {
    query: found.searchedForm,
    normalizedQuery: searchCacheKey(found.searchedForm, found.searchLanguage ?? "auto"),
    searchLanguage: found.searchLanguage ?? "auto",
    lemma: found.lemma,
    meaning:
      primaryChinese(found.entry) ||
      primarySpanish(found.entry) ||
      found.entry.definitions?.ca?.[0] ||
      "",
    timestamp: Date.now(),
  };
}

function SpeakerButton({
  text,
  compact = false,
  onSpeak,
}: {
  text: string;
  compact?: boolean;
  onSpeak: (text: string) => void;
}) {
  return (
    <button
      className={compact ? "speaker speaker--compact" : "speaker"}
      type="button"
      onClick={() => onSpeak(text)}
      aria-label={`Pronuncia ${text}`}
      title={`Pronuncia ${text}`}
    >
      <span aria-hidden="true">🔊</span>
    </button>
  );
}

export function DictionaryApp() {
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [searchLanguage, setSearchLanguage] = useState<SearchLanguage>("auto");
  const [composing, setComposing] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<{ key: string; items: SearchSuggestion[] } | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [savedWords, setSavedWords] = useState<SavedRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [manifest, setManifest] = useState<DictionaryManifest | null>(null);
  const [searchManifest, setSearchManifest] = useState<SearchManifest | null>(null);
  const [coreReady, setCoreReady] = useState(false);
  const [corePreparing, setCorePreparing] = useState(true);
  const [offlineProgress, setOfflineProgress] =
    useState<OfflineInstallProgress | null>(null);
  const [offlineInstalling, setOfflineInstalling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequest = useRef(0);
  const suggestionKey = searchCacheKey(query, searchLanguage);
  const suggestions = suggestionsOpen && !composing && suggestionResult?.key === suggestionKey
    ? suggestionResult.items : [];

  useEffect(() => {
    if (!suggestionsOpen || composing || !query.trim() || view !== "search") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void suggestWords(query, searchLanguage, 8, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, items });
        }).catch(() => {
          // Completions are optional; the normal lookup still reports failures.
        });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchLanguage, suggestionsOpen, composing, suggestionKey, view]);

  useEffect(() => {
    let cancelled = false;
    void requestPersistentStorage();
    Promise.all([getHistory(), getSavedWords()])
      .then(async ([storedHistory, storedSaved]) => {
        if (cancelled) return;
        setHistory(storedHistory);
        setSavedWords(storedSaved);
        const [base, search] = await Promise.all([
          dictionaryRepository.manifest(), dictionaryRepository.searchManifest(),
        ]);
        const refreshed = await refreshSavedSnapshots(storedSaved, {
          dataVersion: base.dataVersion, searchDataVersion: search.dataVersion,
          load: (lemma) => dictionaryRepository.getEntry(lemma),
          persist: updateSavedSnapshot, cancelled: () => cancelled,
        });
        if (cancelled) return;
        // Keep removals and newer saves made while enrichment was loading.
        setSavedWords((current) => current.map((record) => {
          const updated = refreshed.get(record.lemma);
          return updated && updated.savedAt === record.savedAt && updated.revision === record.revision
            ? updated : record;
        }));
      })
      .catch(() => {
        // Search remains fully functional if private browsing blocks IndexedDB.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      dictionaryRepository.manifest(),
      dictionaryRepository.searchManifest().catch(() => null),
    ])
      .then(([nextManifest, nextSearchManifest]) => {
        if (!cancelled) setManifest(nextManifest);
        if (!cancelled) setSearchManifest(nextSearchManifest);
        return dictionaryRepository.ensureCoreOffline();
      })
      .then(() => {
        if (!cancelled) setCoreReady(true);
        return dictionaryRepository.installedOfflineProgress();
      })
      .then((progress) => {
        if (!cancelled && progress) setOfflineProgress(progress);
      })
      .catch(() => {
        // Authored seed entries remain usable without the downloaded pack.
      })
      .finally(() => {
        if (!cancelled) setCorePreparing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const synth = window.speechSynthesis;
    const refreshVoices = () => synth.getVoices();
    refreshVoices();
    synth.addEventListener?.("voiceschanged", refreshVoices);

    return () => synth.removeEventListener?.("voiceschanged", refreshVoices);
  }, []);

  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // The online app still works if service-worker registration is blocked.
        });
    }
  }, []);

  const savedLemmas = useMemo(
    () => new Set(savedWords.map((record) => record.lemma)),
    [savedWords],
  );

  const handleRememberLookup = async (found: FoundLookup) => {
    const optimisticRecord = historyRecordForLookup(found);

    setHistory((current) =>
      [
        optimisticRecord,
        ...current.filter(
          (record) => record.normalizedQuery !== optimisticRecord.normalizedQuery,
        ),
      ].slice(0, 20),
    );

    try {
      await Promise.all([
        addHistory(found),
        cacheLookup(found, manifest?.dataVersion, found.searchDataVersion ?? searchManifest?.dataVersion),
      ]);
    } catch {
      // Device-local persistence can fail without blocking the lookup itself.
    }
  };

  const runSearch = async (rawQuery: string, modeOverride?: SearchLanguage) => {
    const mode = modeOverride ?? searchLanguage;
    const normalized = normalizeSearchInput(rawQuery, mode);
    if (!normalized) {
      inputRef.current?.focus();
      return;
    }

    const request = ++searchRequest.current;
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    setView("search");
    setSearchLanguage(mode);
    setQuery(rawQuery.trim());
    setSearching(true);
    setAnnouncement("");

    let nextResult: LookupResponse | null = null;
    try {
      const cached = manifest && searchManifest
        ? await getCachedLookup(rawQuery, mode, searchManifest.dataVersion)
        : undefined;
      if (
        cached &&
        (!manifest || cached.dataVersion === manifest.dataVersion)
      ) {
        nextResult = {
          ...cached.result,
          searchedForm: rawQuery.trim().normalize("NFC"),
          normalizedQuery: normalized,
        };
      }
    } catch {
      // Fall through to the bundled dictionary.
    }

    let lookupFailed = false;
    if (!nextResult) {
      try {
        nextResult = await lookupWord(rawQuery, mode);
      } catch {
        lookupFailed = true;
        nextResult = {
          status: "not-found",
          searchedForm: rawQuery.trim().normalize("NFC"),
          normalizedQuery: normalized,
          resolutionSource: "none",
          suggestions: [],
          searchLanguage: mode,
          offlineLimited: typeof navigator !== "undefined" && !navigator.onLine,
        };
      }
    }
    if (request !== searchRequest.current) return;
    setResult(nextResult);
    setSearching(false);

    if (lookupFailed) {
      setAnnouncement(
        "暂时无法读取词库，请联网后重试或完成离线下载。",
      );
    } else if (nextResult.status === "found") {
      setAnnouncement(`${rawQuery}: ${nextResult.lemma}`);
      void handleRememberLookup(nextResult);
    } else if (nextResult.offlineLimited) {
      setAnnouncement("已下载的离线词库中没有匹配结果。联网或下载完整词库后再试。");
    } else if (nextResult.suggestions.length) {
      setAnnouncement(`No result. Did you mean ${nextResult.suggestions[0]}?`);
    } else {
      setAnnouncement(`No result for ${rawQuery}.`);
    }
  };

  const changeSearchLanguage = (mode: SearchLanguage) => {
    if (mode === searchLanguage) return;
    setSearchLanguage(mode);
    setActiveSuggestion(-1);
    if (query.trim() && result) {
      void runSearch(query, mode);
    } else {
      // Invalidate a pending request when the user changes its language filter.
      searchRequest.current += 1;
      setSearching(false);
      setResult(null);
    }
    inputRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composing) return;
    void runSearch(query);
  };

  const handleSpeak = (text: string) => {
    if (!("speechSynthesis" in window)) {
      setAnnouncement("This device does not provide system speech.");
      return;
    }
    const voice = findCatalanVoice(window.speechSynthesis.getVoices());
    speakCatalan(text);
    if (!voice) {
      setAnnouncement(
        "No Catalan system voice is installed. On iPhone, download a Catalan voice in Settings → Accessibility → Spoken Content → Voices.",
      );
    }
  };

  const toggleSaved = async (found: FoundLookup) => {
    const isSaved = savedLemmas.has(found.lemma);
    try {
      if (isSaved) {
        await removeSavedWord(found.lemma);
        setSavedWords((current) =>
          current.filter((record) => record.lemma !== found.lemma),
        );
        setAnnouncement(`${found.lemma} removed from Saved.`);
      } else {
        const record = await saveWord(found, manifest?.dataVersion);
        setSavedWords((current) => [
          record,
          ...current.filter((item) => item.lemma !== found.lemma),
        ]);
        setAnnouncement(`${found.lemma} saved.`);
      }
    } catch {
      setAnnouncement("Could not save on this device.");
    }
  };

  const chooseCandidate = async (candidateLemma: string) => {
    if (!result || result.status !== "found") return;
    const request = searchRequest.current;
    const candidate = result.candidates.find(
      (item) => item.lemma === candidateLemma,
    );
    const entry =
      candidate?.entry ??
      (await dictionaryRepository.getEntry(normalizeCatalanInput(candidateLemma)));
    if (!candidate || !entry || request !== searchRequest.current) return;

    const nextResult: FoundLookup = {
      ...result,
      lemma: candidateLemma,
      entry,
      morphology: candidate.morphology,
      confidence: candidate.confidence ?? 0,
      matchedLanguage: candidate.matchedLanguage,
      matchedTerm: candidate.matchedTerm,
      matchKind: candidate.matchKind,
      resolutionSource: candidate.matchedLanguage && candidate.matchedLanguage !== "ca"
        ? "translation"
        : candidate.matchKind === "morphology" ? "morphology" : "exact",
    };
    setResult(nextResult);
    void handleRememberLookup(nextResult);
  };

  const installFullDictionary = async () => {
    setOfflineInstalling(true);
    setAnnouncement("Downloading the complete offline dictionary.");
    try {
      const [nextManifest, nextSearchManifest, estimate] = await Promise.all([
        dictionaryRepository.manifest(),
        dictionaryRepository.searchManifest(),
        getStorageEstimate(),
      ]);
      const requiredBytes = (
        nextManifest.sizes.compressedBytes ??
        nextManifest.sizes.gzipBytes ??
        nextManifest.sizes.rawBytes
      ) + nextSearchManifest.sizes.compressedBytes;
      if (
        estimate?.quota !== undefined &&
        estimate.usage !== undefined &&
        estimate.quota - estimate.usage < requiredBytes * 1.2
      ) {
        setAnnouncement(
          "Not enough free browser storage for the complete offline dictionary.",
        );
        return;
      }
      const finalProgress = await dictionaryRepository.installFullOffline(
        setOfflineProgress,
      );
      setOfflineProgress(finalProgress);
      setAnnouncement("The complete dictionary is ready offline.");
    } catch {
      setAnnouncement("The offline download paused. Tap again to resume.");
    } finally {
      setOfflineInstalling(false);
    }
  };

  const removeSavedFromList = async (lemma: string) => {
    try {
      await removeSavedWord(lemma);
      setSavedWords((current) =>
        current.filter((record) => record.lemma !== lemma),
      );
      setAnnouncement(`${lemma} removed from Saved.`);
    } catch {
      setAnnouncement("Could not update Saved on this device.");
    }
  };

  const eraseHistory = async () => {
    setHistory([]);
    try {
      await clearHistory();
    } catch {
      // The visible history is already cleared for this session.
    }
  };

  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            Ç
          </div>
          <div>
            <h1>Català</h1>
            <p>中文 · Español</p>
          </div>
          <span className="offline-badge" title="Local-first dictionary data">
            <span aria-hidden="true" />
            {manifest ? `${manifest.lemmaCount.toLocaleString("ca")} lemes` : "local"}
          </span>
        </div>

        <form className="search-form" role="search" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="dictionary-search">
            输入中文、西班牙语或加泰语，查找 Català 单词
          </label>
          <div className="search-field">
            <span className="search-glyph" aria-hidden="true">
              ⌕
            </span>
            <input
              ref={inputRef}
              id="dictionary-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestionsOpen(true);
                setActiveSuggestion(-1);
                searchRequest.current += 1;
                setSearching(false);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={(event) => {
                if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("#search-completions")) return;
                setSuggestionsOpen(false);
                setActiveSuggestion(-1);
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composing) return;
                if (event.key === "Escape") {
                  setSuggestionsOpen(false);
                  setActiveSuggestion(-1);
                } else if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  setActiveSuggestion((current) => event.key === "ArrowDown"
                    ? (current + 1) % suggestions.length
                    : (current <= 0 ? suggestions.length - 1 : current - 1));
                } else if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                  event.preventDefault();
                  const item = suggestions[activeSuggestion];
                  void runSearch(item.term, item.language);
                }
              }}
              placeholder="中文 / Español / Català"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="search"
              spellCheck={false}
              aria-describedby="search-help"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls={suggestions.length ? "search-completions" : undefined}
              aria-activedescendant={suggestions[activeSuggestion] ? `search-completion-${activeSuggestion}` : undefined}
            />
            <button
              className="search-submit"
              type="submit"
              aria-label="查词"
              aria-busy={searching}
            >
              <span aria-hidden="true">{searching ? "···" : "→"}</span>
            </button>
          </div>
          {suggestions.length > 0 ? (
            <ul className="search-completions" id="search-completions" role="listbox" aria-label="联想词">
              {suggestions.map((item, index) => (
                <li key={`${item.language}:${item.term}`} id={`search-completion-${index}`}
                  role="option" aria-selected={index === activeSuggestion}>
                  <button type="button" tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void runSearch(item.term, item.language)}>
                    <span lang={inputLanguage(item.term, item.language)}>{item.term}</span>
                    <span className="completion-lemma" lang="ca">→ {item.lemma}</span>
                    <span className="completion-kind">{item.kind === "fuzzy" ? "近似拼写" : item.kind === "related" ? "相关词" : LANGUAGE_LABELS[item.language]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="search-languages" role="group" aria-label="输入语言">
            {SEARCH_LANGUAGES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={searchLanguage === value}
                onClick={() => changeSearchLanguage(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="search-help" id="search-help" lang="zh-Hans">
            输入单词或部分译词，选择联想词或按回车查词。
          </p>
        </form>
      </header>

      <div className="content" aria-busy={searching}>
        {view === "search" ? (
          <>
            {result?.status === "found" ? (
              <ResultView
                result={result}
                saved={savedLemmas.has(result.lemma)}
                onSpeak={handleSpeak}
                onToggleSaved={() => void toggleSaved(result)}
                onChooseCandidate={(lemma) => void chooseCandidate(lemma)}
              />
            ) : result?.status === "not-found" ? (
              <MissView
                query={result.searchedForm}
                extractedQuery={result.extractedQuery}
                suggestions={result.suggestions}
                relatedSuggestions={result.relatedSuggestions}
                searchLanguage={result.searchLanguage}
                offlineLimited={result.offlineLimited}
                onSearch={(term, mode) => void runSearch(term, mode ?? "ca")}
              />
            ) : (
              <StartView
                history={history}
                onSearch={(term, mode) => void runSearch(term, mode)}
                onClear={() => void eraseHistory()}
              />
            )}

            {result && history.length > 0 ? (
              <RecentStrip
                history={history.slice(0, 4)}
                onSearch={(term, mode) => void runSearch(term, mode)}
              />
            ) : null}
          </>
        ) : (
          <SavedView
            savedWords={savedWords}
            onOpen={(lemma) => void runSearch(lemma, "ca")}
            onRemove={(lemma) => void removeSavedFromList(lemma)}
          />
        )}
        <OfflinePanel
          manifest={manifest}
          searchManifest={searchManifest}
          coreReady={coreReady}
          corePreparing={corePreparing}
          offlineProgress={offlineProgress}
          offlineInstalling={offlineInstalling}
          onInstallOffline={() => void installFullDictionary()}
        />
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <nav className="bottom-nav" aria-label="Primary">
        <div className="bottom-nav__inner">
          <button
            type="button"
            className={view === "search" ? "nav-item nav-item--active" : "nav-item"}
            onClick={() => {
              searchRequest.current += 1;
              setSearching(false);
              setView("search");
              setResult(null);
            }}
            aria-current={view === "search" ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              ⌕
            </span>
            Cerca
          </button>
          <button
            type="button"
            className={view === "saved" ? "nav-item nav-item--active" : "nav-item"}
            onClick={() => {
              searchRequest.current += 1;
              setSearching(false);
              setView("saved");
            }}
            aria-current={view === "saved" ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              ☆
            </span>
            Desats
            {savedWords.length > 0 ? (
              <span className="nav-count" aria-label={`${savedWords.length} saved`}>
                {savedWords.length}
              </span>
            ) : null}
          </button>
        </div>
      </nav>
    </main>
  );
}

function StartView({
  history,
  onSearch,
  onClear,
}: {
  history: HistoryRecord[];
  onSearch: (term: string, mode?: SearchLanguage) => void;
  onClear: () => void;
}) {
  return (
    <section className="start-view" aria-labelledby="recent-heading">
      {history.length > 0 ? (
        <>
          <div className="section-heading">
            <h2 id="recent-heading">Recent</h2>
            <button type="button" onClick={onClear}>
              Esborra
            </button>
          </div>
          <ul className="word-list">
            {history.map((record) => (
              <li key={record.normalizedQuery}>
                <button type="button" onClick={() => onSearch(record.query, record.searchLanguage ?? "auto")}>
                  <span className="history-query" lang={inputLanguage(record.query, record.searchLanguage)}>
                    {record.query}
                  </span>
                  <span className="history-detail">
                    <span lang="ca">
                      {normalizeCatalanInput(record.query) === normalizeCatalanInput(record.lemma)
                        ? record.lemma
                        : `${record.lemma} ·`}
                    </span>{" "}
                    <span lang="zh-Hans">{record.meaning}</span>
                  </span>
                  <span className="row-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="empty-intro">
            <p className="eyebrow">Diccionari · 三语查词</p>
            <h2 id="recent-heading">从熟悉的语言，找到 Català。</h2>
            <p lang="zh-Hans">
              试试 <strong>学校</strong>、<strong lang="es">escuela</strong> 或
              <strong lang="ca"> escola</strong>。
              也支持 <strong lang="ca">pujant</strong> 等加泰语词形。
            </p>
          </div>
          <div className="try-block">
            <p>试着查一个词 · Prova-ho</p>
            <div className="quick-words">
              <button type="button" lang="zh-Hans" onClick={() => onSearch("学校", "zh")}>
                学校
              </button>
              <button type="button" lang="es" onClick={() => onSearch("escuela", "es")}>
                escuela
              </button>
              {POPULAR_SEARCHES.map((word) => (
                <button key={word} type="button" lang="ca" onClick={() => onSearch(word, "ca")}>
                  {word}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function OfflinePanel({
  manifest,
  searchManifest,
  coreReady,
  corePreparing,
  offlineProgress,
  offlineInstalling,
  onInstallOffline,
}: {
  manifest: DictionaryManifest | null;
  searchManifest: SearchManifest | null;
  coreReady: boolean;
  corePreparing: boolean;
  offlineProgress: OfflineInstallProgress | null;
  offlineInstalling: boolean;
  onInstallOffline: () => void;
}) {
  const fullBytes = manifest && searchManifest
    ? (manifest.sizes.compressedBytes ?? manifest.sizes.gzipBytes ?? manifest.sizes.rawBytes)
      + searchManifest.sizes.compressedBytes
    : undefined;
  const percent = offlineProgress?.total
    ? Math.round(offlineProgress.completed / offlineProgress.total * 100)
    : undefined;

  return (
    <section className="install-note offline-panel" aria-label="离线词库" lang="zh-Hans">
      <span className="install-note__mark" aria-hidden="true">
        {offlineProgress?.ready || coreReady ? "✓" : "↓"}
      </span>
      <div>
        <strong>
          {offlineProgress?.ready
            ? "完整词库已下载"
            : coreReady ? "常用词库已可离线使用"
              : corePreparing ? "正在准备常用词库…" : "联网后可准备常用词库"}
        </strong>
        <p>
          {manifest ? `常用约 ${manifest.coreLemmaCount.toLocaleString("zh-CN")} 词自动保存。` : "常用词会自动保存在这台设备。"}
          下载完整词库后，可离线查询更多加泰语词和中西语译词。部分中文标有机器辅助或译词参考。
        </p>
        <button
          className="offline-download"
          type="button"
          disabled={offlineInstalling || offlineProgress?.ready}
          onClick={onInstallOffline}
        >
          {offlineProgress?.ready
            ? "完整词库已保存 · Diccionari complet desat"
            : offlineInstalling
              ? `正在下载${percent !== undefined ? ` ${percent}%` : ""}…`
              : `下载完整离线词库${fullBytes ? ` · 约 ${(fullBytes / 1_000_000).toFixed(1)} MB` : ""}`}
        </button>
        <p className="license-link">
          iPhone：Safari → 分享 → 添加到主屏幕。 ·{" "}
          <a href="/dictionary/notices.json">来源与许可</a>
        </p>
      </div>
    </section>
  );
}

function ResultView({
  result,
  saved,
  onSpeak,
  onToggleSaved,
  onChooseCandidate,
}: {
  result: FoundLookup;
  saved: boolean;
  onSpeak: (text: string) => void;
  onToggleSaved: () => void;
  onChooseCandidate: (lemma: string) => void;
}) {
  const isReverse = result.matchedLanguage === "zh" || result.matchedLanguage === "es";
  const isResolved = result.normalizedQuery !== result.entry.normalizedLemma;
  const originalIsCatalan = result.matchedLanguage === "ca";
  const alternatives = result.candidates.filter(
    (candidate) => candidate.lemma !== result.lemma,
  );
  const parts = result.entry.partOfSpeech ?? [];
  const partLabel = parts
    .map((part) => PART_OF_SPEECH[part] ?? part)
    .join(" · ");
  const gender = result.entry.gender
    ? {
        masculine: "m.",
        feminine: "f.",
        common: "m./f.",
      }[result.entry.gender]
    : "";
  const chinese = primaryChinese(result.entry);
  const spanish = primarySpanish(result.entry);
  const catalanDefinitions = result.entry.definitions?.ca ?? [];
  const englishDefinitions = result.entry.definitions?.en ?? [];
  const examples = result.entry.examples ?? [];

  return (
    <section className="result-view" aria-label={`Result for ${result.searchedForm}`}>
      {isResolved || isReverse ? (
        <div className="resolution-card">
          <div className="resolution-line">
            <span lang={inputLanguage(result.searchedForm, result.matchedLanguage)}>{result.searchedForm}</span>
            {originalIsCatalan ? <SpeakerButton
              text={result.searchedForm}
              compact
              onSpeak={onSpeak}
            /> : null}
            <span className="resolution-arrow" aria-hidden="true">
              →
            </span>
            <span lang="ca">{result.lemma}</span>
          </div>
          {isReverse ? (
            <p>
              {LANGUAGE_LABELS[result.matchedLanguage as "zh" | "es"]} → Català
              {result.extractedQuery ? ` · 检索词：${result.extractedQuery}` : ""}
              {result.matchedTerm && normalizeCatalanInput(result.matchedTerm) !== (result.extractedQuery ?? result.normalizedQuery)
                ? ` · 匹配：${result.matchedTerm}` : ""}
            </p>
          ) : result.morphology ? <p>{result.morphology}</p> : null}
        </div>
      ) : null}

      <article className="definition-card">
        <header className="definition-header">
          <div>
            <p className="part-of-speech">
              {[partLabel, gender].filter(Boolean).join(" · ") || "entrada lèxica"}
            </p>
            <h2 lang="ca">{result.lemma}</h2>
            {result.entry.pronunciation ? (
              <p className="pronunciation" lang="ca-fonipa">
                {result.entry.pronunciation}
              </p>
            ) : null}
          </div>
          <SpeakerButton text={result.lemma} onSpeak={onSpeak} />
        </header>

        {catalanDefinitions.length > 0 ? (
          <div className="translation translation--catalan">
            <p className="translation-label">Català</p>
            <ol className="definition-list" lang="ca">
              {catalanDefinitions.map((definition) => (
                <li key={definition}>{definition}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {chinese ? (
          <div className="translation translation--primary">
            <p className="translation-label">
              中文
              {result.entry.chineseReference ? (
                <span className="translation-status" title="来自开放双语词库的对应词，部分词义可能尚未收录">
                  词库参考
                </span>
              ) : null}
              {result.entry.chineseMachine ? (
                <span className="translation-status" title="机器辅助翻译，保留原始来源，尚未逐词人工审校">
                  机器辅助
                </span>
              ) : null}
              {result.entry.chineseHeadword ? (
                <span className="translation-status" title="原词库仅有词头；这里提供译词参考，可能未涵盖所有词义">
                  译词参考
                </span>
              ) : null}
            </p>
            <p className="chinese-meaning" lang="zh-Hans">
              {chinese}
            </p>
          </div>
        ) : (
          <p className="translation-pending" lang="zh-Hans">原始词库的释义资料不足，暂无法确认这个词的中文含义。</p>
        )}

        {spanish ? (
          <div className="translation">
            <p className="translation-label">Español</p>
            <p className="spanish-meaning" lang="es">
              {spanish}
            </p>
          </div>
        ) : null}

        {!catalanDefinitions.length && englishDefinitions.length &&
          (result.entry.chineseMachine || (!chinese && !spanish)) ? (
          <div className="translation">
            <p className="translation-label">English · Wiktionary</p>
            <ol className="definition-list" lang="en">
              {englishDefinitions.map((definition) => (
                <li key={definition}>{definition}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {examples.length > 0 ? (
          <section className="examples" aria-labelledby="examples-heading">
            <h3 id="examples-heading">Exemples</h3>
            <ol>
              {examples.slice(0, 4).map((example) => (
                <li key={example.ca}>
                  <p lang="ca">{example.ca}</p>
                  {example.zh ? <p lang="zh-Hans">{example.zh}</p> : null}
                  {example.es ? <p lang="es">{example.es}</p> : null}
                  {!example.zh && !example.es && example.en ? (
                    <p lang="en">{example.en}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {result.entry.plural?.length || result.entry.forms?.length ? (
          <div className="entry-forms">
            {result.entry.plural?.length ? (
              <p>
                <span>Plural</span> {result.entry.plural.join(", ")}
              </p>
            ) : null}
            {result.entry.forms?.length ? (
              <p>
                <span>Formes</span> {result.entry.forms.slice(0, 8).join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          className={saved ? "save-button save-button--saved" : "save-button"}
          type="button"
          aria-pressed={saved}
          onClick={onToggleSaved}
        >
          <span aria-hidden="true">{saved ? "★" : "☆"}</span>
          {saved ? "Desat" : "Desa"}
        </button>

        {result.entry.source?.length ? (
          <p className="entry-sources">
            Fonts: {result.entry.source.join(", ")} ·{" "}
            <a href="/dictionary/notices.json">llicències</a>
          </p>
        ) : null}
      </article>

      {alternatives.length > 0 ? (
        <section className="alternatives" aria-labelledby="matches-heading">
          <p className="eyebrow" id="matches-heading">
            其他 Català 候选 · Altres coincidències
          </p>
          {alternatives.map((candidate) => {
            const entry = candidate.entry;
            return (
              <button
                key={candidate.lemma}
                type="button"
                onClick={() => onChooseCandidate(candidate.lemma)}
              >
                <span>
                  <strong lang="ca">{candidate.lemma}</strong>
                  <small>
                    {[
                      candidate.matchedLanguage
                        ? `${LANGUAGE_LABELS[candidate.matchedLanguage]}${candidate.matchedTerm ? ` · ${candidate.matchedTerm}` : ""}`
                        : undefined,
                      candidate.morphology,
                      candidate.partOfSpeech
                        ? PART_OF_SPEECH[candidate.partOfSpeech] ?? candidate.partOfSpeech
                        : undefined,
                    ].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <span lang={entry && primaryChinese(entry) ? "zh-Hans" : "es"}>
                  {entry ? primaryChinese(entry) || primarySpanish(entry) : ""}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

function MissView({
  query,
  extractedQuery,
  suggestions,
  relatedSuggestions,
  searchLanguage,
  offlineLimited,
  onSearch,
}: {
  query: string;
  extractedQuery?: string;
  suggestions: string[];
  relatedSuggestions?: SearchSuggestion[];
  searchLanguage?: SearchLanguage;
  offlineLimited?: boolean;
  onSearch: (term: string, mode?: SearchLanguage) => void;
}) {
  return (
    <section className="miss-view" aria-labelledby="not-found-heading">
      <span className="miss-mark" aria-hidden="true">
        ?
      </span>
      <p className="eyebrow">没有找到匹配的 Català 词条</p>
      <h2 id="not-found-heading" lang={inputLanguage(query, searchLanguage)}>
        {query}
      </h2>
      {extractedQuery ? <p className="miss-help">检索词：{extractedQuery}</p> : null}
      {offlineLimited ? (
        <p className="miss-help" lang="zh-Hans">
          已下载的离线词库中没有匹配结果。联网或下载完整词库后再试。
        </p>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="suggestions">
          <p>你要找的是不是…</p>
          {relatedSuggestions?.length ? relatedSuggestions.map((item) => (
            <button key={`${item.language}:${item.term}`} type="button"
              onClick={() => onSearch(item.term, item.language)}
              lang={inputLanguage(item.term, item.language)}>
              {item.term} <span aria-hidden="true">→</span> <span lang="ca">{item.lemma}</span>
            </button>
          )) : suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSearch(suggestion)}
              lang="ca"
            >
              {suggestion} <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      ) : !offlineLimited ? (
        <p className="miss-help" lang="zh-Hans">
          试试近义词、常用短语或单词原形，也可以切换输入语言。
        </p>
      ) : null}
    </section>
  );
}

function RecentStrip({
  history,
  onSearch,
}: {
  history: HistoryRecord[];
  onSearch: (term: string, mode?: SearchLanguage) => void;
}) {
  return (
    <section className="recent-strip" aria-labelledby="recent-strip-heading">
      <h2 id="recent-strip-heading">Recent</h2>
      <div>
        {history.map((record) => (
          <button
            key={record.normalizedQuery}
            type="button"
            onClick={() => onSearch(record.query, record.searchLanguage ?? "auto")}
            lang={inputLanguage(record.query, record.searchLanguage)}
          >
            {record.query}
          </button>
        ))}
      </div>
    </section>
  );
}

function SavedView({
  savedWords,
  onOpen,
  onRemove,
}: {
  savedWords: SavedRecord[];
  onOpen: (lemma: string) => void;
  onRemove: (lemma: string) => void;
}) {
  return (
    <section className="saved-view" aria-labelledby="saved-heading">
      <div className="saved-heading">
        <div>
          <p className="eyebrow">La teva llista</p>
          <h2 id="saved-heading">Desats</h2>
        </div>
        <span>{savedWords.length}</span>
      </div>

      {savedWords.length > 0 ? (
        <ul className="saved-list">
          {savedWords.map((record) => (
            <li key={record.lemma}>
              <button
                className="saved-word"
                type="button"
                onClick={() => onOpen(record.lemma)}
              >
                <strong lang="ca">{record.lemma}</strong>
                {primaryChinese(record.entry) ? (
                  <span lang="zh-Hans">{primaryChinese(record.entry)}</span>
                ) : null}
                {primarySpanish(record.entry) ? (
                  <small lang="es">{primarySpanish(record.entry)}</small>
                ) : null}
              </button>
              <button
                className="saved-remove"
                type="button"
                onClick={() => onRemove(record.lemma)}
                aria-label={`Remove ${record.lemma} from Saved`}
              >
                <span aria-hidden="true">★</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="saved-empty">
          <span aria-hidden="true">☆</span>
          <h3>Encara no hi ha cap paraula.</h3>
          <p>Desa les paraules que vulguis tenir sempre a mà.</p>
        </div>
      )}
    </section>
  );
}

