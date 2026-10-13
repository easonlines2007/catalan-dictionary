# Pinned Wordnet source inputs

Upstream: https://github.com/omwn/omw-data

Revision: `406bf83b3c507a3d1f26e88252d5d66893fd36bf`.
`sources.json` records exact URLs, hashes, sizes, attribution and licenses.
The `.tab.gz` files contain the **unchanged upstream bytes**, compressed with
gzip level 9, an empty filename and timestamp 0. No network access is needed
to rebuild search packs. Both compressed and uncompressed hashes are checked.

- Catalan and Spanish: Multilingual Central Repository, CC BY 3.0.
- Mandarin Chinese: Chinese Open Wordnet, original COW copyright/license.
- The PWN 3.0 identifier reference license is also retained. No English
  WordNet lemma data is shipped in these source inputs.

Import rules and limitations are documented in `../../SEARCH_DATA.md`.
`exclusions.json` records known doubtful lemma/synset mappings and Chinese
terms. Update it when finding errors; preserve upstream snapshots. The source
comparison audit under `data/translations/wordnet/` is not human approval and
does not establish corpus accuracy. Generated alignment evidence is available
in `work/translation-queue/wordnet-alignment.jsonl` after rebuilding.

To recover an input, download its exact `url` from the lock, verify
`sourceSha256`, and, for a tab file, compress it using Python `gzip.GzipFile`
with `filename=""`, `mtime=0`, `compresslevel=9`. Verify `sha256` on the result.
Do not replace a pinned file with a newer upstream download under the same lock.
