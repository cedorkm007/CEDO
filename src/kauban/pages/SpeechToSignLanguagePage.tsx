import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, AlertCircle, Cloud, CloudOff } from "lucide-react";
import { fetchSignWords, type SignWord } from "../kaubanPublicApi";
import { getVideoPlaybackUrl } from "../videoPlayback";
import { matchSignWords, type MatchedClip } from "../signWordMatching";
import { createAdaptiveSpeechRecognizer, isSpeechRecognitionAvailable, type AdaptiveSpeechRecognizer, type SpeechEngine } from "../adaptiveSpeechRecognizer";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/**
 * Say a word or phrase, watch it play back as a sign-language clip.
 * Matching is matchSignWords() — a direct port of the original app's own
 * algorithm. Playback is simplified from the original: that version used
 * a dual-video-element crossfade between clips for a seamless transition;
 * this uses one <video> that swaps `src` on `onEnded`, a visible (if
 * less polished) cut between clips instead of a crossfade. Clips play
 * muted, same as the original app's own rule (avoids autoplay-with-sound
 * being blocked, and the source clips are meant to be muted anyway).
 *
 * Speech recognition prefers the browser's own (cloud-backed) engine when
 * online — more accurate than the on-device fallback — and drops to Vosk
 * (voskRecognition.ts) when offline; see adaptiveSpeechRecognizer.ts.
 *
 * Matching happens once, against everything captured across the whole
 * listening session, when the person presses Stop — not per Vosk-internal
 * "final" segment as it happens. Vosk finalizes fairly eagerly at short
 * pauses, sometimes splitting one sentence into several final chunks —
 * matching each separately could miss a multi-word phrase that only
 * matchSignWords() would catch as a single complete string. Everything
 * recognized while listening (each final chunk plus the live partial) is
 * still shown as it comes in, just not acted on until Stop.
 */
export function SpeechToSignLanguagePage() {
  const [pool, setPool] = useState<SignWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [engine, setEngine] = useState<SpeechEngine | null>(null);
  const [capturedText, setCapturedText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [queue, setQueue] = useState<MatchedClip[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState("");

  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  const recognizerRef = useRef<AdaptiveSpeechRecognizer | null>(null);
  // Mirrors capturedText for handleStop to read synchronously — by the
  // time stop()'s flush promise resolves, a plain state closure captured
  // at handleStop's own definition could be stale.
  const capturedTextRef = useRef("");
  const supported = isSpeechRecognitionAvailable();
  const current = queue[currentIndex] ?? null;

  useEffect(() => {
    (async () => {
      setPool(await fetchSignWords());
      setLoading(false);
    })();
  }, []);

  useEffect(() => () => { recognizerRef.current?.destroy(); }, []);

  // A matched word with no clip uploaded yet (milestone 5 pending) has
  // nothing to play — skip it immediately instead of rendering a <video>
  // with an empty src.
  useEffect(() => {
    if (current && !current.word.clipVideoPath) setCurrentIndex(i => i + 1);
  }, [current]);

  // Resolves through the offline video cache first (see videoPlayback.ts)
  // rather than pointing <video src> straight at the network URL — that's
  // what actually makes an offline-downloaded clip play back offline.
  useEffect(() => {
    setVideoSrc(null);
    const path = current?.word.clipVideoPath;
    if (!path) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const { url } = await getVideoPlaybackUrl(path);
      if (cancelled) return;
      if (url.startsWith("blob:")) objectUrl = url;
      setVideoSrc(url);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current]);

  function handleStart() {
    if (!supported || listening) return;
    setError("");
    setInterimText("");
    setCapturedText("");
    capturedTextRef.current = "";
    setQueue([]);
    setCurrentIndex(0);
    setEngine(null);

    if (!recognizerRef.current) recognizerRef.current = createAdaptiveSpeechRecognizer();

    recognizerRef.current.start({
      onPartialText: setInterimText,
      onFinalText: text => {
        setInterimText("");
        capturedTextRef.current = capturedTextRef.current ? `${capturedTextRef.current} ${text}` : text;
        setCapturedText(capturedTextRef.current);
      },
      onModelLoading: setModelLoading,
      onListening: setListening,
      onEngine: setEngine,
      onError: message => {
        setError(message);
        setListening(false);
        setModelLoading(false);
      },
    });
  }

  async function handleStop() {
    setListening(false);
    setInterimText("");
    // Waits for any speech still buffered at the moment Stop was pressed
    // to flush through onFinalText first (see voskRecognition.ts) — so
    // the last word or two doesn't just vanish.
    await recognizerRef.current?.stop();

    const fullText = capturedTextRef.current.trim();
    capturedTextRef.current = "";
    setCapturedText("");
    if (fullText) {
      const matches = matchSignWords(fullText, pool);
      if (matches.length > 0) setQueue(q => [...q, ...matches]);
    }
  }

  function handleVideoEnded() {
    setCurrentIndex(i => i + 1);
  }

  function handleVideoError() {
    // This clip's file isn't uploaded yet (milestone 5 pending) — skip
    // it instead of getting stuck on a broken player.
    setCurrentIndex(i => i + 1);
  }

  return (
    <div className="rounded-[20px] bg-[#F7FAFC] p-4 shadow-xl sm:p-10">
      <KaubanPageHeader title="Speech to Sign Language" subtitle="Say something and watch it signed." />

        {loading && <p className="py-8 text-center text-sm text-[#718096]">Loading…</p>}

        {!loading && !supported && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>Speech recognition isn't supported in this browser.</p>
          </div>
        )}

        {!loading && supported && modelLoading && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>Downloading offline speech model (one-time, ~130MB — Wi-Fi recommended)…</p>
          </div>
        )}

        {!loading && supported && (
          <>
            {/* Sticky rather than static: this page's queue list below can
                grow long, and scrolling to see it was pushing the actively-
                playing video off-screen. */}
            <div className="sticky top-20 z-20 mb-5 overflow-hidden rounded-2xl bg-black shadow-lg">
              {current && current.word.clipVideoPath && videoSrc ? (
                <video
                  key={current.word.id}
                  src={videoSrc}
                  className="mx-auto max-h-[360px] w-full"
                  autoPlay
                  muted
                  playsInline
                  onEnded={handleVideoEnded}
                  onError={handleVideoError}
                />
              ) : (
                <div className="flex h-[220px] items-center justify-center text-sm text-[#A0AEC0]">
                  {listening ? "Listening — press stop when you're done to see it signed." : "Press the microphone to start."}
                </div>
              )}
              {current && (
                <p className="bg-white/95 py-2 text-center text-base font-semibold text-[#2D3748]" style={{ fontFamily: "'Fredoka', sans-serif" }}>{current.label}</p>
              )}
            </div>

            {listening && engine && (
              <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#A0AEC0]">
                {engine === "cloud"
                  ? <><Cloud size={13} /> Using accurate online recognition</>
                  : <><CloudOff size={13} /> Using offline speech recognition</>}
              </p>
            )}

            {(capturedText || interimText) && (
              <p className="mb-3 text-center text-sm italic text-[#718096]">
                "{capturedText}{capturedText && interimText ? " " : ""}<span className="text-[#A0AEC0]">{interimText}</span>"
              </p>
            )}
            {error && <p className="mb-3 text-center text-sm text-red-600">{error}</p>}

            <div className="flex justify-center">
              <button
                onClick={listening ? handleStop : handleStart}
                disabled={!supported}
                className={`flex h-[72px] w-[72px] items-center justify-center rounded-full shadow-lg transition-transform duration-150 active:scale-90 disabled:opacity-40 ${listening ? "bg-red-500 text-white" : "bg-[#3182CE] text-white"}`}
                aria-label={listening ? "Stop listening" : "Start listening"}
              >
                {listening ? <MicOff size={28} /> : <Mic size={28} />}
              </button>
            </div>

            {queue.length > currentIndex + 1 && (
              <p className="mt-3 text-center text-xs text-[#A0AEC0]">
                Up next: {queue.slice(currentIndex + 1).map(c => c.label).join(", ")}
              </p>
            )}
          </>
        )}
    </div>
  );
}
