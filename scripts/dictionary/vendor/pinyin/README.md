# Chinese typo matching reference

Pinned `python-pinyin` v0.55.0 character and phrase readings at commit
`df101577145af2eb1abe5656e592e34e3bb56d23`, under its MIT license. The original
`pinyin_dict.json` and `phrases_dict.json` are retained unchanged inside
deterministic gzip snapshots.
`sources.json` records original URLs and compressed/uncompressed SHA-256 hashes.

`python3 scripts/dictionary/build_chinese_search.py` verifies all pinned inputs
and derives `lib/chinese-search-data.json` with the first tone-free reading per
character, 3,543 contextual phrase entries and the existing OpenCC longest-match
t2s tables. Phrase entries retain exceptions plus longer default-reading phrases
needed to block shorter exceptions inside those known phrases. Redundant
default-reading entries are omitted; matching is intentionally bounded and
does not implement the upstream package's segmentation engine. No installed Python
package or network access is required. The app bundles these tables for offline
use and serves/pre-caches the original MIT notice as `pinyin-license.txt`.

Readings only help rank Chinese typo suggestions: same-length candidates must
retain an unchanged Han character and differ by at most two characters. They
never establish translation equivalence or turn an approximate match into an
exact result. Longest phrase readings distinguish 银行 (háng) from 行李 (xíng)
and 音乐 (yuè) from 快乐 (lè). Other characters use one primary reading rather
than every alternative sound. This is a bounded typo-ranking aid, not a full
Chinese pronunciation engine; Latin pinyin queries are outside this feature.
