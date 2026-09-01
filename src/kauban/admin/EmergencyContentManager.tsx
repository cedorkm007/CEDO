import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, Phone, MessageCircle } from "lucide-react";
import {
  fetchEmergencyContacts, createEmergencyContact, updateEmergencyContact, deleteEmergencyContact,
  fetchEmergencyMessages, createEmergencyMessage, updateEmergencyMessage, deleteEmergencyMessage,
  type EmergencyContact, type EmergencyMessage,
} from "./kaubanAdminApi";

const DEFAULT_COLOR = "#E53E3E";

/**
 * CRUD for the Emergency screen's bundled content — hotline numbers and
 * canned messages. Doesn't touch personal contacts a visitor adds
 * themselves: those live only in that visitor's own browser (no
 * accounts), never in these tables.
 */
export function EmergencyContentManager() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [messages, setMessages] = useState<EmergencyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [contactList, messageList] = await Promise.all([fetchEmergencyContacts(), fetchEmergencyMessages()]);
    setContacts(contactList);
    setMessages(messageList);
    setLoading(false);
  }

  if (loading) return <p className="py-8 text-center text-sm text-slate-400">Loading emergency content…</p>;

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-3 text-[12px] text-red-700">{error}</p>}
      <ContactsSection contacts={contacts} onError={setError} onChange={load} />
      <MessagesSection messages={messages} onError={setError} onChange={load} />
    </div>
  );
}

function ContactsSection({ contacts, onError, onChange }: { contacts: EmergencyContact[]; onError: (e: string) => void; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNumber, setEditNumber] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);

  async function handleAdd() {
    if (!name.trim() || !number.trim()) { onError("Enter both a name and a number."); return; }
    onError("");
    const result = await createEmergencyContact(name, number, color, contacts.length);
    if (!result.ok) { onError(result.error); return; }
    setName(""); setNumber(""); setColor(DEFAULT_COLOR); setAdding(false);
    await onChange();
  }

  function startEdit(contact: EmergencyContact) {
    setEditingId(contact.id);
    setEditName(contact.name); setEditNumber(contact.number); setEditColor(contact.color || DEFAULT_COLOR);
  }

  async function handleSave(id: string) {
    if (!editName.trim() || !editNumber.trim()) { onError("Enter both a name and a number."); return; }
    onError("");
    const result = await updateEmergencyContact(id, { name: editName, number: editNumber, color: editColor });
    if (!result.ok) { onError(result.error); return; }
    setEditingId(null);
    await onChange();
  }

  async function handleDelete(contact: EmergencyContact) {
    if (!window.confirm(`Delete "${contact.name}"?`)) return;
    onError("");
    const result = await deleteEmergencyContact(contact.id);
    if (!result.ok) { onError(result.error); return; }
    await onChange();
  }

  return (
    <div className="rounded-2xl border border-[#062444]/10 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-[#062444]"><Phone size={14} /> Emergency Contacts</h3>

      <div className="space-y-1.5">
        {contacts.map(contact => (
          <div key={contact.id} className="flex items-center gap-2 rounded-lg border border-[#e6ecf5] px-2.5 py-1.5">
            {editingId === contact.id ? (
              <>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" className="min-w-0 flex-1 rounded-md border border-[#062444]/15 px-2 py-1 text-[13px]" />
                <input value={editNumber} onChange={e => setEditNumber(e.target.value)} placeholder="Number" className="w-24 shrink-0 rounded-md border border-[#062444]/15 px-2 py-1 text-[13px]" />
                <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="h-7 w-9 shrink-0 cursor-pointer rounded border border-[#062444]/15" />
                <button onClick={() => void handleSave(contact.id)} className="shrink-0 text-[#0088cc]" aria-label="Save contact"><Check size={14} /></button>
                <button onClick={() => setEditingId(null)} className="shrink-0 text-slate-400" aria-label="Cancel"><X size={14} /></button>
              </>
            ) : (
              <>
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: contact.color }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#062444]">{contact.name}</span>
                <span className="shrink-0 text-[13px] text-slate-500">{contact.number}</span>
                <button onClick={() => startEdit(contact)} className="shrink-0 text-slate-300 hover:text-[#0088cc]" aria-label={`Edit ${contact.name}`}><Pencil size={13} /></button>
                <button onClick={() => void handleDelete(contact)} className="shrink-0 text-slate-300 hover:text-red-600" aria-label={`Delete ${contact.name}`}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}

        {adding ? (
          <div className="flex items-center gap-2 pt-1">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Crisis Hotline)" className="min-w-0 flex-1 rounded-md border border-[#062444]/15 px-2.5 py-1.5 text-[13px]" />
            <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Number" className="w-24 shrink-0 rounded-md border border-[#062444]/15 px-2.5 py-1.5 text-[13px]" />
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-[#062444]/15" />
            <button onClick={() => void handleAdd()} className="shrink-0 rounded-lg bg-[#062444] px-3 py-1.5 text-xs font-bold text-white">Add</button>
            <button onClick={() => setAdding(false)} className="shrink-0 text-xs text-slate-400 hover:underline">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[#062444]/25 py-1.5 text-[13px] font-semibold text-[#0088cc]">
            <Plus size={14} /> Add Contact
          </button>
        )}
      </div>
    </div>
  );
}

function MessagesSection({ messages, onError, onChange }: { messages: EmergencyMessage[]; onError: (e: string) => void; onChange: () => Promise<void> }) {
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function handleAdd() {
    if (!newText.trim()) return;
    onError("");
    const result = await createEmergencyMessage(newText, messages.length);
    if (!result.ok) { onError(result.error); return; }
    setNewText("");
    await onChange();
  }

  async function handleSave(id: string) {
    if (!editText.trim()) { onError("Message can't be empty."); return; }
    onError("");
    const result = await updateEmergencyMessage(id, editText);
    if (!result.ok) { onError(result.error); return; }
    setEditingId(null);
    await onChange();
  }

  async function handleDelete(msg: EmergencyMessage) {
    if (!window.confirm(`Delete this message?\n\n"${msg.message}"`)) return;
    onError("");
    const result = await deleteEmergencyMessage(msg.id);
    if (!result.ok) { onError(result.error); return; }
    await onChange();
  }

  return (
    <div className="rounded-2xl border border-[#062444]/10 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-[#062444]"><MessageCircle size={14} /> Emergency Messages</h3>

      <div className="space-y-1.5">
        {messages.map(msg => (
          <div key={msg.id} className="flex items-center gap-2 rounded-lg border border-[#e6ecf5] px-2.5 py-1.5">
            {editingId === msg.id ? (
              <>
                <input
                  value={editText} onChange={e => setEditText(e.target.value)} autoFocus
                  className="min-w-0 flex-1 rounded-md border border-[#062444]/15 px-2 py-1 text-[13px]"
                  onKeyDown={e => { if (e.key === "Enter") void handleSave(msg.id); if (e.key === "Escape") setEditingId(null); }}
                />
                <button onClick={() => void handleSave(msg.id)} className="shrink-0 text-[#0088cc]" aria-label="Save message"><Check size={14} /></button>
                <button onClick={() => setEditingId(null)} className="shrink-0 text-slate-400" aria-label="Cancel"><X size={14} /></button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#062444]">{msg.message}</span>
                <button onClick={() => { setEditingId(msg.id); setEditText(msg.message); }} className="shrink-0 text-slate-300 hover:text-[#0088cc]" aria-label="Edit message"><Pencil size={13} /></button>
                <button onClick={() => void handleDelete(msg)} className="shrink-0 text-slate-300 hover:text-red-600" aria-label="Delete message"><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <input
            value={newText} onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void handleAdd(); }}
            placeholder="Add a canned message…"
            className="min-w-0 flex-1 rounded-md border border-dashed border-[#062444]/25 px-2.5 py-1.5 text-[13px] outline-none focus:border-[#0088cc]"
          />
          <button onClick={() => void handleAdd()} className="shrink-0 rounded-md bg-[#062444]/5 p-1.5 text-[#062444] hover:bg-[#062444]/10" aria-label="Add message"><Plus size={14} /></button>
        </div>
      </div>
    </div>
  );
}
