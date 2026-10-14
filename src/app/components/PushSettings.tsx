import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, Info, Loader2 } from "lucide-react";
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from "@/lib/pushClient";
import { PUSH_MESSAGES } from "@/lib/pushSupport";

/**
 * "Turn on notifications" for THIS device (web push). Used for scholars (in the bell and on the Renewal tile) and for staff (on the
 * Notifications page). It only ever asks the browser for permission after the person taps the button. Whatever the device can or cannot do,
 * the bell always has every notification, and the text says so.
 *   variant "banner": only shows while push can be turned on and is off (a quiet card), nothing otherwise
 *   variant "panel":  always shows the current state with the buttons (settings)
 */
export function PushSettings({ variant = "panel", audience = "scholar" }: { variant?: "banner" | "panel"; audience?: "scholar" | "staff" }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState<"on" | "off" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => setState(await getPushState()), []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!state || state.support === "not_configured") return null;
  if (variant === "banner" && !(state.support === "supported" && !state.subscribed)) return null;

  async function turnOn() {
    setBusy("on"); setError(""); setMessage("");
    const r = await enablePush();
    setBusy(null);
    if (!r.ok) setError(r.error); else setMessage("Notifications are on for this device.");
    await refresh();
  }
  async function turnOff() {
    setBusy("off"); setError(""); setMessage("");
    const r = await disablePush();
    setBusy(null);
    if (!r.ok) setError(r.error); else setMessage("Notifications are off for this device.");
    await refresh();
  }
  async function test() {
    setBusy("test"); setError(""); setMessage("");
    const r = await sendTestPush();
    setBusy(null);
    if (!r.ok) setError(r.error);
    else setMessage(r.devices === 0 ? "No device is set up yet." : `A test notification is on its way to ${r.devices} device${r.devices === 1 ? "" : "s"} (it can take a minute).`);
  }

  const button = "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[14px] font-bold disabled:opacity-60";
  return (
    <section aria-label="Notifications on this device" className={variant === "banner" ? "rounded-xl border border-sky-300 bg-sky-50 px-4 py-3" : "rounded-xl border border-[#e6ecf5] bg-white px-4 py-3"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[14px] font-bold text-[#062444]">
            {state.subscribed ? <CheckCircle2 size={16} className="text-green-700" aria-hidden="true" /> : <BellRing size={16} aria-hidden="true" />}
            {state.subscribed ? "Notifications are on for this device" : audience === "staff" ? "Get these on your phone or computer" : "Turn on notifications"}
          </p>
          <p className="mt-0.5 flex items-start gap-1.5 text-[14px] text-slate-700">
            {state.support !== "supported" && <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
            <span>{state.subscribed ? "You will be notified here even when the portal is closed." : PUSH_MESSAGES[state.support]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.support === "supported" && !state.subscribed && (
            <button type="button" onClick={() => void turnOn()} disabled={busy !== null} className={`${button} bg-[#062444] text-white hover:bg-[#0a3a6e]`}>
              {busy === "on" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Turn on notifications
            </button>
          )}
          {state.subscribed && (
            <>
              <button type="button" onClick={() => void test()} disabled={busy !== null} className={`${button} border border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]`}>
                {busy === "test" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Send a test
              </button>
              <button type="button" onClick={() => void turnOff()} disabled={busy !== null} className={`${button} border border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]`}>
                {busy === "off" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Turn off
              </button>
            </>
          )}
        </div>
      </div>
      {message && <p role="status" className="mt-2 text-[14px] font-semibold text-green-800">{message}</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
    </section>
  );
}
