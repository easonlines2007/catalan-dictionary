# Trilingual search data

`build_search.py` builds reverse Chinese/Spanish lookup indexes and a complete
core lexicon from the **already committed** dictionary packs. It does not need
the absent original Kaikki/FreeDict snapshots and does not change
`public/dictionary/manifest.json` or any original data pack.

```bash
python3 scripts/dictionary/build_search.py
```

Only Python's standard library is required. Input pack SHA-256 checksums and
row counts are verified before use. `lib/dictionary.ts`'s fixed legacy seed
object is parsed as literal fields without executing TypeScript. Changes to its
shape fail explicitly instead of silently losing translations.

## Manifest and routing

The independent entry point is `/dictionary/search/manifest.json`:

- `schemaVersion: 1`, `dataVersion`, and `baseDataVersion` bind the search data to
  its exact base dictionary. The search version incorporates the builder,
  original manifest, seed, reviewed inputs/outputs, optional machine input, and
  pinned conversion dictionaries.
  It also binds the pinned Wordnet sources, importer, and targeted exclusions.
  Published bulk Chinese, corrections, supplemental snapshots and their importer
  are bound by the separate bulk manifest. See [BULK_CHINESE.md](BULK_CHINESE.md).
- `core.entries` describes `PackedDictionaryEntry[]` merged from all lexical
  layers, reviewed Chinese, and the authored seed. It contains all original
  5,000 core lemmas plus any seed-only lemmas. Definitions are retained in core
  so offline users do not lose their meanings after downloading only morphology.
- `core.zh` and `core.es` describe the corresponding core reverse indexes.
- `indexes.zh` and `indexes.es` are full sorted reverse index shard descriptors.
- `suggestions.zh` and `suggestions.es` are compact, lazy-loaded full term
  catalogues: `[normalizedTerm, displayTerm, CatalanLemma, frequencyRank][]`.
  They are derived only from accepted reverse postings, with the most frequent
  posting supplying the lemma preview. Clicking still performs the normal
  language-specific lookup, retaining all alternative meanings. Chinese uses
  each indexed simplified/traditional key as its display term; Spanish retains
  the original accented spelling.
- `chinese` is a sorted list of Chinese overlay descriptors routed by normalized
  Catalan lemma. These overlays fill missing Chinese; upstream or authored
  Chinese takes precedence.
- `offline.core` and `offline.full` contain complete descriptor objects,
  including `kind`, `id`, `path`, `sha256`, `bytes`, `rawBytes`, and inclusive
  `first`/`last` in JavaScript UTF-16 ordinal order, permitting binary routing
  without a global vocabulary. Full search installation includes the three core assets, all
  reverse index shards, and all Chinese shards. The original dictionary's
  offline pack list is installed separately.
- Descriptor kinds are `search-core`, `search-zh`, `search-es`,
  `search-chinese`, and `search-suggestions`.

## Partial matches and completions

Typing is debounced by 180 ms; composition events defer suggestions until the
Chinese IME commits. Stale work is cancelled and catalogues are reused. Matching
yields between bounded chunks instead of blocking mobile input. Results rank
exact keys, prefixes, internal substrings, then restricted Damerau–Levenshtein
spelling distance (one edit below six characters, up to two for longer terms).
Frequency and length break ties. One Chinese character or two Spanish letters
enable partial matches; spelling corrections require at least two Chinese
characters or three Spanish letters. Up to eight results show the term,
language and Catalan lemma; approximate spellings are explicitly labelled.
This is lexical matching, not semantic or pinyin search. A failed exact lookup
shows suggestions without silently replacing it with an approximate result.

Chinese additionally uses bundled, checksummed OpenCC t2s and python-pinyin
primary readings. Reproduce those tables with
`python3 scripts/dictionary/build_chinese_search.py`; this needs only the
vendored snapshots and Python's standard library. Conversion uses longest
phrase matches, joins accidental Han-to-Han spaces and removes edge punctuation.
Exact lookup tries the untouched key first, then this normalized Chinese key.
It does not strip meaningful modifiers for exact lookup.

Chinese suggestions coalesce simplified/traditional equivalents and show at
most one hint per Catalan lemma, choosing the user's script when available.
Short literal terms outrank long prose; length precedes frequency within a
match tier. A trailing 的 can offer a labelled headword hint, while an exact
adjective always wins. Same-reading spelling corrections require the same
length, at least one unchanged Han character in the same position, and at most
one changed character (two for five or more characters). Only primary tone-free
readings are used, so polyphonic characters are intentionally conservative.
Literal matches are not padded with unrelated fuzzy terms; if strong phonetic
hints exist, weaker edit-only guesses are omitted. Latin-input pinyin search
and general semantic paraphrasing are not implemented.

`data/search/chinese-aliases.json` supplies a small set of source-compared
everyday Chinese aliases. The builder verifies the base version and every
evidence field against actual committed records, binds the file hash into the
search version, and adds these aliases without removing original reverse keys
or changing visible definitions. The targeted matisació correction removes an
unrelated greeting fragment from its published machine output; it retains the
original source identity and machine-assisted label.
An explicitly preferred source-compared alias can put the precise phrase
`estació de tren` before a rarer synonym for 火车站. Its optional posting priority
survives hydration into lookup candidates; other meanings stay selectable.
Exact Spanish spelling still precedes this optional priority, and Chinese
script/spacing equivalents share the same normalized-exact status.

Full offline installation includes both full catalogues. Core-only offline
mode derives suggestions from the existing core reverse indexes and entries,
and never requests the extended catalogues. A failed online catalogue load
can fall back to those same core terms. Missing catalogue descriptors in an
older cached manifest are also compatible with this fallback.

Every compressed asset has an immutable path under
`/dictionary/search/<dataVersion>/`. Gzip output has a zero timestamp and no
filename/platform header variation. No old version is deleted by the builder.
The small mutable manifest is written only after all assets have been written.

A reverse shard is a JSON array:

```json
[
  ["escuela", [["escola", "escuela", "translation"]]],
  ["学校", [["escola", "學校", "translation"]]]
]
```

The posting is `[normalizedCatalanLemma, matchedTerm, matchKind, priority?]`; `matchKind`
is exactly `translation` or `alias`. Ranking uses matching exact spelling,
match type, and the loaded entry's frequency rank. The browser routes by shard
boundaries and never scans the full dictionary to discover translations.
Postings are also preordered by entry frequency so a bounded candidate read
does not discard common words in favour of alphabetically earlier rare lemmas.

Spanish keys apply NFC, lowercase, the same apostrophe/hyphen and whitespace
normalization as Catalan lookup, then remove vowel accents while preserving
`ñ` as a separate letter. Thus `camión` routes to `camion`, and `niño` remains
different from `nino`. The original `matchedTerm` supports exact-spelling
priority. Chinese keys apply NFKC, lowercase, trim, and whitespace normalization.

## Source and translation quality

Spanish equivalents from Apertium, FreeDict, and project-authored records are
indexed. The committed Wiktionary `es` field contains uncertain language labels;
it is only considered corroborated when **the same lemma** already has the
same equivalent in a trusted layer. Uncorroborated fields are excluded and
counted in `excludedSpanish`. Membership in a global Spanish vocabulary is not
sufficient evidence of the correct meaning.

Reviewed batches under `data/translations/batches/*.reviewed.json` must have a
paired `.input.json`, pass `validate_translation.py`, and match the current
base dictionary version. Every evidence text, language, layer, part of speech
and source ID must also match the committed source packs; recomputing a local
input hash cannot authorize a changed definition. Only records with
`status: translated` are imported.
Their `aliasesZh` alone become reverse-search terms: grammatical explanations
with empty aliases are displayed without becoming misleading search keywords.
The status denotes source-compared model-assisted work, not approval by a human
lexicographer. Source IDs and the batch ID remain attached to each overlay.

Missing Chinese also receives a separate **source-reference** layer aligned
between MCR Catalan/Spanish and Chinese Open Wordnet. These are not counted as
reviewed translations. Import requires the exact normalized Catalan lemma,
matching noun/verb/adjective/adverb POS, the same PWN 3.0 synset ID, and an
existing trusted Spanish equivalent matching a Spanish lemma in that same
synset. Evidence comparison preserves Spanish accents. Proper-noun-only,
uncorroborated, held, and existing-Chinese entries are excluded.

`vendor/omw/` retains deterministic gzip copies of the upstream files unchanged,
their exact revision/URLs/checksums and original licenses. Every build checks
compressed and uncompressed hashes. `exclusions.json` records targeted sense
and term holds from an initial source comparison; it is not an exhaustive
lexicographic review. The durable 100-record audit is under
`data/translations/wordnet/`. COW's `+的` composition marker becomes `的`;
invalid or overly long terms are rejected. All accepted senses remain, with
up to three visible synonyms per sense and every accepted term in the reverse
index. Synset-level `pv` provenance and `zhReference: true` remain in packed
entries; the UI displays “词库参考”. Some source senses can be incomplete or
wrong despite these checks. Existing/reviewed Chinese always takes precedence.

The reference data retains MCR's CC BY 3.0 and COW's copyright/license;
license notices are served alongside the search data and cached for offline
use. This derived product is not an official Princeton WordNet release.

Existing short Chinese equivalents split at explicit semicolons/list separators;
long prose is never split into arbitrary characters or substrings. Authored
seed Chinese semicolons and Spanish slashes follow the runtime's existing split.
Original Chinese strings remain untouched. Original traditional spellings and
simple and traditional aliases are indexed using longest-match conversion tables
derived from pinned OpenCC 1.1.9 `TSCharacters.txt`, `TSPhrases.txt`,
`STCharacters.txt` and `STPhrases.txt`. Traditional aliases are produced from
the simplified equivalent, including when the source supplies only simplified
Chinese. Conversion does not enumerate every regional/ambiguous variant.
This is a bounded alias conversion, not a claim to implement all OpenCC modes.

The tables, Apache-2.0 license, URLs, and SHA-256 hashes are vendored under
`vendor/opencc/`; each build verifies them. The license is also served at
`/dictionary/search/opencc-license.txt`. Upstream reference:
[OpenCC 1.1.9 t2s configuration](https://github.com/BYVoid/OpenCC/blob/ver.1.1.9/data/config/t2s.json).
The [s2t configuration](https://github.com/BYVoid/OpenCC/blob/ver.1.1.9/data/config/s2t.json)
documents the reverse direction's source tables.
All original dictionary licenses continue to apply to merged data and derived
translations; Chinese translations are not relabelled as original CC0 work.

## Translation queue

The ignored `work/translation-queue/` directory is rebuilt deterministically:

- `missing-chinese.jsonl`: one source-bound record per missing lemma, with full
  per-layer evidence, source IDs, priority, and canonical input hash. Its record
  format matches the translation validator's input records.
- `definitions.jsonl`: every declared Catalan/English definition as a separate
  record with `normalizedLemma`, `evidenceId`, `sourceText`, `sourceLanguage`,
  `sourceIds`, and `sourceHash` (SHA-256 of the exact UTF-8 source text).
- `input.jsonl`: the English definitions for each lemma, falling back to
  Catalan definitions only if no English definitions exist.
- `spanish-hints.jsonl`: source-verified Spanish equivalents kept separately;
  equivalents are not asserted to establish every sense of a polysemous lemma.
- `needs-source.jsonl`: missing lemmas without a usable definition or verified
  Spanish equivalent. These require source research; no Chinese is invented.
- `machine-review.jsonl`: any explicitly imported machine lemmas, still marked
  `machine-translated`.
- `wordnet-alignment.jsonl`: accepted synsets, Chinese terms, exact Spanish
  corroboration and contributing source IDs for each reference lemma.
- `coverage.json`: counts of existing, reviewed, machine, missing, core, and
  source-backed coverage. These measure data presence, not correctness or
  complete sense coverage.

Queue ordering is core first, then frequency rank, then normalized lemma.
Source language labels are upstream declarations; the queue is evidence for
review rather than a guarantee of language correctness.

## Optional machine draft input

The current bulk layer is an explicitly published release under
`data/translations/bulk/`, imported by default after original, reviewed and
MCR/COW Chinese. It retains machine-assisted and headword-reference labels.
The standalone experimental input option below is a different mechanism;
arbitrary raw drafts in `work/` are never included by default.

Machine output is **not imported by default**, even if a file exists in `work/`.
An explicit opt-in is available for a release that intentionally includes drafts:

```bash
python3 scripts/dictionary/build_search.py \
  --machine-input data/translations/machine/example.jsonl
```

Every line must preserve the exact `normalizedLemma`, `evidenceId`,
`sourceText`, `sourceLanguage`, `sourceIds`, and `sourceHash`, add
`translationZh`, and set `reviewStatus: machine-translated`. The importer binds
each line to the actual committed Catalan/English definition and rejects
mismatched hashes, duplicate evidence, placeholders, or non-Chinese output.
Existing Chinese and reviewed translations take precedence. Machine overlays
set `zhMachine: true`; the UI must visibly label them as machine drafts. This
validation establishes input binding, not translation accuracy.

Failed or suspicious output belongs in a separate issues file and cannot be
silently imported. A published machine input must be retained under
`data/translations/machine/` with its model/source metadata, rather than existing
only in ignored `work/`. The initial local Argos experiment produced material
sense errors; its raw candidates remain quarantined pending individual review.
