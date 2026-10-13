# Chinese typo matching reference

Pinned `python-pinyin` v0.55.0 character readings at commit
`df101577145af2eb1abe5656e592e34e3bb56d23`, under its MIT license. The original
`pinyin_dict.json` is retained unchanged inside a deterministic gzip snapshot.
`sources.json` records original URLs and compressed/uncompressed SHA-256 hashes.

`python3 scripts/dictionary/build_chinese_search.py` verifies all pinned inputs
and derives `lib/chinese-search-data.json` with the first tone-free reading per
character plus the existing OpenCC longest-match t2s tables. No installed Python
package or network access is required. The app bundles these tables for offline
use and serves/pre-caches the original MIT notice as `pinyin-license.txt`.

Readings only help rank Chinese typo suggestions: same-length candidates must
retain an unchanged Han character and differ by at most two characters. They
never establish translation equivalence or turn an approximate match into an
exact result. Polyphonic characters use their primary reading only; contextual
pronunciation and Latin pinyin queries are outside this feature.
