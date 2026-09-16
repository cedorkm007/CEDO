export interface PersonNameParts {
  firstName: string;
  middleInitial: string;
  lastName: string;
}

/** Canonical display format for parent names across Mainstream Scholars and Financial Assistance: FirstName MiddleInitial LastName. */
export function formatPersonName({ firstName, middleInitial, lastName }: PersonNameParts): string {
  return [firstName.trim(), middleInitial.trim(), lastName.trim()].filter(Boolean).join(" ");
}
