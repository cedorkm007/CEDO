import { useEffect, useState } from "react";
import { Phone, Plus, Trash2, Volume2, X } from "lucide-react";
import { fetchEmergencyContacts, fetchEmergencyMessages, type EmergencyContact, type EmergencyMessage } from "../kaubanPublicApi";
import { getPersonalContacts, addPersonalContact, removePersonalContact, type PersonalEmergencyContact } from "../localEmergencyContacts";
import { speakText } from "../speechSynthesis";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

const KID_FONT = { fontFamily: "'Fredoka', sans-serif" };

/**
 * Personal contacts (this device only, see localEmergencyContacts.ts)
 * show first — "usually the most relevant in an actual emergency", same
 * reasoning the original app's own EmergencyController used. Bundled
 * contacts/messages below are staff-managed content from Supabase.
 */
export function EmergencyPage() {
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
    <div className="rounded-[20px] bg-[#F7FAFC] p-4 shadow-xl sm:p-10">
      <KaubanPageHeader title="Emergency" subtitle="Quick access to contacts and messages." />

        {currentMessage && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-3xl bg-red-600 px-5 py-5 text-white shadow-lg sm:px-6 sm:py-6">
            <p className="text-xl font-bold sm:text-2xl" style={KID_FONT}>{currentMessage}</p>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => speakText(currentMessage)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 transition active:scale-90 active:bg-white/25" aria-label="Speak again">
                <Volume2 size={20} />
              </button>
              <button onClick={() => setCurrentMessage(null)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 transition active:scale-90 active:bg-white/25" aria-label="Close">
                <X size={20} />
              </button>
            </div>
          </div>
        )}

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-[#2D3748]">Your Contacts</h2>
          <div className="space-y-2">
            {personalContacts.map(contact => (
              <div key={contact.id} className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#2D3748]">{contact.name}</span>
                  <span className="block text-xs text-[#A0AEC0]">{contact.number}</span>
                </span>
                <a href={`tel:${contact.number}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#38A169] text-white transition active:scale-90" aria-label={`Call ${contact.name}`}>
                  <Phone size={17} />
                </a>
                <button onClick={() => handleRemoveContact(contact.id)} className="flex h-11 w-11 items-center justify-center text-[#CBD5E0] transition active:scale-90 hover:text-red-600" aria-label={`Remove ${contact.name}`}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))}

            {adding ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-[#3182CE]/25 bg-white p-3">
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" className="min-w-0 flex-1 rounded-xl border border-[#3182CE]/15 px-3 py-2.5 text-base" />
                <input value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="Number" className="w-32 shrink-0 rounded-xl border border-[#3182CE]/15 px-3 py-2.5 text-base" />
                <button onClick={handleAddContact} className="min-h-11 shrink-0 rounded-full bg-[#3182CE] px-4 text-sm font-bold text-white transition active:scale-95">Add</button>
                <button onClick={() => setAdding(false)} className="min-h-11 shrink-0 px-2 text-xs text-[#A0AEC0] hover:underline">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="flex min-h-12 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[#3182CE]/25 py-2.5 text-sm font-semibold text-[#3182CE] transition active:scale-[0.98]">
                <Plus size={15} /> Add Your Own Contact
              </button>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-[#2D3748]">Emergency Services</h2>
          {loading && <p className="text-sm text-[#718096]">Loading…</p>}
          {!loading && bundledContacts.length === 0 && <p className="text-sm text-[#718096]">No emergency contacts have been added yet.</p>}
          <div className="space-y-2">
            {bundledContacts.map(contact => (
              <a
                key={contact.id}
                href={`tel:${contact.number}`}
                className="flex min-h-[52px] items-center gap-3 rounded-2xl bg-white p-3 shadow-sm transition-transform duration-150 active:scale-[0.98] sm:hover:shadow-md"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: contact.color }} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-[#2D3748]">{contact.name}</span>
                <span className="text-sm font-bold text-[#2D3748]">{contact.number}</span>
                <Phone size={16} className="shrink-0 text-[#38A169]" />
              </a>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[#2D3748]">Quick Messages</h2>
          {!loading && messages.length === 0 && <p className="text-sm text-[#718096]">No emergency messages have been added yet.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {messages.map(msg => (
              <button
                key={msg.id}
                onClick={() => handleTapMessage(msg.message)}
                className="min-h-[52px] rounded-2xl border-2 border-transparent bg-white px-4 py-3 text-left text-sm font-semibold text-[#2D3748] shadow-sm transition-all duration-150 active:scale-[0.97] sm:hover:border-red-300 sm:hover:shadow-md"
              >
                {msg.message}
              </button>
            ))}
          </div>
        </section>
    </div>
  );
}
