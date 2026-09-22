import { useCallback, useEffect, useRef, useState } from "react";
import { RadioAudioEngine } from "../lib/radioAudio";

export type RadioPowerState = "off" | "starting" | "on";

interface UseRadioAudioResult {
  power: RadioPowerState;
  speaking: boolean;
  enable: () => Promise<void>;
  disable: () => void;
  speak: (text: string) => Promise<void>;
  keyClick: () => void;
}

/**
 * Bridges RadioAudioEngine (imperative Web Audio + SpeechSynthesis class)
 * into React state. "power" models the physical radio's on/off switch —
 * separate from "speaking", since the radio can be ON with no ATIS
 * currently being read (squelch closed, silence).
 */
export function useRadioAudio(): UseRadioAudioResult {
  const engineRef = useRef<RadioAudioEngine | null>(null);
  const [power, setPower] = useState<RadioPowerState>("off");
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    engineRef.current = new RadioAudioEngine();
    const unsubscribe = engineRef.current.on((event) => {
      if (event === "start") setSpeaking(true);
      if (event === "end") setSpeaking(false);
    });
    return () => {
      unsubscribe();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const enable = useCallback(async () => {
    setPower("starting");
    try {
      await engineRef.current?.unlock();
      setPower("on");
    } catch {
      setPower("off");
    }
  }, []);

  const disable = useCallback(() => {
    engineRef.current?.stop();
    setPower("off");
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!engineRef.current) return;
    await engineRef.current.speak(text);
  }, []);

  const keyClick = useCallback(() => {
    engineRef.current?.playKeyClick();
  }, []);

  return { power, speaking, enable, disable, speak, keyClick };
}
