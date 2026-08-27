/**
 * Single source of truth for "is this URL safe for the scraper to fetch?".
 *
 * The scraper fetches URLs that users supply and, worse, URLs discovered
 * inside the pages it scrapes. It runs on the same host as the dev server and
 * can reach loopback and LAN services, so an unguarded fetch is an SSRF
 * primitive. Three things are required and all three used to be missing:
 *
 *   1. Lexical checks that actually fire. WHATWG URL brackets IPv6 literals
 *      ("[::1]") and keeps the FQDN root dot ("localhost."), so naive
 *      comparisons silently never match.
 *   2. DNS resolution. A lexical check alone cannot see that localtest.me and
 *      127.0.0.1.nip.io resolve to loopback.
 *   3. Re-validation on every redirect hop. Validating only the submitted URL
 *      is useless when the response is a 302 to 127.0.0.1.
 *
 * Import this module rather than re-implementing any part of it.
 */
import net from "node:net";
import dnsPromises from "node:dns/promises";

const MAX_URL_LENGTH = 500;
const MAX_REDIRECT_HOPS = 5;

/**
 * WHATWG URL wraps IPv6 literals in brackets and preserves the trailing root
 * dot on FQDNs. Both forms reach the same host as the bare name, so strip them
 * before comparing — otherwise every check below is dead code.
 */
export function normalizeHost(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

function isPrivateIpv4(host) {
  const p = host.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // Unparseable: fail closed.
  }
  if (p[0] === 0) return true; // "this network"
  if (p[0] === 10) return true; // RFC1918
  if (p[0] === 127) return true; // loopback
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT, incl. Alibaba IMDS 100.100.100.200
  if (p[0] === 169 && p[1] === 254) return true; // link-local, incl. cloud IMDS 169.254.169.254
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // RFC1918
  if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true; // IETF protocol assignments, incl. Oracle IMDS 192.0.0.192
  if (p[0] === 192 && p[1] === 168) return true; // RFC1918
  if (p[0] === 198 && p[1] >= 18 && p[1] <= 19) return true; // benchmarking
  if (p[0] >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** True when the address is loopback, private, link-local or otherwise not a public destination. */
export function isPrivateIp(host) {
  if (net.isIPv4(host)) return isPrivateIpv4(host);
  if (!net.isIPv6(host)) return true; // Not an IP at all: fail closed.

  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true; // fe80::/10 link-local (fe80–febf)
  if (/^ff[0-9a-f]{2}:/i.test(host)) return true; // ff00::/8 multicast

  // IPv4-mapped (::ffff:127.0.0.1) reaches the same host as the bare IPv4
  // address. Node normalises the dotted form to hex pairs (::ffff:7f00:1),
  // so handle both spellings.
  const mapped = /^::ffff:(.+)$/i.exec(host);
  if (mapped) {
    const tail = mapped[1];
    if (net.isIPv4(tail)) return isPrivateIpv4(tail);
    const pair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
    if (pair) {
      const high = parseInt(pair[1], 16);
      const low = parseInt(pair[2], 16);
      return isPrivateIpv4(
        [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join("."),
      );
    }
  }
  return false;
}

/** Hostnames that always mean "this machine" or "this network". */
function isBlockedHostname(host) {
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

/**
 * Cheap, synchronous, no-DNS validation. Use at input time so a bad URL is
 * rejected with a helpful message before it is ever stored. This is NOT
 * sufficient on its own — see assertPublicUrl.
 */
export function validateExternalUrl(input) {
  if (!input) return { error: "url is required" };
  if (input.length > MAX_URL_LENGTH) return { error: "url is too long" };

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { error: "invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { error: "URL must use http or https" };
  }

  const host = normalizeHost(parsed.hostname);
  if (!host) return { error: "invalid URL" };
  if (isBlockedHostname(host)) {
    return { error: "URL points to a local/internal host — not allowed" };
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    return { error: "URL points to a private IP range — not allowed" };
  }
  return { ok: true };
}

/**
 * Full check, including DNS. Throws when the URL is not a public destination.
 *
 * A lexical check cannot catch a public name that resolves to loopback
 * (localtest.me, 127.0.0.1.nip.io, or plain DNS rebinding), so resolve the
 * host and reject if ANY returned address is private.
 */
export async function assertPublicUrl(urlString) {
  const lexical = validateExternalUrl(urlString);
  if (lexical.error) throw new Error(`blocked URL: ${lexical.error}`);

  const host = normalizeHost(new URL(urlString).hostname);
  if (net.isIP(host)) return; // Already checked lexically.

  let addresses;
  try {
    addresses = await dnsPromises.lookup(host, { all: true });
  } catch {
    // Unresolvable. Let the fetch itself fail and report a real network error.
    return;
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(
        `blocked URL: ${host} resolves to a private address (${address})`,
      );
    }
  }
}

/**
 * fetch() that validates every hop.
 *
 * Node follows redirects internally with redirect:"follow", which means a host
 * that passed validation can bounce the request to 127.0.0.1 and the guard
 * never sees it. Follow redirects manually so each Location is re-validated.
 */
export async function guardedFetch(urlString, init = {}) {
  let current = urlString;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    await assertPublicUrl(current);
    const response = await fetch(current, { ...init, redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error(`blocked URL: more than ${MAX_REDIRECT_HOPS} redirects`);
}
