// Runs Whisper entirely off the main thread — model loading and inference
// are both CPU-heavy (WASM), and would otherwise freeze the UI mid-speech.
// See whisperRecognition.ts for the main-thread side (mic capture + voice
// activity detection) that feeds this worker short utterance chunks.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Self-hosted WASM runtime (scripts/copy-onnx-wasm.mjs copies it from
// node_modules on every `npm install`) instead of transformers.js's
// default CDN — same-origin means our own service worker's cache-first
// strategy for static assets (kauban-sw.js) reliably keeps it available
// offline, rather than depending on the browser's ordinary HTTP cache not
// having evicted it.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/kauban-onnx-wasm/";
}

// base.en over tiny.en: meaningfully more accurate — tiny.en's transcripts
// came back garbled/inaccurate in real-world testing (confirmed on-device,
// not just an offline-vs-online difference). Larger one-time download (at
// fp32 — see the dtype comment below — roughly double tiny.en's size), but
// it's cached after the first use either way. Swap this one constant to
// change it app-wide.
const MODEL_ID = "Xenova/whisper-base.en";

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      // Not "q8": this specific model's quantized decoder export is
      // missing a required dequantization scale tensor and fails to
      // create an ONNX Runtime session ("Missing required scale:
      // model.decoder.embed_tokens.weight_merged_0_scale") — confirmed by
      // testing the built worker directly before shipping this. fp32 is a
      // larger one-time download but has no such compatibility landmines.
      dtype: "fp32",
      // Deliberately pinned rather than "auto"/"webgpu": WebGPU support on
      // Android WebView/Chrome is inconsistent across OS versions, and the
      // plain WASM backend is universally reliable. Worth revisiting once
      // WebGPU is dependable enough here to be worth the complexity.
      device: "wasm",
      progress_callback: (progress: { status: string; loaded?: number; total?: number }) => {
        if (progress.status === "progress" && progress.total) {
          self.postMessage({ type: "model-progress", fraction: (progress.loaded ?? 0) / progress.total });
        }
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return transcriberPromise;
}

self.onmessage = async (event: MessageEvent) => {
  const data = event.data as { type: string; id?: number; audio?: Float32Array };

  if (data.type === "load") {
    try {
      await getTranscriber();
      self.postMessage({ type: "model-ready" });
    } catch (err) {
      self.postMessage({ type: "model-error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (data.type === "transcribe" && data.audio) {
    try {
      const transcriber = await getTranscriber();
      const output = await transcriber(data.audio);
      const result = Array.isArray(output) ? output[0] : output;
      const text = (result && "text" in result ? result.text : "") ?? "";
      self.postMessage({ type: "transcription", id: data.id, text: text.trim() });
    } catch (err) {
      self.postMessage({ type: "transcription-error", id: data.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
