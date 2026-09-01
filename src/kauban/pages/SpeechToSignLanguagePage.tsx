import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { fetchSignWords, getVideoPublicUrl, type SignWord } from "../kaubanPublicApi";
import { matchSignWords, type MatchedClip } from "../signWordMatching";
import { createSpeechRecognition, isSpeechRecognitionSupported, type KaubanSpeechRecognition } from "../speechRecognition";
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
 */
export function SpeechToSignLanguagePage({ onBack }: { onBack: () => void }) {
  const [pool, setPool] = useState<SignWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [queue, setQueue] = useState<MatchedClip[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState("");

  const recognitionRef = useRef<KaubanSpeechRecognition | null>(null);
  const listeningRef = useRef(false); // mirrors `listening` for the onend handler, which closes over stale state otherwise

  const supported = isSpeechRecognitionSupported();
  const current = queue[currentIndex] ?? null;

  useEffect(() => {
    (async () => {
      setPool(await fetchSignWords());
      setLoading(false);
    })();
  }, []);

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

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

    const recognition = createSpeechRecognition();
    if (!recognition) { setError("Speech recognition isn't available in this browser."); return; }

    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const matches = matchSignWords(transcript, pool);
          if (matches.length > 0) setQueue(q => [...q, ...matches]);
        } else {
          interim += transcript;
        }
      }
      setInterimText(interim);
    };

    recognition.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was denied — allow it in your browser to use this tool.");
        // Fatal — the mic will never become available mid-session without
        // a page reload, so stop instead of letting onend below retry
        // forever against a permission that's already denied.
        listeningRef.current = false;
        setListening(false);
      } else if (event.error !== "no-speech") {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // `continuous` isn't honored forever by every browser — restart
      // automatically while the person hasn't pressed Stop themselves
      // (and the browser hasn't just told us to give up — see onerror).
      if (listeningRef.current) recognition.start();
    };

    recognitionRef.current = recognition;
    listeningRef.current = true;
    setListening(true);
    recognition.start();
  }

  function handleStop() {
    listeningRef.current = false;
    setListening(false);
    setInterimText("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
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
    <div className="min-h-screen bg-[#FAF9FC] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <KaubanPageHeader title="Speech to Sign Language" subtitle="Say something and watch it signed." onBack={onBack} />

        {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}

        {!loading && !supported && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>Speech recognition isn't supported in this browser. Try Chrome or Edge instead.</p>
          </div>
        )}

        {!loading && supported && (
          <>
            <div className="mb-5 overflow-hidden rounded-2xl bg-black shadow-lg">
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
                <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
                  {listening ? "Listening — say a word to see it signed." : "Press the microphone to start."}
                </div>
              )}
              {current && (
                <p className="bg-white/95 py-2 text-center text-base font-bold text-[#1E1B3A]">{current.label}</p>
              )}
            </div>

            {interimText && <p className="mb-3 text-center text-sm italic text-slate-400">"{interimText}"</p>}
            {error && <p className="mb-3 text-center text-sm text-red-600">{error}</p>}

            <div className="flex justify-center">
              <button
                onClick={listening ? handleStop : handleStart}
                className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition ${listening ? "bg-red-500 text-white" : "bg-[#4F46E5] text-white"}`}
                aria-label={listening ? "Stop listening" : "Start listening"}
              >
                {listening ? <MicOff size={26} /> : <Mic size={26} />}
              </button>
            </div>

            {queue.length > currentIndex + 1 && (
              <p className="mt-3 text-center text-xs text-slate-400">
                Up next: {queue.slice(currentIndex + 1).map(c => c.label).join(", ")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
