type SpeechSynthesisLike = Pick<
  SpeechSynthesis,
  "cancel" | "getVoices" | "speak"
>;

export function findCatalanVoice(voices: SpeechSynthesisVoice[]) {
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "ca-es") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ca"))
  );
}

export function speakCatalan(
  text: string,
  synth: SpeechSynthesisLike = window.speechSynthesis,
) {
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ca-ES";
  utterance.rate = 0.9;

  const voice = findCatalanVoice(synth.getVoices());
  if (voice) utterance.voice = voice;

  synth.speak(utterance);
  return utterance;
}

