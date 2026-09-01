/**
 * A visitor's own emergency contacts — the direct equivalent of the
 * original app's per-device `storage/app/setup.json` personal contacts
 * (see docs/kauban/PROGRESS.md milestone 1: "there's one install per
 * device, so there's no need for multi-user storage"). Kept separate
 * from the staff-managed bundled contacts in Supabase
 * (kaubanPublicApi.fetchEmergencyContacts) — these are private to this
 * browser and never leave it.
 */
export interface PersonalEmergencyContact {
  id: string;
  name: string;
  number: string;
}

const KEY = "kauban_personal_emergency_contacts";

export function getPersonalContacts(): PersonalEmergencyContact[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersonalEmergencyContact[]) : [];
  } catch {
    return [];
  }
}

function savePersonalContacts(contacts: PersonalEmergencyContact[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(contacts)); } catch { /* ignore */ }
}

export function addPersonalContact(name: string, number: string): PersonalEmergencyContact[] {
  const updated = [...getPersonalContacts(), { id: crypto.randomUUID(), name, number }];
  savePersonalContacts(updated);
  return updated;
}

export function removePersonalContact(id: string): PersonalEmergencyContact[] {
  const updated = getPersonalContacts().filter(c => c.id !== id);
  savePersonalContacts(updated);
  return updated;
}
