import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { lookupWord } from "../lib/lookup.ts";
import { dictionaryRepository } from "../lib/dictionary-repository.ts";
import { searchRepository } from "../lib/search-repository.ts";

const publicRoot = resolve(import.meta.dirname, "../public");

test("installed core meanings remain usable when the browser reports online but requests fail", async () => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let failure: "network" | "server" | undefined;
  globalThis.fetch = async (input) => {
    if (failure === "network") throw new TypeError("Failed to fetch");
    if (failure === "server") return new Response(null, { status: 503 });
    const path = resolve(publicRoot, new URL(String(input), "https://offline.test.invalid").pathname.replace(/^\/+/, ""));
    assert.ok(path.startsWith(publicRoot + sep));
    return new Response(await readFile(path));
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  try {
    await dictionaryRepository.ensureCoreOffline();
    await dictionaryRepository.getEntry("alegria"); // One range can be cached while other layers are unavailable.
    for (const mode of ["network", "server"] as const) {
      failure = mode;
      for (const [query, language, expected] of [
        ["学校", "zh", "escola"], ["學校", "zh", "escola"], ["escuela", "es", "escola"],
        ["体积小", "zh", "petit"], ["表示体积小的词", "auto", "petit"],
        ["形容不用付钱的词", "zh", "gratuït"],
        ["表示强壮的名词", "auto", "força"],
      ] as const) {
        const found = await lookupWord(query, language);
        assert.equal(found.status, "found", `${mode}: ${query}`);
        if (found.status === "found") {
          assert.equal(found.entry.normalizedLemma, expected, query);
          if (expected === "petit" || expected === "escola" || expected === "força")
            assert.ok(found.entry.definitions?.ca?.length || found.entry.definitions?.en?.length,
              "Installed complete core definitions must survive a failed range download");
          if (expected === "força") {
            assert.ok(found.entry.chinese?.length, "A cached Spanish-only layer cannot hide installed Chinese");
            assert.equal(found.semanticMatch?.partOfSpeech, "noun");
          }
        }
      }
      await assert.rejects(lookupWord("完全不知道的东西", "zh"), /fetch|503/,
        "An unavailable full index must not turn a core miss into a claimed dictionary-wide absence");
    }
    failure = undefined;
    const base = await dictionaryRepository.manifest();
    await searchRepository.semantic("体积小", base.dataVersion); // Cache the concept map, not the entry's base packs.
    failure = "network";
    await assert.rejects(lookupWord("非常害羞的", "zh"), /fetch|unavailable/,
      "A known non-core concept without its entry must report missing data, not a false word miss");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
