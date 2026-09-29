export function normalizeBtuEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return /^[\x21-\x7e]+@btu\.edu\.ge$/.test(normalized) &&
    normalized.length <= 254
    ? normalized
    : null;
}

export function passwordHint(password: string): string | null {
  if (
    password.length < 12 ||
    password.length > 128 ||
    new TextEncoder().encode(password).length > 256 ||
    !/\S/.test(password)
  ) {
    return "Use 12–128 characters (no more than 256 bytes).";
  }
  const types = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  const words = password
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3).length;
  if (types < 3 && !(password.length >= 20 && words >= 3)) {
    return "Use three character types, or a 20+ character passphrase with three words.";
  }
  return null;
}

export function takeEmailToken(
  location: Pick<Location, "hash" | "pathname" | "search">,
  replaceState: (url: string) => void,
): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (location.hash) replaceState(`${location.pathname}${location.search}`);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
