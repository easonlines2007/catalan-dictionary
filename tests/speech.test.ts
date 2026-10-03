import assert from "node:assert/strict";
import test from "node:test";
import { findCatalanVoice, speakCatalan } from "../lib/speech.ts";

class MockUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
  configurable: true,
  value: MockUtterance,
});

const catalanVoice = { lang: "ca-ES", name: "Català" } as SpeechSynthesisVoice;
const catalanAndorraVoice = {
  lang: "ca-AD",
  name: "Català (Andorra)",
} as SpeechSynthesisVoice;
const spanishVoice = { lang: "es-ES", name: "Español" } as SpeechSynthesisVoice;

test("selects a Catalan system voice when available", () => {
  assert.equal(
    findCatalanVoice([catalanAndorraVoice, spanishVoice, catalanVoice]),
    catalanVoice,
  );
});

test("cancels current speech and speaks with the ca-ES contract", () => {
  const calls: string[] = [];
  let spoken: MockUtterance | undefined;
  const synth = {
    cancel() {
      calls.push("cancel");
    },
    getVoices() {
      return [spanishVoice, catalanVoice];
    },
    speak(utterance: SpeechSynthesisUtterance) {
      calls.push("speak");
      spoken = utterance as unknown as MockUtterance;
    },
  };

  speakCatalan("pujar", synth as unknown as SpeechSynthesis);
  assert.deepEqual(calls, ["cancel", "speak"]);
  assert.equal(spoken?.text, "pujar");
  assert.equal(spoken?.lang, "ca-ES");
  assert.equal(spoken?.rate, 0.9);
  assert.equal(spoken?.voice, catalanVoice);
});

test("still requests ca-ES when the voice list starts empty", () => {
  let spoken: MockUtterance | undefined;
  const synth = {
    cancel() {},
    getVoices() {
      return [];
    },
    speak(utterance: SpeechSynthesisUtterance) {
      spoken = utterance as unknown as MockUtterance;
    },
  };

  speakCatalan("vaig", synth as unknown as SpeechSynthesis);
  assert.equal(spoken?.lang, "ca-ES");
  assert.equal(spoken?.voice, null);
});

