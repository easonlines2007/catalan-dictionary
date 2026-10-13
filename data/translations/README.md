# Chinese translation batches

The first Gemini handoff contains 25 existing lemmas and 49 revised senses.
Further batches are generated and checked by Codex. These are model-assisted translations reviewed
against the provided definitions by Codex, not a human lexicographer's approval.

The six current batches contain 211 records. Of these, 201 records with 375
selected senses are imported; 10 records remain `needs_review`. The original
2,884 Chinese-covered lemmas plus these additions give 3,085 covered lemmas.
A separate MCR/COW source-reference layer adds 10,785 lemmas (15,650 aligned
senses), bringing Chinese presence to 13,870. The source-bound bulk layer adds
83,798 previously uncovered lemmas (95,319 published source senses before
preserving the higher-priority translations), for
97,668 of 97,675 total entries. All 5,005 compact core lemmas now have Chinese.
Seven source-insufficient forms or abbreviations remain in `bulk/source-gaps.json`:
`anapat`, `carri`, `e)`, `e.`, `grl`, `ivaei`, `vé.`. They do not count as
translated. These counts measure presence of a meaning or term reference,
not complete sense coverage or human approval.

Bulk output, corrections and evidence snapshots live under `bulk/`; the app
labels this layer “机器辅助” and adds “译词参考” for headword-only results.
Original, reviewed and aligned Wordnet Chinese retain priority. Read
[`BULK_CHINESE.md`](../../scripts/dictionary/BULK_CHINESE.md) before regeneration.

Wordnet equivalents are visibly labelled “词库参考”, preserve synset provenance,
and do not replace existing or reviewed Chinese. Import requires matching
Catalan spelling, POS, PWN 3.0 synset, and an existing trusted Spanish equivalent
in that same synset. Sources, checksums, licenses and targeted exclusions are
retained under `scripts/dictionary/vendor/omw/`. The initial source-comparison
sample is retained at `wordnet/alignment-audit-0100.json`. It is model-assisted
review of selected mappings, not a corpus accuracy estimate or human approval.
See [`SEARCH_DATA.md`](../../scripts/dictionary/SEARCH_DATA.md) for limitations.

## Files and provenance

- `batches/zh-pilot-0001.input.json`: exact source evidence supplied to Gemini,
  including the original data version, commit, record source IDs, and input hashes.
- `batches/zh-pilot-0001.original.json`: Gemini's returned 25-record draft,
  preserved without rewriting its claims or statuses.
- `batches/zh-pilot-0001.reviewed.json`: source-compared revision used by the app.
  Each sense references evidence in the input record with the same ID.

Additional paired `*.input.json` / `*.reviewed.json` batches retain the same
evidence and hash schema. `needs_review` records, including their usable partial
senses, remain outside the published layer until the source doubts are resolved.

`translated` means a usable source-compared translation in this intermediate format;
it does not mean human approval. Future batches must be independently checked
before replacing or adding an imported reviewed batch. The original draft is
never imported by the runtime.

The input text retains the source IDs and licensing requirements described in
[`DATA_SOURCES.md`](../../DATA_SOURCES.md). These derived translations are not
relabelled as original CC0 content. Their sense-level source references remain
available for attribution and future data-pack generation.

## Review decisions

- Split `era`'s small arable plot from its threshing-floor sense.
- Separate `tipus`'s kind/category and model/exemplar senses. Remove unsupported
  material, mould, tax-rate, and motif-specific additions.
- Remove equal-division and competitive-partition implications from `partir`.
  Preserve its separate boundary-setting sense from `e009` (`partionar`). The
  short synonym was corroborated against the
  [IEC dictionary entry for partionar](https://cit.iec.cat/progdct/default.asp?id=877259&opcio=99).
- Remove unsupported natural-region/county equivalence from `comarca`, and
  interest-specific additions from `produir`'s general income sense.
- Remove the strict two-versus-three-person distinction from `entre`.
- Restrict evidence references to definitions that support the individual sense;
  unverified, polysemous Spanish hints cannot prove every sense at once.
- Tighten overly broad aliases, especially clock-time expressions and pronominal
  uses. Contraction explanations are useful grammatical definitions in their
  own right, so `pel` and `pels` are retained with empty aliases.

This pilot follows only the supplied lexical senses. For example, the input for
`una` and `dues` describes clock-time nouns, and `fou` has geographical noun
senses. It does not supply their common article/numeral/verb-form uses. Those
uses must be resolved through the morphology and lexical coverage work; this
translation batch must not manufacture them or claim complete sense coverage.

## Validation and runtime

```bash
python3 scripts/dictionary/validate_translation.py \
  data/translations/batches/zh-pilot-0001.input.json \
  data/translations/batches/zh-pilot-0001.reviewed.json
```

Structural validation checks identity, checksums, references, and shape. It
cannot establish translation correctness. The returned original draft also
passes structural validation despite needing semantic corrections.

`lib/chinese-enrichment.ts` imports the first small reviewed batches with the app. It
fills missing Chinese for existing entries, preserves existing authored Chinese,
and leaves Spanish, morphology, examples, and lemma identity untouched. The
repository applies it to ordinary and compact core lookups; storage readers also
apply it to older saved and cached entry snapshots without changing save dates.
It does not make an unavailable extended lemma part of the offline core.

`python3 scripts/dictionary/build_search.py` validates and imports every paired
reviewed batch into independently versioned Chinese shards and reverse indexes.
It preserves existing Chinese. Source definitions, referenced evidence and source
IDs remain in the paired JSON files. Compact offline entries contain the same
merged definitions as online lookups. Current coverage is reported in
`public/dictionary/search/manifest.json`; a count measures presence, not complete
sense coverage or lexical accuracy.

## Remaining work and rejected machine drafts

The builder exports deterministic, priority-ordered source queues under ignored
`work/translation-queue/`. Definitions, Spanish-only hints, and lemmas lacking
reliable evidence have separate queues. Evidence-free lemmas need source research;
an untranslated headword is not enough to invent a Chinese definition.

The local Argos/OPUS experiment is quarantined. Its mechanically accepted output
still contained material sense errors. A reproducible 100-record semantic audit
is retained at `machine/audits/zh-offline-sample-0001.json`: 29 clear errors and
4 context-insufficient glosses were found in that sample. These are sample
results, not a claim about the entire corpus. Raw model output is not imported
by the default build. Corrected translations must pass a separate source review
and become an ordinary paired batch. See
[`TRANSLATION_RUNTIME.md`](../../scripts/dictionary/TRANSLATION_RUNTIME.md).
- The everyday batch compares 11 common lemmas and 20 selected senses with
  their original definitions. `ara` now distinguishes 现在 from its 祭坛 noun
  sense; the unsupported Ara constellation alignment is held separately.
  `ahir`, `hola`, `urgent` and `castellà` receive concise usable meanings;
  time, greeting, milk and Castilian senses remain separate. Original Chinese
  is preserved. These are model-assisted source comparisons, not human approval.
