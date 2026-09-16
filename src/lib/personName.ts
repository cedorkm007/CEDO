export interface PersonNameParts {
  firstName: string;
  middleInitial: string;
  lastName: string;
}

/** Canonical display format for parent names across Mainstream Scholars and Financial Assistance: FirstName_MiddleInitial_LastName. */
export function formatPersonName({ firstName, middleInitial, lastName }: PersonNameParts): string {
  return [firstName.trim(), middleInitial.trim(), lastName.trim()].filter(Boolean).join("_");
}
