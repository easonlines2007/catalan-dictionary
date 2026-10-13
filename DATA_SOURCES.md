# Data sources and licensing

The production dictionary is generated from pinned, redistributable lexical
sources. No source article wording, examples, or full articles from DIEC,
DCVB, GDLC, DDLC, VOX or Larousse are redistributed. Selected difficult
terms were checked against public dictionaries, official geographic tables
and institution pages. Their short Chinese factual descriptions are
project-authored; source URLs and audit metadata accompany them in
`data/translations/bulk/sources/`.

## Data shipped in this repository

- **Apertium Catalan** and **Apertium Spanish–Catalan**, pinned to commits
  `17b7046f…` and `7635fe70…`, provide lemma, morphology, part-of-speech and
  Spanish-equivalent data under **GPL-2.0-only**. Their generated packs remain
  a separate physical layer. The exact corresponding source, build script and
  GPL notice are distributed at
  `/dictionary/sources/apertium-corresponding-source.tar.gz`.
- **FreeDict cat-spa 2025.11.23** provides Catalan headwords, definitions,
  pronunciation and Spanish equivalents under **CC BY-SA 3.0**. It remains a
  separate enrichment layer.
- **English Wiktionary via Kaikki** and the pinned **Catalan Wiktionary dump**
  provide headwords, forms, Catalan/English definitions and pronunciation
  under **CC BY-SA 4.0 and GFDL 1.3-or-later**. They remain separate
  Wiktionary lexicon and morphology layers.
- The small project-authored Chinese/Spanish seed and one reviewed expression
  overlay are original project work; the generated overlay is **CC0-1.0**.
- Separate Chinese translation batches derive from the existing FreeDict and
  Wiktionary definitions. Codex generated or revised the translations through
  source comparison; they are not human lexicographer approvals. Original
  evidence, sense-level references, and the unrevised drafts are retained in
  [`data/translations/`](data/translations/README.md). Source licensing and
  attribution requirements continue to apply to these derived translations.
- The separate **bulk Chinese layer** translates missing definitions or verified
  Spanish equivalents with Microsoft Bing Translator and retains source-bound
  checkpoints, correction evidence and reproducible published gzip snapshots
  under `data/translations/bulk/`. Entries without definitions/equivalents have
  a visibly labelled headword-only term reference. This is machine-assisted
  coverage, not individual human review or complete sense coverage. The app
  makes no translation-service requests. Chinese retains its original lexical
  source attribution/licensing; see
  [`BULK_CHINESE.md`](scripts/dictionary/BULK_CHINESE.md).
- A bounded **Wikidata** snapshot corrects scientific-name glosses using exact
  P225 identities and Chinese labels where available. Structured Wikidata facts
  are **CC0-1.0**; the snapshot retains entity URLs, language, retrieval date and
  checksums. It is partial: service limits stop further retrieval, and cached
  responses are packaged without bypassing those limits. Missing Chinese labels
  retain the scientific name. The lexical definitions' licenses still apply.
  See [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing).
- Chinese reverse-search aliases use pinned OpenCC 1.1.9 conversion tables
  under Apache-2.0. The tables, checksums and license are retained in
  `scripts/dictionary/vendor/opencc/`; the license is served with the search data.
  Search indexes retain original source IDs and licenses. See
  [`SEARCH_DATA.md`](scripts/dictionary/SEARCH_DATA.md) for reproducible generation
  from the committed packs and for excluded, unverified Spanish fields.
- Chinese typo suggestions use the primary character readings from
  **python-pinyin 0.55.0** (MIT), pinned to commit `df101577…` with its original
  license and checksummed snapshot under `scripts/dictionary/vendor/pinyin/`.
  The runtime uses tone-free readings only to rank bounded same-reading typo
  suggestions. These do not add translations or assert pronunciation in context.
  The MIT notice is served and cached at `/dictionary/search/pinyin-license.txt`.
  A few project-authored everyday search aliases in `data/search/chinese-aliases.json`
  are checked against exact existing lexical evidence; they do not replace source
  definitions or change Chinese coverage counts.
- **Multilingual Central Repository Catalan/Spanish** (CC BY 3.0) and
  **Chinese Open Wordnet** (Copyright 2013, 2014 Francis Bond and Shan Wang;
  redistributable under its original license), via a pinned Open Multilingual
  Wordnet revision, add source-reference Chinese equivalents to missing entries.
  Exact lemma/POS/synset matching and same-synset trusted Spanish corroboration
  are required. Synset provenance remains attached; the UI marks these as
  “词库参考”. Source snapshots, hashes, licenses and targeted exclusions are
  retained in `scripts/dictionary/vendor/omw/`. Served license copies are under
  `/dictionary/search/` and included in offline preparation. The original
  copyright notices apply to all copies and modifications. See the
  [official OMW format and alignment documentation](https://omwn.org/omw1.html)
  and [Chinese Open Wordnet](https://bond-lab.github.io/cow/).

## License links

- [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
- [Creative Commons BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- [GNU Free Documentation License 1.3](https://www.gnu.org/licenses/fdl-1.3.html)
- [Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/)

## Reproducibility and attribution

`data/sources.lock.json` records source URLs, exact revisions and SHA-256/SHA-512
checksums. `python3 scripts/dictionary/build.py` verifies those checksums before
building deterministic gzip shards. `/dictionary/notices.json` is shipped with
the PWA and records attribution, transformations, licenses and source IDs. Each
entry retains its contributing source IDs so the runtime can merge layers
without erasing provenance. Reuse of any layer must follow that layer's terms.

