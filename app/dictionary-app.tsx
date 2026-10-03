"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { POPULAR_SEARCHES } from "@/lib/dictionary";
import { dictionaryRepository } from "@/lib/dictionary-repository";
import { lookupWord, normalizeCatalanInput } from "@/lib/lookup";
import { findCatalanVoice, speakCatalan } from "@/lib/speech";
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
} from "@/lib/storage";
import type {
  FoundLookup,
  DictionaryManifest,
  HistoryRecord,
  LookupResponse,
  OfflineInstallProgress,
  SavedRecord,
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
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [savedWords, setSavedWords] = useState<SavedRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [manifest, setManifest] = useState<DictionaryManifest | null>(null);
  const [coreReady, setCoreReady] = useState(false);
  const [offlineProgress, setOfflineProgress] =
    useState<OfflineInstallProgress | null>(null);
  const [offlineInstalling, setOfflineInstalling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void requestPersistentStorage();
    Promise.all([getHistory(), getSavedWords()])
      .then(([storedHistory, storedSaved]) => {
        setHistory(storedHistory);
        setSavedWords(storedSaved);
      })
      .catch(() => {
        // Search remains fully functional if private browsing blocks IndexedDB.
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    dictionaryRepository
      .manifest()
      .then((nextManifest) => {
        if (!cancelled) setManifest(nextManifest);
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
        // The human-reviewed emergency overlay remains usable without the pack.
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

  const rememberLookup = async (found: FoundLookup) => {
    const optimisticRecord: HistoryRecord = {
      query: found.searchedForm,
      normalizedQuery: found.normalizedQuery,
      lemma: found.lemma,
      meaning:
        primaryChinese(found.entry) ||
        primarySpanish(found.entry) ||
        found.entry.definitions?.ca?.[0] ||
        "",
      timestamp: Date.now(),
    };

    setHistory((current) =>
      [
        optimisticRecord,
        ...current.filter(
          (record) => record.normalizedQuery !== found.normalizedQuery,
        ),
      ].slice(0, 20),
    );

    try {
      await Promise.all([
        addHistory(found),
        cacheLookup(found, manifest?.dataVersion),
      ]);
    } catch {
      // Device-local persistence can fail without blocking the lookup itself.
    }
  };

  const runSearch = async (rawQuery: string) => {
    const normalized = normalizeCatalanInput(rawQuery);
    if (!normalized) {
      inputRef.current?.focus();
      return;
    }

    setView("search");
    setQuery(rawQuery.trim());
    setSearching(true);
    setAnnouncement("");

    let nextResult: LookupResponse | null = null;
    try {
      const cached = await getCachedLookup(normalized);
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
        nextResult = await lookupWord(rawQuery);
      } catch {
        lookupFailed = true;
        nextResult = {
          status: "not-found",
          searchedForm: rawQuery.trim().normalize("NFC"),
          normalizedQuery: normalized,
          resolutionSource: "none",
          suggestions: [],
        };
      }
    }
    setResult(nextResult);
    setSearching(false);

    if (lookupFailed) {
      setAnnouncement(
        "Dictionary data is not available offline yet. Reconnect once to finish setup.",
      );
    } else if (nextResult.status === "found") {
      setAnnouncement(`${rawQuery}: ${nextResult.lemma}`);
      void rememberLookup(nextResult);
    } else if (nextResult.suggestions.length) {
      setAnnouncement(`No result. Did you mean ${nextResult.suggestions[0]}?`);
    } else {
      setAnnouncement(`No result for ${rawQuery}.`);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    const candidate = result.candidates.find(
      (item) => item.lemma === candidateLemma,
    );
    const entry =
      candidate?.entry ??
      (await dictionaryRepository.getEntry(normalizeCatalanInput(candidateLemma)));
    if (!candidate || !entry) return;

    setResult({
      ...result,
      lemma: candidateLemma,
      entry,
      morphology: candidate.morphology,
      confidence: candidate.confidence ?? 0,
    });
  };

  const installFullDictionary = async () => {
    setOfflineInstalling(true);
    setAnnouncement("Downloading the complete offline dictionary.");
    try {
      const [nextManifest, estimate] = await Promise.all([
        dictionaryRepository.manifest(),
        getStorageEstimate(),
      ]);
      const requiredBytes =
        nextManifest.sizes.compressedBytes ??
        nextManifest.sizes.gzipBytes ??
        nextManifest.sizes.rawBytes;
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
            Cerca una paraula en català
          </label>
          <div className="search-field">
            <span className="search-glyph" aria-hidden="true">
              ⌕
            </span>
            <input
              ref={inputRef}
              id="dictionary-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca una paraula..."
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="search"
              spellCheck={false}
            />
            <button
              className="search-submit"
              type="submit"
              aria-label="Cerca"
              disabled={searching}
            >
              <span aria-hidden="true">{searching ? "···" : "→"}</span>
            </button>
          </div>
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
                suggestions={result.suggestions}
                onSearch={(term) => void runSearch(term)}
              />
            ) : (
              <StartView
                history={history}
                onSearch={(term) => void runSearch(term)}
                onClear={() => void eraseHistory()}
                manifest={manifest}
                coreReady={coreReady}
                offlineProgress={offlineProgress}
                offlineInstalling={offlineInstalling}
                onInstallOffline={() => void installFullDictionary()}
              />
            )}

            {result && history.length > 0 ? (
              <RecentStrip
                history={history.slice(0, 4)}
                onSearch={(term) => void runSearch(term)}
              />
            ) : null}
          </>
        ) : (
          <SavedView
            savedWords={savedWords}
            onOpen={(lemma) => void runSearch(lemma)}
            onRemove={(lemma) => void removeSavedFromList(lemma)}
          />
        )}
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
            onClick={() => setView("saved")}
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
  manifest,
  coreReady,
  offlineProgress,
  offlineInstalling,
  onInstallOffline,
}: {
  history: HistoryRecord[];
  onSearch: (term: string) => void;
  onClear: () => void;
  manifest: DictionaryManifest | null;
  coreReady: boolean;
  offlineProgress: OfflineInstallProgress | null;
  offlineInstalling: boolean;
  onInstallOffline: () => void;
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
                <button type="button" onClick={() => onSearch(record.query)}>
                  <span className="history-query" lang="ca">
                    {record.query}
                  </span>
                  <span className="history-detail">
                    <span lang="ca">
                      {record.normalizedQuery === record.lemma
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
            <p className="eyebrow">Diccionari essencial</p>
            <h2 id="recent-heading">Una paraula, la forma correcta.</h2>
            <p>
              Escriu una forma com <strong>pujant</strong> o <strong>vaig</strong>.
              Trobarem el lema, el significat i exemples útils.
            </p>
          </div>
          <div className="try-block">
            <p>Prova-ho</p>
            <div className="quick-words">
              {POPULAR_SEARCHES.map((word) => (
                <button key={word} type="button" onClick={() => onSearch(word)}>
                  {word}
                </button>
              ))}
            </div>
          </div>
          <div className="install-note">
            <span className="install-note__mark" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>
                {coreReady ? "El vocabulari essencial ja és local" : "Preparant el mode local…"}
              </strong>
              <p>
                {manifest
                  ? `${manifest.coreLemmaCount.toLocaleString("ca")} lemes freqüents disponibles d’entrada; la resta es carrega per fragments.`
                  : "El diccionari es desa al dispositiu sense carregar-lo tot a la memòria."}
              </p>
              <button
                className="offline-download"
                type="button"
                disabled={offlineInstalling || offlineProgress?.ready}
                onClick={onInstallOffline}
              >
                {offlineProgress?.ready
                  ? "Diccionari complet desat"
                  : offlineInstalling && offlineProgress
                    ? `Desant ${offlineProgress.completed}/${offlineProgress.total}…`
                    : "Desa tot per usar-lo sense connexió"}
              </button>
              <p className="license-link">
                iPhone: Safari → Compartir → Afegir a la pantalla d’inici. ·{" "}
                <a href="/dictionary/notices.json">Fonts i llicències</a>
              </p>
            </div>
          </div>
        </>
      )}
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
  const isResolved = result.normalizedQuery !== result.lemma;
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
      {isResolved ? (
        <div className="resolution-card">
          <div className="resolution-line">
            <span lang="ca">{result.searchedForm}</span>
            <SpeakerButton
              text={result.searchedForm}
              compact
              onSpeak={onSpeak}
            />
            <span className="resolution-arrow" aria-hidden="true">
              →
            </span>
            <span lang="ca">{result.lemma}</span>
          </div>
          {result.morphology ? <p>{result.morphology}</p> : null}
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
            <p className="translation-label">中文</p>
            <p className="chinese-meaning" lang="zh-Hans">
              {chinese}
            </p>
          </div>
        ) : null}

        {spanish ? (
          <div className="translation">
            <p className="translation-label">Español</p>
            <p className="spanish-meaning" lang="es">
              {spanish}
            </p>
          </div>
        ) : null}

        {!catalanDefinitions.length && !chinese && !spanish && englishDefinitions.length ? (
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
            Altres coincidències possibles
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
                  <small>{candidate.morphology}</small>
                </span>
                <span lang="zh-Hans">
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
  suggestions,
  onSearch,
}: {
  query: string;
  suggestions: string[];
  onSearch: (term: string) => void;
}) {
  return (
    <section className="miss-view" aria-labelledby="not-found-heading">
      <span className="miss-mark" aria-hidden="true">
        ?
      </span>
      <p className="eyebrow">No hem trobat cap entrada</p>
      <h2 id="not-found-heading" lang="ca">
        {query}
      </h2>
      {suggestions.length > 0 ? (
        <div className="suggestions">
          <p>Volies dir…</p>
          {suggestions.map((suggestion) => (
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
      ) : (
        <p className="miss-help">Revisa els accents o prova el lema de la paraula.</p>
      )}
    </section>
  );
}

function RecentStrip({
  history,
  onSearch,
}: {
  history: HistoryRecord[];
  onSearch: (term: string) => void;
}) {
  return (
    <section className="recent-strip" aria-labelledby="recent-strip-heading">
      <h2 id="recent-strip-heading">Recent</h2>
      <div>
        {history.map((record) => (
          <button
            key={record.normalizedQuery}
            type="button"
            onClick={() => onSearch(record.query)}
            lang="ca"
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

