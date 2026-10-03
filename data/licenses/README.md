# Dictionary data licensing

The generated dictionary is assembled only from the sources pinned in
`data/sources.lock.json`. Every packed entry carries source identifiers and the
generated manifest repeats the source names, revisions, checksums, roles, and
licenses.

- Kaikki's Catalan extract is derived from English Wiktionary. Wiktionary text
  is available under CC BY-SA 4.0 and, where applicable, the GNU Free
  Documentation License. See <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use>
  and <https://creativecommons.org/licenses/by-sa/4.0/>.
- Catalan Wiktionary text is available under the same Wikimedia terms. Page
  histories provide the author attribution required for individual pages.
- `apertium-cat` and `apertium-spa-cat` are redistributed under GNU GPL v2.
  The verbatim license text is in `data/licenses/GPL-2.0.txt`; upstream source
  revisions are pinned in the lock file.
- FreeDict Catalan-Spanish edition 2025.11.23 is licensed under CC BY-SA 3.0.
  Its TEI header identifies Karl Bartel as maintainer and WikDict/DBnary/
  Wiktionary as the data path. See
  <https://creativecommons.org/licenses/by-sa/3.0/>.

No text from DIEC, VOX, Larousse, DDLC, or another commercial dictionary is
used by this build.

The small reviewed expression layer in `data/curated.json` was written for this
project and is dedicated to the public domain under CC0 1.0.

