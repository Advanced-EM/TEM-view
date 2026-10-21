// Speech recognition in the phone apps: the Capacitor plugin (@capacitor-community/speech-recognition) wrapped
// in the part of the Web Speech API that js/voice.js uses, so push-to-talk works the same on the web and in the
// apps. Returns null outside the apps.
const event = (text, isFinal) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });

export function nativeRecognition() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const P = cap?.isNativePlatform?.() ? cap.Plugins?.SpeechRecognition : null;
  if (!P) return null;
  return class NativeRecognition {
    constructor() { this.lang = 'en-US'; this.text = ''; this.done = false; this.onresult = this.onerror = this.onend = null; }
    async start() {
      try {
        const have = await P.checkPermissions?.();
        if (have && have.speechRecognition !== 'granted') {
          const got = await P.requestPermissions();
          if (got.speechRecognition !== 'granted') throw Object.assign(new Error('not-allowed'), { code: 'not-allowed' });
        }
        this.sub = await P.addListener('partialResults', (d) => {
          const t = d?.matches?.[0] ?? '';
          if (t) { this.text = t; this.onresult?.(event(t, false)); }
        });
        await P.start({ language: this.lang, maxResults: 1, partialResults: true, popup: false });
      } catch (e) {
        this.onerror?.({ error: e.code === 'not-allowed' || /permission|denied/i.test(e.message ?? '') ? 'not-allowed' : (e.message || 'error') });
        this.finish();
      }
    }
    async stop() { try { await P.stop(); } catch { /* not running */ } this.finish(); }
    abort() { this.stop(); }
    finish() {
      if (this.done) return;
      this.done = true;
      this.sub?.remove?.(); this.sub = null;
      if (this.text) this.onresult?.(event(this.text, true));
      this.onend?.();
    }
  };
}

export const isApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
