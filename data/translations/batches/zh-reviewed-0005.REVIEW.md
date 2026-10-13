# Source comparison for zh-reviewed-0005

This batch adds 124 selected senses for 100 core lemmas. Ninety-four lemmas were
selected through the fixed-seed audit of the first 1,000 offline MT attempts;
`de`, `i`, `el`, `a`, `que` and `en` were then added by core-first priority rank.
All 100 lemmas have `core: true` in the evidence export. Each lemma has at most
three selected senses. This is partial sense coverage, not a claim that every
meaning or grammatical use of each lemma has been translated.

The Chinese text was written through direct comparison with the original
English and Catalan definitions by Codex. It is model-assisted source review,
not human lexicographer approval. Raw OPUS-MT candidates were not imported.
The separate audit retains the attempted translations and their errors in
`data/translations/machine/audits/zh-offline-sample-0001.json`.

The 100-item audit found 67 outputs with usable core meaning but wording in need
of polish, 29 clear errors, and 4 isolated source glosses with insufficient
context. Those are results of this sample only, not a corpus accuracy estimate.
The MT output remains under ignored `work/translation-queue/` and must not be
used as reviewed Chinese data.

## Additional evidence and exclusions

- `compost`: select the explicit Catalan definitions for composite structure,
  a chemical compound, and compost fertilizer. An isolated `compound` gloss
  cannot distinguish these senses by itself.
- `celta`: distinguish the Celtic adjective, a Celt, and a Celtic language using
  their separate original definitions. Do not translate every occurrence as a
  language.
- `banda`: select side, criminal gang, and the explicitly defined musical band.
  The isolated English `bend` remains unverified and is excluded.
- `figura`: select visible shape, a painted/drawn representation, and a notable
  person. The isolated English `charge` remains unverified and is excluded.
- `cardenal`: support the cardinal/church-office translation with the explicit
  Catalan church definition; do not infer the sense only from English `cardinal`.
- `roca`, `mida`, `conreu`, `entorn` and `denominació`: prefer explicit Catalan
  definitions where short English glosses permit unrelated senses or could
  encourage an overly broad translation.
- `això`: use its explicit Catalan definition of proximity in space, time or
  discourse, rather than deriving a deictic distinction from English `that, it`.
- `que`: use the explicit Catalan conjunction and relative-pronoun definitions.
  Its short English `that` gloss does not establish a particular grammatical
  meaning by itself.
- `de` and `i`: preserve their letter-name senses separately from the everyday
  preposition/conjunction senses. Letter-name explanations receive no Chinese
  reverse-search aliases.

Every sense references evidence retained verbatim in the batch's input file.
Source IDs and licenses remain attached to the derived Chinese text. The
deterministic generator `scripts/dictionary/create_translation_batch.py` binds
a source-compared correction plan to the exported evidence and validates the
complete pair before writing it. It does not perform translation or semantic
review. The one-off plan is retained under ignored `work/translation-queue/`;
the committed input and reviewed files are the durable source and output.

Validation:

```bash
python3 scripts/dictionary/validate_translation.py \
  data/translations/batches/zh-reviewed-0005.input.json \
  data/translations/batches/zh-reviewed-0005.reviewed.json
```

Structural validation verifies identities, hashes, references and field shapes.
It does not certify linguistic accuracy.
