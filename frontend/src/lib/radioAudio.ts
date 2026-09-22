/**
 * A small Web Audio "radio channel" effect chain, plus a speech source
 * driven by the browser's built-in SpeechSynthesis so we can voice
 * arbitrary ATIS text without shipping any pre-recorded audio or hitting
 * a paid TTS API.
 *
 * Signal chain (speech synthesis audio isn't directly routable into
 * Web Audio in most browsers, so instead we build a *sidechain*: a real
 * oscillator-based noise/squelch bed runs through the radio filter chain
 * continuously, while SpeechSynthesisUtterance handles the actual words.
 * This keeps the "sounds like a VHF radio" texture authentic (filtered
 * static, squelch tail) without fighting browser TTS routing limitations.
 */

export type RadioAudioEvent = "start" | "end" | "squelch-open" | "squelch-close";

export class RadioAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private bandpass: BiquadFilterNode | null = null;
  private listeners = new Set<(e: RadioAudioEvent) => void>();
  private _speaking = false;

  get speaking(): boolean {
    return this._speaking;
  }

  on(cb: (e: RadioAudioEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: RadioAudioEvent) {
    for (const cb of this.listeners) cb(e);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  /** Must be called from a user gesture (button click) — browsers require
   * this before audio (including speechSynthesis in some browsers) will
   * actually produce sound. */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    // Some browsers need a silent speech "kick" to unlock speechSynthesis
    // under the same user-gesture requirement.
    if ("speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
  }

  private buildNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private buildChain() {
    const ctx = this.ensureContext();
    if (this.masterGain) return;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(ctx.destination);

    // Bandpass narrows everything (voice + static) to a VHF-radio-ish
    // telephone-bandwidth window, which is the single biggest contributor
    // to "sounds like a radio" vs "sounds like a browser talking".
    this.bandpass = ctx.createBiquadFilter();
    this.bandpass.type = "bandpass";
    this.bandpass.frequency.value = 1900;
    this.bandpass.Q.value = 0.8;
    this.bandpass.connect(this.masterGain);

    // Continuous low-level static bed, gated by squelch open/close.
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseGain.connect(this.bandpass);

    const noiseBuffer = this.buildNoiseBuffer(ctx, 2);
    this.noiseNode = ctx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;
    this.noiseNode.connect(this.noiseGain);
    this.noiseNode.start();
  }

  private squelchOpen() {
    if (!this.ctx || !this.noiseGain) return;
    const now = this.ctx.currentTime;
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setValueAtTime(this.noiseGain.gain.value, now);
    // Brief burst up then settle low — the classic squelch "chirp".
    this.noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.03);
    this.noiseGain.gain.linearRampToValueAtTime(0.035, now + 0.15);
    this.emit("squelch-open");
  }

  private squelchClose() {
    if (!this.ctx || !this.noiseGain) return;
    const now = this.ctx.currentTime;
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setValueAtTime(this.noiseGain.gain.value, now);
    this.noiseGain.gain.linearRampToValueAtTime(0.1, now + 0.02);
    this.noiseGain.gain.linearRampToValueAtTime(0, now + 0.18);
    this.emit("squelch-close");
  }

  /** Speak `text` through the simulated radio. Resolves when speech ends. */
  speak(text: string, options?: { rate?: number; pitch?: number }): Promise<void> {
    this.buildChain();
    this.squelchOpen();
    this._speaking = true;
    this.emit("start");

    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        // No TTS available in this browser — still simulate the radio
        // static timing so the UI/audio experience is coherent, just
        // without spoken words.
        const durationMs = Math.min(8000, Math.max(1800, text.length * 45));
        globalThis.setTimeout(() => {
          this.squelchClose();
          this._speaking = false;
          this.emit("end");
          resolve();
        }, durationMs);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options?.rate ?? 0.98;
      utterance.pitch = options?.pitch ?? 0.85;
      utterance.volume = 1;

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => /en[-_](US|GB)/i.test(v.lang) && /male|david|mark|daniel/i.test(v.name),
      );
      if (preferred) utterance.voice = preferred;

      utterance.onend = () => {
        this.squelchClose();
        this._speaking = false;
        this.emit("end");
        resolve();
      };
      utterance.onerror = () => {
        this.squelchClose();
        this._speaking = false;
        this.emit("end");
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (this._speaking) {
      this.squelchClose();
      this._speaking = false;
      this.emit("end");
    }
  }

  /** Short double-click "carrier key" sound used for UI feedback (tuning,
   * selecting) — cheap, no speech involved. */
  playKeyClick(): void {
    this.buildChain();
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 900;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.masterGain);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.04);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  destroy(): void {
    this.stop();
    this.noiseNode?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.noiseGain = null;
    this.bandpass = null;
    this.noiseNode = null;
  }
}
