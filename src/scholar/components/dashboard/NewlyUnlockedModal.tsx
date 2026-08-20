import { PartyPopper, X } from "lucide-react";
import type { FormUnlockNotification } from "../../formsApi";

/**
 * Shown right after a scholar action (quiz passed, attendance redeemed) newly
 * unlocks one or more form materials — or after any other server-side change
 * (staff created a qualifying material, loosened a condition, changed the
 * scholar's year level) the scholar hasn't been shown yet. Backed by
 * syncAndFetchUnreadFormUnlockNotifications() rather than a live before/after
 * diff, so it also catches unlocks the scholar didn't personally trigger.
 * Deliberately generic: it takes whatever notifications to announce and a
 * callback for its one action, so every trigger point (portal load, quiz
 * submit, attendance scan) can reuse it unchanged.
 *
 * `onClose` is expected to also mark these notifications read on the
 * caller's end (via markFormUnlockNotificationsRead) — this component stays
 * presentational and doesn't call that itself, the same way it already
 * doesn't call fetch/sync itself.
 */
export function NewlyUnlockedModal({
  notifications, onGoToForms, onClose,
}: {
  notifications: FormUnlockNotification[];
  onGoToForms: () => void;
  onClose: () => void;
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 pt-6 pb-8 text-center">
          <button onClick={onClose} className="absolute top-3 right-3 text-white/60 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3BC00]/15 text-[#F3BC00]">
            <PartyPopper size={24} />
          </div>
          <h3 className="text-white font-bold text-[16px]">
            {notifications.length === 1 ? "You unlocked a new form!" : `You unlocked ${notifications.length} new forms!`}
          </h3>
        </div>

        <div className="p-5 space-y-3">
          <ul className="space-y-1.5">
            {notifications.map(n => (
              <li key={n.notificationId} className="text-[13.5px] font-semibold text-[#062444] bg-[#f8fafd] rounded-lg px-3 py-2">
                {n.title}
              </li>
            ))}
          </ul>
          <button
            onClick={() => { onGoToForms(); onClose(); }}
            className="w-full bg-[#062444] text-[#F3BC00] rounded-lg py-2.5 font-bold text-[13.5px]"
          >
            View in Forms
          </button>
          <button onClick={onClose} className="w-full text-[12.5px] font-semibold text-slate-400">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
