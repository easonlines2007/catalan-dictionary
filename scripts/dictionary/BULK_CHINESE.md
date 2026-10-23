# Broad Chinese coverage preparation

The published snapshot adds Chinese meanings or explicit term references for
83,805 previously uncovered lemmas (95,319 selected source senses). Together
with original, reviewed and Wordnet Chinese, 97,668 of 97,675 entries have
Chinese, including all 5,027 core entries. Seven source-insufficient records
remain documented in `bulk/source-gaps.json`; they are not filled with generic
text or counted as translated. This is 99.99% presence, not a lexical accuracy
estimate, human approval or exhaustive coverage of every sense.

The bulk layer fills entries without original, source-compared batch, or
MCR/COW Chinese. It is separate from the original data packs and the failed
Argos experiment. Every row retains its exact source, language, POS, layer,
source IDs, SHA-256, base version, and a stable evidence identity.

## Selection and meaning

`prepare_bulk_chinese.py` reads the committed dictionary and current Chinese
overlays. It chooses at most three distinct English definitions, preferring a
substantive Catalan definition when the English glosses are all four words or
shorter. Otherwise it falls back to Catalan definitions, same-layer verified
Spanish equivalents, then the actual canonical Catalan headword. Obvious
editorial requests and broken template fragments are excluded.
`bulk/source-holds.json` retains exact known ambiguous source senses, including
the previously held `tan … que` construction. The builder rejects held rows
even if their hashes are otherwise valid. Clear senses of that same lemma can
still be translated; presence coverage does not imply the hold was resolved.

Definition translations are not an exhaustive inventory of senses. A Spanish
equivalent may be polysemous. A headword-only result is a **term reference**,
not a researched full definition: the app adds “译词参考” alongside “机器辅助”.
The original Catalan/English definitions remain available for comparison.

## Resumable online preparation

Only public dictionary text is sent to Microsoft Bing Translator. The client
is `bing-translate-api@4.2.1` (MIT), installed in ignored `work/`, without adding
an application dependency. No translation service is called by the PWA.
The preparation client uses its normal endpoint and stops on service limits or
captcha. It does not rotate identities or bypass service access controls.

```bash
npm install --prefix work/online-translation-runtime --ignore-scripts \
  --no-audit --no-fund bing-translate-api@4.2.1
python3 scripts/dictionary/prepare_bulk_chinese.py
node scripts/dictionary/translate_bulk_chinese.mjs --workers 4
```

The input plan must be prepared **before** publishing its Chinese layer; once
published, those entries are no longer missing. Keep the plan/checkpoints in
`work/bulk-chinese/` while preparing. Each successful result is appended
immediately; rerunning skips completed identities. Duplicate source texts can
reuse a response. Packets carry checked ordered markers; a damaged packet is
bisected. Empty/non-Chinese output, repeated text and placeholder markers go to
a separate issues file, which is never silently published. `--retry-issues`
permits an explicit retry. These structural checks do not prove lexical quality.
For unresolved terms, `prepare_chinese_retry.py` exports only the remaining
identities. The same executor with `--target en --output work/bulk-chinese/pivot.jsonl`
can retain a separate English intermediate; those records are marked
`intermediate-only` and never treated as Chinese. `prepare_chinese_retry.py
--from-pivot` prepares the second step. The final Chinese row retains its exact
original source plus `translationInput` containing the intermediate text,
language and route. Pivot output remains machine-assisted, especially for
headwords without explanatory source context. The attempted English pivot
and alternate-engine pilots in this run failed semantic review and were not
imported. The published snapshot uses successful direct translations,
grammatical templates and source-compared corrections only.

## Source-compared corrections

`bulk_chinese_rules.mjs` describes alternative spellings, grammatical forms and
alphabet names without translating the Catalan word being referenced.
`bulk/manual-corrections.json` retains exact-source corrections, reasons and
external primary references where used. Each record must match a current job.
Short original Chinese facts checked against DIEC, DCVB, GDLC, official
geographic tables and institution pages retain reference URLs. Source article
wording and examples are not redistributed; raw lookup responses remain in
ignored `work/`. Reference checks must distinguish exact headwords and POS
from prefix or accent-insensitive results. Acronyms are qualified where their
expansion depends on context. Source-gap records undergo the same identity
checks as translations and must never also be imported as Chinese.
Single-word Catalan synonym definitions may reference an exact existing lemma
with compatible POS. Their Chinese is explicitly phrased “参见「…」：…”, since
the target may be polysemous; it is not used to infer search aliases. The
source/Chinese/job identities of used targets are pinned in
`bulk/sources/chinese-references.json`. No recursive reference chains are used.

The optional `fetch_taxon_chinese.py` pins Wikidata labels using exact P225
scientific names in source definitions, with no fuzzy common-name guessing.
`bulk/sources/taxa.json` stores the names, query/response checksums, entity URLs,
language labels, retrieval date and CC0 notice. Conflicting labels are held.
Only whole scientific names or short unqualified taxon glosses are replaced.
Where Wikidata has no Chinese label, “生物分类名（学名：…）” retains an exact
taxonomic identity without inventing a Chinese name or indexing the generic
phrase “生物分类名”. Wider definitions and multi-species senses need separate
source comparison. Raw query responses are checkpointed in ignored `work/`.

```bash
python3 scripts/dictionary/fetch_taxon_chinese.py
python3 scripts/dictionary/prepare_chinese_corrections.py
node scripts/dictionary/publish_bulk_chinese.mjs
```

The publisher reports uncovered lemmas and senses separately under `work/`.
Corrections and literal templates may resolve a failed result, while keeping
the bulk layer's machine-assisted status. It creates sorted deterministic gzip
JSONL groups under `data/translations/bulk/`, with compressed checksums/row
counts, source/correction checksums, script hashes and an explicit manifest.
The published rows retain source text and correction evidence for later review.
They can reproduce the app data without contacting the translation service;
a future live translation run need not reproduce identical service responses.

## Offline build and validation

```bash
python3 scripts/dictionary/build_search.py
npm test
npm run lint
npm run typecheck
```

The offline builder verifies every row against actual committed source packs,
including canonical headword/POS/source IDs. Rehashing a fabricated source
does not make it valid. It checks base versions, gzip checksums and row counts,
rejects duplicates/placeholders and verifies supplemental snapshots. Original,
source-compared batch and MCR/COW Chinese take precedence. Bulk equivalents
carry `zhMachine`; headword-only results also carry `zhHeadword`. Explicit
aliases must occur literally in their Chinese translation and cannot be an
arbitrary invented search term. Other short equivalents use the normal
bounded reverse index. Simplified/traditional aliases are built with OpenCC.

All translations retain the attribution and licenses of their lexical sources;
Wikidata facts are CC0. “Has Chinese” measures presence of a meaning or term
reference, not complete sense coverage, human approval, or a corpus accuracy
estimate. The old Argos raw output remains excluded.

The 2026-10-23 adverb audit corrects three unrelated short machine equivalents:
`vialment`/`viàriament` previously read 正确地, and `llibreterament` read 自由地.
Their exact Spanish source forms are preserved. Qualified Chinese explanations
use the source morphology and primary references for the base words; the review
notes explicitly distinguish this interpretation from an attested dictionary
entry for each derived adverb. Empty explicit alias arrays prevent these narrow
explanations from creating unrelated generic search terms. Machine-assisted
labels, provenance, source identities and presence coverage are unchanged.
