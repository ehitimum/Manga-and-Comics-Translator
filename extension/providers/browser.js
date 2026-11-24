export const languagePair = { sourceLanguage: 'ja', targetLanguage: 'en' };

// Exact matches give first-time readers a small usable vocabulary while Chrome
// has no installed pack. Other text always goes through the translation engine.
const starterPhrases = new Map([
  ['ありがとう', 'Thank you.'], ['ありがとうございます', 'Thank you very much.'],
  ['こんにちは', 'Hello.'], ['おはよう', 'Good morning.'], ['おやすみ', 'Good night.'],
  ['ごめんなさい', "I'm sorry."], ['また明日', 'See you tomorrow.'],
  ['待って', 'Wait!'], ['大丈夫', "It's okay."], ['さようなら', 'Goodbye.'],
]);

// Keep this text-only contract independent of the OCR implementation.
export async function translateJapanese(text, progress, signal) {
  const availability = globalThis.Translator ? await Translator.availability(languagePair) : 'unavailable';
  signal?.throwIfAborted();
  if (availability !== 'available') {
    const match = starterPhrases.get(text.normalize('NFKC').replace(/\s+/g, '').replace(/[。.!！]+$/u, ''));
    if (match) return { text: match, source: 'Built-in phrase list' };
  }
  if (availability === 'unavailable') throw Error('Chrome Translator is unavailable for this language pair.');
  const translator = await Translator.create({
    ...languagePair, signal,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', e => progress('Preparing language pack · ' + Math.round(100 * e.loaded) + '%'));
    },
  });
  try {
    progress('Translating…');
    return { text: await translator.translate(text, { signal }), source: 'Chrome Translator' };
  } finally {
    translator.destroy();
  }
}
