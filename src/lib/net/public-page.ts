import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";

// FETCHING A WEB PAGE SOMEONE ELSE NAMED (code review fixes, part D1, 12 Oct
// 2026).
//
// The listing check reads the page at an address an agent typed in, or one
// found on the agency's own website. That address is fetched by our server, so
// left unchecked it can point our server at places only our server can reach:
// its own machine, the hosting network, the cloud's metadata service. Finding
// 6: redirects were followed without being checked, some address forms got
// past the old blocklist ([::ffff:127.0.0.1], localhost.), and a name that
// resolves to a private address was not checked at all. The page's status
// went onto the card, so the check could be used to map what is in there.
//
// Now:
//   - Only https, on the normal port, with no user name or password in it.
//   - The address is checked when the connection is made, not before: the
//     name is looked up once, and every address it gives must be public, or
//     nothing is sent. A name that answers "public" to a first lookup and
//     "private" to the second (DNS rebinding) has no second lookup to use.
//   - A redirect is followed only after the same checks on where it points,
//     and at most three times.
//   - Only a web page is read (finding 23), and only the first 3 MB of it, so
//     a huge or endless response can't exhaust the function's memory.
//   - Why a page couldn't be reached is not passed on: "couldn't be reached"
//     covers a refused connection and an unknown name alike.

const MAX_REDIRECTS = 3;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** A refusal the person can act on. Anything else becomes "couldn't be reached". */
export class PageRefused extends Error {}

const NOT_ALLOWED = "That address can't be checked.";

// Addresses that are not on the public internet, or are reserved for special
// use. A listing page is never on any of them.
const special4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // this machine
  ["169.254.0.0", 16], // link-local, where cloud metadata services live
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the broadcast address
] as const) {
  special4.addSubnet(net, prefix, "ipv4");
}

// IPv6: only global unicast (2000::/3), less the parts of it that hide an
// IPv4 address or are not routed. An IPv4 address written as IPv6
// (::ffff:127.0.0.1) is outside 2000::/3, so it is refused with the rest.
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const special6 = new BlockList();
for (const [net, prefix] of [
  ["2001::", 23], // protocol assignments, including Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which carries an IPv4 address inside
] as const) {
  special6.addSubnet(net, prefix, "ipv6");
}

/** Whether an IP address is somewhere on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !special4.check(ip, "ipv4");
  if (family === 6) return global6.check(ip, "ipv6") && !special6.check(ip, "ipv6");
  return false;
}

/**
 * The checks that need no network: a valid https address on the normal port,
 * no credentials, a public IP if it is one, and a name that could be public.
 */
export function checkAddress(raw: string | URL, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new PageRefused("That doesn't look like a valid web address.");
  }
  if (url.protocol !== "https:") throw new PageRefused("The listing address must start with https://");
  if (url.port !== "" || url.username !== "" || url.password !== "") throw new PageRefused(NOT_ALLOWED);

  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) {
    if (!isPublicAddress(host.slice(1, -1))) throw new PageRefused(NOT_ALLOWED);
    return url;
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new PageRefused(NOT_ALLOWED);
    return url;
  }
  // A name. "localhost." with its trailing dot is still localhost, and a name
  // with no dot at all is looked up on the local network, not the internet.
  const name = host.replace(/\.$/, "");
  if (
    !name.includes(".") ||
    name.endsWith(".localhost") ||
    name.endsWith(".internal") ||
    name.endsWith(".local") ||
    name.endsWith(".home.arpa")
  ) {
    throw new PageRefused(NOT_ALLOWED);
  }
  return url;
}

export type Resolved = Array<{ address: string; family: number }>;
export type Resolve = (host: string) => Promise<Resolved>;

const systemResolve: Resolve = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | Resolved, family?: number) => void;

/**
 * The lookup the connection itself uses: every address the name gives must be
 * public, or the connection is refused before anything is sent.
 */
export function publicOnlyLookup(resolve: Resolve) {
  return (host: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(host).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
          callback(new PageRefused(NOT_ALLOWED), "");
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, ""),
    );
  };
}

/** One response, before its body is read. */
export type Opened = { status: number; headers: Record<string, string | string[] | undefined>; body: NodeJS.ReadableStream };
export type Open = (url: URL, lookup: ReturnType<typeof publicOnlyLookup>, signal: AbortSignal) => Promise<Opened>;

const httpsOpen: Open = (url, lookup, signal) =>
  new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      // A connection of its own, so the lookup above is always the one used.
      agent: false,
      lookup: lookup as never,
      signal,
      headers: {
        // Identifies us honestly. A site owner reading their logs should be
        // able to tell who this is, and it is the agency's own website.
        "User-Agent": "RealComply-AdvertisedPriceCheck/1.0 (+https://www.realcomply.com.au)",
        Accept: "text/html",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });
    req.on("response", (res: IncomingMessage) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
    req.on("error", reject);
    req.end();
  });

function decoded(opened: Opened): NodeJS.ReadableStream {
  const encoding = String(opened.headers["content-encoding"] ?? "identity").toLowerCase().trim();
  if (encoding === "identity" || encoding === "") return opened.body;
  if (encoding === "gzip" || encoding === "x-gzip") return opened.body.pipe(zlib.createGunzip());
  if (encoding === "deflate") return opened.body.pipe(zlib.createInflate());
  if (encoding === "br") return opened.body.pipe(zlib.createBrotliDecompress());
  throw new PageRefused("The page couldn't be read.");
}

/** The first MAX_BYTES of the page, as text. Counted after decompression. */
async function readCapped(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const room = MAX_BYTES - total;
    chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    total += Math.min(chunk.length, room);
    if (total >= MAX_BYTES) break;
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** Done with a response: close it rather than download the rest. */
function discard(body: NodeJS.ReadableStream): void {
  const stream = body as NodeJS.ReadableStream & { destroy?: () => void };
  stream.destroy?.();
}

/**
 * Reads a public web page at an address someone else supplied. Returns the
 * page's text and the address it ended up at, after any redirects.
 *
 * Throws PageRefused with a message fit for the card, and nothing more
 * specific than "couldn't be reached" for anything else.
 */
export async function fetchPublicPage(
  raw: string | URL,
  deps: { resolve?: Resolve; open?: Open } = {},
): Promise<{ url: URL; html: string }> {
  const lookup = publicOnlyLookup(deps.resolve ?? systemResolve);
  const open = deps.open ?? httpsOpen;
  // One limit for the whole read, redirects included. A page that hangs should
  // fail the check, not the whole daily run.
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  let url = checkAddress(raw);
  try {
    for (let redirects = 0; ; redirects++) {
      const res = await open(url, lookup, signal);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        discard(res.body);
        if (redirects >= MAX_REDIRECTS) throw new PageRefused("The page redirected too many times.");
        url = checkAddress(String(location), url);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        discard(res.body);
        throw new PageRefused(`The page returned ${res.status}.`);
      }
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
        discard(res.body);
        throw new PageRefused("That address isn't a web page.");
      }
      try {
        return { url, html: await readCapped(decoded(res)) };
      } finally {
        discard(res.body);
      }
    }
  } catch (err) {
    if (err instanceof PageRefused) throw err;
    if (signal.aborted) throw new PageRefused("The page took too long to respond.");
    throw new PageRefused("The page couldn't be reached.");
  }
}
