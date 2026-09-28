export type NormalizedBrazilPhone = {
  national: string;
  e164: string;
};

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeBrazilPhone(value: string): NormalizedBrazilPhone | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (compact.startsWith("+") && !compact.startsWith("+55")) {
    return null;
  }

  let digits = phoneDigits(value);

  while (digits.startsWith("0") && digits.length > 11) {
    digits = digits.slice(1);
  }

  const national = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (national.length !== 10 && national.length !== 11) {
    return null;
  }

  return { national, e164: `55${national}` };
}

export function normalizeBrazilPhoneNational(value: string): string | null {
  return normalizeBrazilPhone(value)?.national ?? null;
}

export function getBrazilPhoneLookupCandidates(value: string): string[] {
  const normalized = normalizeBrazilPhone(value);
  return normalized ? [normalized.national, normalized.e164] : [];
}
