# Offline Chinese translation candidates

This document describes the **rejected historical Argos experiment**, whose
raw drafts remain outside the default build. The published full-coverage
preparation uses a different pipeline documented in
[BULK_CHINESE.md](BULK_CHINESE.md).

`translate_missing.py` translates **existing, source-backed definitions**. It
does not translate an unexplained headword or invent missing senses, and it
does not modify production packs. Its output remains a machine-generated draft.

## Runtime

Python 3.9+ with CTranslate2 4.8.2 and SentencePiece 0.2.1 can run the existing
small Argos model packages on an Apple Silicon CPU with INT8 computation.
The script loads the model and tokenizer directly from the local ZIP in memory;
it does not install Argos, Stanza or PyTorch and makes no network requests.

```bash
python3 -m pip install --target work/translation-runtime \
  ctranslate2==4.8.2 sentencepiece==0.2.1
```

The local machine already had CTranslate2. Only the 1.3 MB SentencePiece wheel
was installed for this work. Two complete historical model packages were found:

- `/Users/easonlin/Documents/Codex/2026-08-31/new-chat/work/pdfs/translate-en_zh-1_9.argosmodel`
- `/Users/easonlin/Documents/Codex/2026-08-31/new-chat/work/pdfs/translate-ca_en-1_7.argosmodel`

The similarly named Hugging Face cache directories contained only revision
references, not model weights. `ba/work/models/catalan-4bit` is a Whisper speech
recognition model and cannot be used for this text translation.

## Evidence and checkpointing

The input JSONL schema is one source definition per line:

```json
{"normalizedLemma":"cala","evidenceId":"e001","sourceText":"a narrow cove","sourceLanguage":"en","sourceIds":["kaikki-enwiktionary-ca"],"sourceHash":"SHA-256 of the exact UTF-8 sourceText"}
```

The hash is validated before translation. Original fields are preserved in each
result; additional fields record the route, intermediate English when pivoting,
model package SHA-256, engine version, beam size, model score and quality flags.
The model score is a decoder statistic, **not** an accuracy probability.

Use the English-priority queue: all English definitions for a lemma when
available, otherwise its Catalan definitions. The default selects the first
three definitions per lemma; `--max-definitions-per-lemma 0` selects all.
Retain a deterministic input order so this selection is stable across runs.

```bash
python3 scripts/dictionary/translate_missing.py \
  work/translation-queue/input.jsonl \
  work/translation-queue/translated.jsonl \
  --en-zh-model /path/to/translate-en_zh-1_9.argosmodel \
  --ca-en-model /path/to/translate-ca_en-1_7.argosmodel \
  --limit 1000
```

Rerun the same command to process the next 1,000 pending rows, or omit `--limit`
to finish the selected queue. Completed evidence identities in both output
files are skipped, and repeated exact source text can reuse a translation from
the same model configuration. Each JSONL row is flushed as it is appended.
An invalid or interrupted JSON line produces an explicit error rather than
silently losing or accepting incomplete evidence; preserve the invalid line
for diagnosis before removing only that incomplete tail and resuming.

## Quality separation

- `translated.jsonl` contains only `reviewStatus: "machine-translated"` rows.
- `translated.jsonl.issues.jsonl` contains `reviewStatus: "needs-review"` rows.
- `translated.jsonl.report.json` records the latest run's time, processed rows,
  flagged count, flag frequencies and remaining selected rows.

Every pivot translation is routed to `needs-review`, as are grammatical
definitions, no-Chinese output, substantial residual Latin text, decoding limits,
repetition, suspicious expansion and some observed hallucinations. One-word
English input receives an ambiguity flag; it remains a draft candidate.

These are conservative mechanical filters, not semantic validation. Unflagged
output can still have a wrong sense, unnatural Chinese, omitted information or
hallucination. Automatic inclusion must preserve a visible machine-translation
status, and all results require further source comparison before being called
reviewed. The app should exclude the issues file from its default definitions.

The initial smoke test took approximately 0.32 seconds for 20 English definitions
and 0.42 seconds for 10 Catalan-to-English-to-Chinese definitions. These tiny
samples do not establish full-corpus speed or translation quality. In particular,
the Catalan model mistranslated a noun definition as a second-person instruction,
and the Chinese model expanded it into unrelated religious language; that output
must be rejected.

## Attribution

The English–Chinese package's README identifies its upstream OPUS-MT model as
CC BY 4.0 and credits Jörg Tiedemann and Santhosh Thottingal, *OPUS-MT — Building
open translation services for the World*, EAMT 2020. The Catalan–English README
credits OPUS and Wiktionary/Wiktextract but supplies no explicit model license;
do not infer a package license from the Argos software license. The script does
not redistribute model weights. Existing lexical source IDs and licenses remain
attached to the derived definitions as described in `DATA_SOURCES.md`.

Official implementation references:

- [CTranslate2 model loading and batch API](https://opennmt.net/CTranslate2/python/ctranslate2.Translator.html)
- [CTranslate2 hardware support](https://opennmt.net/CTranslate2/hardware_support.html)
- [Argos Translate's pivot translation documentation](https://github.com/argosopentech/argos-translate)

The absent NLLB weights were not downloaded or used. Its model terms must be
considered separately before use; the Argos/OPUS licenses do not apply to NLLB.
