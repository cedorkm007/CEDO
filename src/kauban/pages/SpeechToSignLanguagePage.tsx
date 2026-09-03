import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, AlertCircle, Cloud, CloudOff } from "lucide-react";
import { fetchSignWords, type SignWord } from "../kaubanPublicApi";
import { getVideoPlaybackUrl } from "../videoPlayback";
import { matchSignWords, type MatchedClip } from "../signWordMatching";
import { createAdaptiveSpeechRecognizer, isSpeechRecognitionAvailable, type AdaptiveSpeechRecognizer, type SpeechEngine } from "../adaptiveSpeechRecognizer";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

const PLAYBACK_RATE = 1.25;

/**
 * Say a word or phrase, watch it play back as a sign-language clip.
 * Matching is matchSignWords() — a direct port of the original app's own
 * algorithm.
 *
 * Playback: every clip in the queue is preloaded (resolved to a playable
 * URL) as soon as it's matched, well ahead of when it's actually needed —
 * see the preload effect below. Advancing to the next clip on `onEnded`
 * is then just a `.src` swap on one persistent <video> element (no
 * remount, no fetch at transition time), which is what makes a multi-word
 * sentence play back like one continuous clip instead of a slideshow with
 * a loading gap between each word. Clips play muted, same as the original
 * app's own rule (avoids autoplay-with-sound being blocked, and the
 * source clips are meant to be muted anyway) and slightly sped up.
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

  const videoRef = useRef<HTMLVideoElement>(null);
  // Resolved playback URLs for every clip currently in the queue, keyed
  // by clipVideoPath (not word id — the same clip can legitimately appear
  // more than once in a longer sentence, and should reuse one URL rather
  // than fetching it again each time). A ref, not state: populating it
  // shouldn't itself trigger a re-render, only actually playing a clip
  // should.
  const urlCacheRef = useRef<Map<string, string>>(new Map());
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

  useEffect(() => {
    return () => {
      recognizerRef.current?.destroy();
      urlCacheRef.current.forEach(url => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
    };
  }, []);

  // A matched word with no clip uploaded yet (milestone 5 pending) has
  // nothing to play — skip it immediately instead of stalling the
  // sequence on it.
  useEffect(() => {
    if (current && !current.word.clipVideoPath) setCurrentIndex(i => i + 1);
  }, [current]);

  function playClip(word: SignWord) {
    const video = videoRef.current;
    const url = word.clipVideoPath ? urlCacheRef.current.get(word.clipVideoPath) : undefined;
    if (!video || !url) return;
    video.src = url;
    video.playbackRate = PLAYBACK_RATE;
    video.play().catch(() => { /* onError below covers a real playback failure */ });
  }

  // Resolves through the offline video cache first (see videoPlayback.ts)
  // — what makes an offline-downloaded clip play back offline — for every
  // clip in the queue at once, in parallel, rather than one at a time
  // right as each clip's turn comes up. queue only ever grows within a
  // session, so already-cached paths are skipped on re-runs.
  useEffect(() => {
    let cancelled = false;
    queue.forEach(clip => {
      const path = clip.word.clipVideoPath;
      if (!path || urlCacheRef.current.has(path)) return;
      getVideoPlaybackUrl(path).then(({ url }) => {
        if (cancelled) return;
        urlCacheRef.current.set(path, url);
        // Covers the rare case where this clip's turn to play arrived
        // before its own preload finished — the advance effect below
        // would have found no URL yet and done nothing, so retry now.
        if (current?.word.clipVideoPath === path) playClip(current.word);
      });
    });
    return () => { cancelled = true; };
    // current/playClip intentionally excluded: this effect's job is
    // fetching for the queue's contents, not reacting to whose turn it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Advances playback to whichever clip is now current. A plain `.src`
  // swap + play() on the one persistent <video> element — no remount, no
  // fetch — since the preload effect above already resolved the URL well
  // before this point for anything but a very-early clip.
  useEffect(() => {
    if (current?.word.clipVideoPath) playClip(current.word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function handleStart() {
    if (!supported || listening) return;
    setError("");
    setInterimText("");
    setCapturedText("");
    capturedTextRef.current = "";
    // Previous sequence's blob URLs aren't needed anymore — release them
    // before starting a fresh one.
    urlCacheRef.current.forEach(url => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
    urlCacheRef.current.clear();
    if (videoRef.current) videoRef.current.removeAttribute("src");
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
              {/* Always mounted (never conditionally rendered) so playClip()
                  is swapping `src` on the same element across the whole
                  session, not remounting a fresh <video> per clip — hidden
                  via CSS rather than removed when there's nothing to show. */}
              <video
                ref={videoRef}
                className={`mx-auto max-h-[360px] w-full ${current ? "" : "hidden"}`}
                muted
                playsInline
                onEnded={handleVideoEnded}
                onError={handleVideoError}
              />
              {!current && (
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
