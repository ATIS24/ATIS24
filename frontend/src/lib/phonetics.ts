/**
 * Aviation terminology normalization — FOR SPEECH ONLY.
 *
 * This module never touches the displayed ATIS text (that always renders
 * exactly as returned by /atis, verbatim). It produces a separate string
 * fed to SpeechSynthesis so the broadcast sounds like an aviation radio
 * reading real phraseology instead of a browser reading raw abbreviations
 * letter-by-letter.
 */

const NATO: Record<string, string> = {
  A: "Alpha",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  I: "India",
  J: "Juliett",
  K: "Kilo",
  L: "Lima",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

const DIGIT_WORDS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "niner",
};

function spellIcao(code: string): string {
  return code
    .split("")
    .map((ch) => NATO[ch.toUpperCase()] ?? ch)
    .join(" ");
}

function digitsToWords(digits: string): string {
  return digits
    .split("")
    .map((d) => DIGIT_WORDS[d] ?? d)
    .join(" ");
}

/** Speaks a single letter as its NATO phonetic word — used for the ATIS
 * information letter (e.g. "T" -> "Tango"). */
export function phoneticLetter(letter: string): string {
  const upper = letter.trim().toUpperCase();
  return NATO[upper] ?? upper;
}

/** Speaks a 4-letter ICAO-style airport code phonetically, e.g.
 * "IRFD" -> "India Romeo Foxtrot Delta". */
export function phoneticAirportCode(code: string): string {
  return spellIcao(code.trim().toUpperCase());
}

/**
 * Converts raw ATIS text into a string better suited for SpeechSynthesis,
 * expanding common aviation abbreviations and reading numeric groups the
 * way a controller/ATIS voice would. This is intentionally a set of
 * pragmatic regex passes rather than a full parser — ATIS phraseology is
 * fairly formulaic, so targeted substitutions cover the vast majority of
 * real content without needing to fully understand every line.
 */
export function normalizeAtisForSpeech(rawText: string): string {
  let text = rawText;

  // Runway designators: "RWY 26" / "RWY26" -> "runway two six"
  text = text.replace(/\bRWY\s*(\d{1,2})([LRC]?)\b/gi, (_m, num: string, side: string) => {
    const spoken = digitsToWords(num);
    const sideWord = side ? { L: "left", R: "right", C: "center" }[side.toUpperCase()] : "";
    return `runway ${spoken}${sideWord ? " " + sideWord : ""}`;
  });

  // "INFORMATION T" / "INFO T" -> "information Tango"
  text = text.replace(/\b(INFORMATION|INFO)\s+([A-Z])\b/gi, (_m, word: string, letter: string) => {
    return `${word.toLowerCase() === "info" ? "information" : "information"} ${phoneticLetter(letter)}`;
  });

  // QNH / altimeter setting: "QNH 1013" -> "Q N H one zero one three"
  text = text.replace(/\bQNH\s*(\d{3,4})\b/gi, (_m, num: string) => {
    return `Q N H ${digitsToWords(num)}`;
  });
  text = text.replace(/\bQ(\d{4})\b/g, (_m, num: string) => {
    return `Q N H ${digitsToWords(num)}`;
  });

  // Wind/visibility group: "094/12" -> "wind zero niner four at one two knots"
  text = text.replace(/\b(\d{3})\/(\d{1,3})\b/g, (_m, dir: string, speed: string) => {
    return `wind ${digitsToWords(dir)} at ${digitsToWords(speed)} knots`;
  });

  // Visibility in meters, common ATIS group like "9999"
  text = text.replace(/\b9999\b/g, "visibility one zero kilometers or more");

  // Cloud layers: OVC025, BKN010, SCT005, FEW003
  text = text.replace(
    /\b(OVC|BKN|SCT|FEW)(\d{3})\b/gi,
    (_m, kind: string, heightHundreds: string) => {
      const words: Record<string, string> = {
        OVC: "overcast",
        BKN: "broken",
        SCT: "scattered",
        FEW: "few clouds",
      };
      const feet = parseInt(heightHundreds, 10) * 100;
      return `${words[kind.toUpperCase()] ?? kind} ${feet.toLocaleString("en-US").replace(/,/g, " ")} feet`;
    },
  );

  // Temperature/dewpoint pair: "13/11" -> "temperature one three, dewpoint one one"
  text = text.replace(/\b(-?\d{1,2})\/(-?\d{1,2})\b/g, (_m, temp: string, dew: string) => {
    const spokenTemp = temp.startsWith("-") ? `minus ${digitsToWords(temp.slice(1))}` : digitsToWords(temp);
    const spokenDew = dew.startsWith("-") ? `minus ${digitsToWords(dew.slice(1))}` : digitsToWords(dew);
    return `temperature ${spokenTemp}, dewpoint ${spokenDew}`;
  });

  // Time group like "TIME 1922Z" -> "time one niner two two Zulu"
  text = text.replace(/\bTIME\s+(\d{4})Z\b/gi, (_m, hhmm: string) => {
    return `time ${digitsToWords(hhmm)} Zulu`;
  });

  // Standalone trailing "Z" after 4 digits not already handled
  text = text.replace(/\b(\d{4})Z\b/g, (_m, hhmm: string) => `${digitsToWords(hhmm)} Zulu`);

  // A lone ICAO-looking 4-letter code at the start of a line (airport
  // identifier) -> phonetic spelling. Conservative: only at line start.
  text = text.replace(/^([A-Z]{4})\b/gm, (_m, code: string) => phoneticAirportCode(code));

  return text;
}
