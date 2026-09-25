/**
 * A Web Audio "radio channel" effect chain, plus a speech source driven
 * by the browser's built-in SpeechSynthesis so we can voice arbitrary
 * ATIS text without shipping any pre-recorded audio or hitting a paid
 * TTS API.
 *
 * Chain (per spec): highpass (~350Hz) -> lowpass (~3300Hz) -> compressor
 * -> mild waveshaper saturation -> gated static bed -> master gain ->
 * destination. Speech synthesis audio isn't directly routable into Web
 * Audio in most browsers, so we build a *sidechain*: the static/squelch
 * bed runs through the same filter chain continuously (gated by
 * squelch-open/close), while SpeechSynthesisUtterance handles the actual
 * words. This keeps the "sounds like a VHF radio" texture authentic
 * without fighting browser TTS routing limitations.
 */

export type RadioAudioEvent = "start" | "end" | "squelch-open" | "squelch-close";

export class RadioAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private saturator: WaveShaperNode | null = null;
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
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  /** Mild odd-harmonic saturation curve — keeps things "radio warm"
   * rather than harsh/clipped. Subtle by design per spec ("mild"). */
  private buildSaturationCurve(amount = 6): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  private buildChain() {
    const ctx = this.ensureContext();
    if (this.masterGain) return;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(ctx.destination);

    // Radio-band filtering: cut sub-350Hz rumble and everything above
    // ~3.3kHz, matching a narrowband VHF voice channel.
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 350;
    this.highpass.Q.value = 0.7;

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = 3300;
    this.lowpass.Q.value = 0.7;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -22;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.15;

    this.saturator = ctx.createWaveShaper();
    this.saturator.curve = this.buildSaturationCurve(5);
    this.saturator.oversample = "2x";

    // static bed -> highpass -> lowpass -> compressor -> saturator -> master
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.compressor);
    this.compressor.connect(this.saturator);
    this.saturator.connect(this.masterGain);

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseGain.connect(this.highpass);

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
    this.noiseGain.gain.linearRampToValueAtTime(0.1, now + 0.03);
    this.noiseGain.gain.linearRampToValueAtTime(0.03, now + 0.15);
    this.emit("squelch-open");
  }

  private squelchClose() {
    if (!this.ctx || !this.noiseGain) return;
    const now = this.ctx.currentTime;
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setValueAtTime(this.noiseGain.gain.value, now);
    this.noiseGain.gain.linearRampToValueAtTime(0.09, now + 0.02);
    this.noiseGain.gain.linearRampToValueAtTime(0, now + 0.18);
    this.emit("squelch-close");
  }

  /** Sets the idle/gap static level directly (used while a station is in
   * its 5-second inter-message gap — "light static", not silence). */
  setIdleStaticLevel(level: number): void {
    this.buildChain();
    if (!this.ctx || !this.noiseGain) return;
    const now = this.ctx.currentTime;
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setTargetAtTime(level, now, 0.08);
  }

  /** Speak `text` through the simulated radio. Resolves when speech ends
   * or is cancelled. `onCancelled` distinguishes a natural finish from an
   * interruption (tune-away / new ATIS arriving) for callers that care. */
  speak(text: string, options?: { rate?: number; pitch?: number }): Promise<{ cancelled: boolean }> {
    this.buildChain();
    this.squelchOpen();
    this._speaking = true;
    this.emit("start");

    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        const durationMs = Math.min(8000, Math.max(1800, text.length * 45));
        const timer = globalThis.setTimeout(() => {
          this.squelchClose();
          this._speaking = false;
          this.emit("end");
          resolve({ cancelled: false });
        }, durationMs);
        this.pendingFallbackTimer = timer;
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
        resolve({ cancelled: false });
      };
      utterance.onerror = (event) => {
        this.squelchClose();
        this._speaking = false;
        this.emit("end");
        // "interrupted"/"canceled" fire when we call speechSynthesis.cancel()
        // ourselves (tune-away, ATIS update) — not a real failure.
        resolve({ cancelled: event.error === "interrupted" || event.error === "canceled" });
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  private pendingFallbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  /** Immediately stops any current speech/static without waiting for it
   * to finish — used for tune-away and ATIS-content-changed interrupts. */
  stop(): void {
    if (this.pendingFallbackTimer !== null) {
      clearTimeout(this.pendingFallbackTimer);
      this.pendingFallbackTimer = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (this._speaking) {
      this.squelchClose();
      this._speaking = false;
      this.emit("end");
    }
  }

  /** Short "carrier key" click used for UI feedback (tuning, selecting)
   * — cheap, no speech involved. */
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

  /** Brief tuning static burst — played when switching ACTIVE frequency,
   * independent of squelch/speech state. */
  playTuneStatic(): void {
    this.buildChain();
    if (!this.ctx || !this.noiseGain) return;
    const now = this.ctx.currentTime;
    const prior = this.noiseGain.gain.value;
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setValueAtTime(prior, now);
    this.noiseGain.gain.linearRampToValueAtTime(0.16, now + 0.02);
    this.noiseGain.gain.linearRampToValueAtTime(0.02, now + 0.12);
    this.noiseGain.gain.linearRampToValueAtTime(prior, now + 0.2);
  }

  destroy(): void {
    this.stop();
    this.noiseNode?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.noiseGain = null;
    this.highpass = null;
    this.lowpass = null;
    this.compressor = null;
    this.saturator = null;
    this.noiseNode = null;
  }
}
