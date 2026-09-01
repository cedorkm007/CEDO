import { useEffect, useState } from "react";
import { Phone, Plus, Trash2, Volume2, X } from "lucide-react";
import { fetchEmergencyContacts, fetchEmergencyMessages, type EmergencyContact, type EmergencyMessage } from "../kaubanPublicApi";
import { getPersonalContacts, addPersonalContact, removePersonalContact, type PersonalEmergencyContact } from "../localEmergencyContacts";
import { speakText } from "../speechSynthesis";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/**
 * Personal contacts (this device only, see localEmergencyContacts.ts)
 * show first — "usually the most relevant in an actual emergency", same
 * reasoning the original app's own EmergencyController used. Bundled
 * contacts/messages below are staff-managed content from Supabase.
 */
export function EmergencyPage({ onBack }: { onBack: () => void }) {
  const [personalContacts, setPersonalContacts] = useState<PersonalEmergencyContact[]>([]);
  const [bundledContacts, setBundledContacts] = useState<EmergencyContact[]>([]);
  const [messages, setMessages] = useState<EmergencyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");

  useEffect(() => {
    setPersonalContacts(getPersonalContacts());
    (async () => {
      const [contacts, msgs] = await Promise.all([fetchEmergencyContacts(), fetchEmergencyMessages()]);
      setBundledContacts(contacts);
      setMessages(msgs);
      setLoading(false);
    })();
  }, []);

  function handleAddContact() {
    if (!newName.trim() || !newNumber.trim()) return;
    setPersonalContacts(addPersonalContact(newName.trim(), newNumber.trim()));
    setNewName("");
    setNewNumber("");
    setAdding(false);
  }

  function handleRemoveContact(id: string) {
    setPersonalContacts(removePersonalContact(id));
  }

  function handleTapMessage(message: string) {
    setCurrentMessage(message);
    speakText(message);
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <KaubanPageHeader title="Emergency" subtitle="Quick access to contacts and messages." onBack={onBack} />

        {currentMessage && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl bg-red-600 px-6 py-6 text-white shadow-lg">
            <p className="text-2xl font-bold">{currentMessage}</p>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => speakText(currentMessage)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Speak again">
                <Volume2 size={20} />
              </button>
              <button onClick={() => setCurrentMessage(null)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Close">
                <X size={20} />
              </button>
            </div>
          </div>
        )}

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-[#1E1B3A]">Your Contacts</h2>
          <div className="space-y-2">
            {personalContacts.map(contact => (
              <div key={contact.id} className="flex items-center gap-3 rounded-xl border border-[#4F46E5]/10 bg-white p-3 shadow-sm">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#1E1B3A]">{contact.name}</span>
                  <span className="block text-xs text-slate-400">{contact.number}</span>
                </span>
                <a href={`tel:${contact.number}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white hover:opacity-90" aria-label={`Call ${contact.name}`}>
                  <Phone size={15} />
                </a>
                <button onClick={() => handleRemoveContact(contact.id)} className="text-slate-300 hover:text-red-600" aria-label={`Remove ${contact.name}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            {adding ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#4F46E5]/25 bg-white p-3">
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" className="min-w-0 flex-1 rounded-md border border-[#4F46E5]/15 px-2.5 py-1.5 text-sm" />
                <input value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="Number" className="w-32 shrink-0 rounded-md border border-[#4F46E5]/15 px-2.5 py-1.5 text-sm" />
                <button onClick={handleAddContact} className="shrink-0 rounded-md bg-[#4F46E5] px-3 py-1.5 text-xs font-bold text-white">Add</button>
                <button onClick={() => setAdding(false)} className="shrink-0 text-xs text-slate-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#4F46E5]/25 py-2.5 text-sm font-semibold text-[#4F46E5]">
                <Plus size={15} /> Add Your Own Contact
              </button>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-[#1E1B3A]">Emergency Services</h2>
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {!loading && bundledContacts.length === 0 && <p className="text-sm text-slate-400">No emergency contacts have been added yet.</p>}
          <div className="space-y-2">
            {bundledContacts.map(contact => (
              <a
                key={contact.id}
                href={`tel:${contact.number}`}
                className="flex items-center gap-3 rounded-xl border border-[#4F46E5]/10 bg-white p-3 shadow-sm hover:shadow-md"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: contact.color }} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-[#1E1B3A]">{contact.name}</span>
                <span className="text-sm font-bold text-[#1E1B3A]">{contact.number}</span>
                <Phone size={16} className="shrink-0 text-emerald-500" />
              </a>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[#1E1B3A]">Quick Messages</h2>
          {!loading && messages.length === 0 && <p className="text-sm text-slate-400">No emergency messages have been added yet.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {messages.map(msg => (
              <button
                key={msg.id}
                onClick={() => handleTapMessage(msg.message)}
                className="rounded-xl border-2 border-transparent bg-white px-4 py-3 text-left text-sm font-semibold text-[#1E1B3A] shadow-sm hover:border-red-300 hover:shadow-md"
              >
                {msg.message}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
