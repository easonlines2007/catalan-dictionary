# Data sources and licensing

The production dictionary is generated from pinned, redistributable lexical
sources. No text from DIEC, DDLC, VOX, Larousse, or another commercial
dictionary is included.

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

## License links

- [GNU GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
- [Creative Commons BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- [GNU Free Documentation License 1.3](https://www.gnu.org/licenses/fdl-1.3.html)
- [Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

## Reproducibility and attribution

`data/sources.lock.json` records source URLs, exact revisions and SHA-256/SHA-512
checksums. `python3 scripts/dictionary/build.py` verifies those checksums before
building deterministic gzip shards. `/dictionary/notices.json` is shipped with
the PWA and records attribution, transformations, licenses and source IDs. Each
entry retains its contributing source IDs so the runtime can merge layers
without erasing provenance. Reuse of any layer must follow that layer's terms.

