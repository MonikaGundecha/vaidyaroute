'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings (not in the DOM lib). We only declare what we
// use so `tsc --noEmit` stays clean without pulling extra @types.
// ---------------------------------------------------------------------------
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface VoiceNoteButtonProps {
  /** Current textarea value. */
  value: string;
  /** Called with the new value as the user dictates (interim + final). */
  onChange: (next: string) => void;
  /** Optional: notified when recording starts/stops (e.g. to italicize the textarea). */
  onListeningChange?: (listening: boolean) => void;
}

/**
 * A mic button that dictates into a notes field via the Web Speech API.
 * Renders nothing when the browser has no speech recognition support.
 */
export default function VoiceNoteButton({
  value,
  onChange,
  onListeningChange,
}: VoiceNoteButtonProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The committed text that existed before recording started; final results are
  // appended to this, and interim text is shown after it without committing yet.
  const baseRef = useRef('');
  // Live mirror of the latest value so result handlers append correctly.
  const valueRef = useRef(value);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      recognitionRef.current?.abort();
    };
  }, []);

  function notifyListening(next: boolean) {
    setListening(next);
    onListeningChange?.(next);
  }

  function clearSilenceTimer() {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  }

  function armSilenceTimer() {
    clearSilenceTimer();
    // Stop after 5 seconds of no new speech results.
    silenceTimer.current = setTimeout(() => {
      recognitionRef.current?.stop();
    }, 5000);
  }

  function join(base: string, addition: string): string {
    if (!addition) return base;
    if (!base) return addition;
    return /\s$/.test(base) ? base + addition : base + ' ' + addition;
  }

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    baseRef.current = valueRef.current;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      armSilenceTimer();
      let finalChunk = '';
      let interimChunk = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += transcript;
        else interimChunk += transcript;
      }
      // Commit final text to the base; show interim transiently after it.
      baseRef.current = join(baseRef.current, finalChunk.trim());
      const display = join(baseRef.current, interimChunk.trim());
      onChange(display);
    };

    recognition.onend = () => {
      clearSilenceTimer();
      // Drop any leftover interim text — keep only committed final text.
      onChange(baseRef.current);
      recognitionRef.current = null;
      notifyListening(false);
    };

    recognition.onerror = () => {
      clearSilenceTimer();
      recognitionRef.current = null;
      notifyListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      notifyListening(true);
      armSilenceTimer();
    } catch {
      // start() throws if called while already running; ignore.
      recognitionRef.current = null;
      notifyListening(false);
    }
  }

  function toggle() {
    if (listening) {
      recognitionRef.current?.stop();
    } else {
      start();
    }
  }

  if (!supported) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-label={listening ? 'Stop dictation' : 'Dictate notes'}
        aria-pressed={listening}
        style={{
          height: 40,
          width: 40,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          cursor: 'pointer',
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          ...(listening
            ? {
                backgroundColor: '#EF4444',
                border: '2px solid #EF4444',
                color: '#fff',
                animation: 'voicepulse 1s infinite',
              }
            : {
                backgroundColor: '#fff',
                border: '2px solid #16a34a',
                color: '#16a34a',
              }),
        }}
      >
        🎤
      </button>
      <span style={{ color: '#9CA3AF', fontSize: 11, textAlign: 'center' }}>
        {listening ? 'Listening... tap to stop' : 'Tap to dictate notes'}
      </span>

      <style jsx>{`
        @keyframes voicepulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
          100% {
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
