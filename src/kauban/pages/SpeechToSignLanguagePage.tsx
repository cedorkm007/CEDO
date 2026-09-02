import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { fetchSignWords, getVideoPublicUrl, type SignWord } from "../kaubanPublicApi";
import { matchSignWords, type MatchedClip } from "../signWordMatching";
import { createWhisperRecognizer, isWhisperRecognitionSupported, type WhisperRecognizer } from "../whisperRecognition";
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
 * Speech recognition is Whisper, running on-device (whisperRecognition.ts)
 * — the browser's built-in recognizer needs a cloud connection with no
 * offline mode at all, which defeats the point here. There's no live
 * partial captioning as a result: a word or phrase gets matched only once
 * a short pause is detected, not continuously as you speak.
 */
export function SpeechToSignLanguagePage() {
  const [pool, setPool] = useState<SignWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [modelLoading, setModelLoading] = useState<number | null>(null);
  const [queue, setQueue] = useState<MatchedClip[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState("");

  const recognizerRef = useRef<WhisperRecognizer | null>(null);
  const supported = isWhisperRecognitionSupported();
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

  function handleStart() {
    if (!supported || listening) return;
    setError("");
    setQueue([]);
    setCurrentIndex(0);

    if (!recognizerRef.current) recognizerRef.current = createWhisperRecognizer();

    recognizerRef.current.start({
      onFinalText: text => {
        const matches = matchSignWords(text, pool);
        if (matches.length > 0) setQueue(q => [...q, ...matches]);
      },
      onModelLoading: fraction => setModelLoading(fraction),
      onModelReady: () => setModelLoading(null),
      onListening: setListening,
      onError: message => {
        setError(message);
        setListening(false);
        setModelLoading(null);
      },
    });
  }

  function handleStop() {
    recognizerRef.current?.stop();
    setListening(false);
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

        {!loading && supported && modelLoading !== null && (
          <div className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <p className="mb-1.5">Downloading offline speech model (one-time, ~300MB — Wi-Fi recommended)…</p>
            <div className="h-2 overflow-hidden rounded-full bg-amber-100">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.round(modelLoading * 100)}%` }} />
            </div>
          </div>
        )}

        {!loading && supported && (
          <>
            {/* Sticky rather than static: this page's queue list below can
                grow long, and scrolling to see it was pushing the actively-
                playing video off-screen. */}
            <div className="sticky top-20 z-20 mb-5 overflow-hidden rounded-2xl bg-black shadow-lg">
              {current && current.word.clipVideoPath ? (
                <video
                  key={current.word.id}
                  src={getVideoPublicUrl(current.word.clipVideoPath)}
                  className="mx-auto max-h-[360px] w-full"
                  autoPlay
                  muted
                  playsInline
                  onEnded={handleVideoEnded}
                  onError={handleVideoError}
                />
              ) : (
                <div className="flex h-[220px] items-center justify-center text-sm text-[#A0AEC0]">
                  {listening ? "Listening — say a word, then pause, to see it signed." : "Press the microphone to start."}
                </div>
              )}
              {current && (
                <p className="bg-white/95 py-2 text-center text-base font-semibold text-[#2D3748]" style={{ fontFamily: "'Fredoka', sans-serif" }}>{current.label}</p>
              )}
            </div>

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
