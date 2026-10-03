# Offline dictionary builder

`build.py` creates the complete versioned offline data set from the files
pinned in `data/sources.lock.json`. It uses only the Python standard library.

The committed packs are ready to use; `npm ci` and `npm run build` do not
rebuild them. To regenerate data, first supply the input files under
`work/sources/` at the exact paths and checksums in the lock file:

- The Apertium inputs are included in
  `public/dictionary/sources/apertium-corresponding-source.tar.gz`.
  Place its `apertium-cat/` and `apertium-spa-cat/` directories under
  `work/sources/`.
- Obtain the matching Kaikki JSONL, Catalan Wiktionary XML dump and FreeDict
  source archive from the listed sources. The Kaikki and Wikimedia URLs
  change over time; a newer download may not match the pinned snapshot.
  Original non-Apertium snapshots are not bundled here.
- Keep all upstream attribution and licenses. If changing inputs, update
  their checksums and rebuild the complete set.

```bash
python3 scripts/dictionary/build.py
```

The build verifies every input checksum before parsing it. Output is written
atomically to `public/dictionary/` and contains a stable manifest, deterministic
gzip JSON shards, per-source attribution, and QA statistics. Vercel does not
need network access during `next build`.

Lexicon shards contain packed entry objects. Morphology shards are sorted
`[surface, analyses]` rows, where each analysis is
`[lemma, morphology?, partOfSpeech?]`. Prefix shards contain
`[accentFoldedKey, normalizedLemma]` rows. Descriptor `first`/`last` values are
inclusive and permit binary routing without loading a global lemma list.
