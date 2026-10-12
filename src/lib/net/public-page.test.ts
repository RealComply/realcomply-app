import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  checkAddress,
  fetchPublicPage,
  isPublicAddress,
  PageRefused,
  type Open,
  type Opened,
  type Resolve,
} from "./public-page";

// Code review fixes, part D1 (12 Oct 2026): the listing check reads only
// public web pages. Finding 6: redirects were followed unchecked, some address
// forms got past the blocklist, and a name resolving to a private address was
// never checked. Finding 23: no size limit. No test here touches the network:
// names are answered by a stand-in resolver and pages by a stand-in server.

const PAGE = "<html><body><h1>12 Example St, Exampleville</h1><p>Guide $750,000</p></body></html>";

const refused = (message: RegExp | string) => (err: unknown) => {
  assert.ok(err instanceof PageRefused, `expected a refusal, got ${String(err)}`);
  if (typeof message === "string") assert.equal(err.message, message);
  else assert.match(err.message, message);
  return true;
};

describe("which addresses are public", () => {
  it("ordinary public addresses are", () => {
    for (const ip of ["8.8.8.8", "104.18.32.7", "13.54.0.1", "2606:4700::6810:1", "2404:6800:4006:80a::2004"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });

  it("this machine, private networks, link-local and cloud metadata are not", () => {
    for (const ip of [
      "127.0.0.1",
      "127.8.9.10",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fd00::1",
      "fe80::1",
      "ff02::1",
    ]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it("an IPv4 address written as IPv6, or carried inside it, is not", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });
});

describe("checking an address before anything is fetched", () => {
  it("accepts an ordinary https listing address", () => {
    assert.equal(checkAddress("https://www.harbourrealty.example/listing/12-example-st").hostname, "www.harbourrealty.example");
  });

  it("refuses the forms that got past the old check, and the rest of the internal ones", () => {
    for (const raw of [
      "https://localhost./",
      "https://[::ffff:127.0.0.1]/",
      "https://[::1]/",
      "https://0x7f.1/",
      "https://2130706433/",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/",
      "https://api.localhost/",
      "https://metadata.google.internal/",
      "https://printer.local/",
      "https://intranet/",
      "https://10.0.0.5/",
      "https://www.harbourrealty.example:8443/",
      "https://user:secret@www.harbourrealty.example/",
    ]) {
      assert.throws(() => checkAddress(raw), refused("That address can't be checked."), raw);
    }
  });

  it("only https, and only something that is an address", () => {
    assert.throws(() => checkAddress("http://www.harbourrealty.example/"), refused("The listing address must start with https://"));
    assert.throws(() => checkAddress("file:///etc/passwd"), refused("The listing address must start with https://"));
    assert.throws(() => checkAddress("not a web address"), refused("That doesn't look like a valid web address."));
  });
});

describe("a name that resolves to a private address", () => {
  it("is refused by the lookup the connection itself uses, before anything is sent", async () => {
    // The real https connection, with a stand-in resolver: the name is looked
    // up once, at connection time, and that one answer is the one checked.
    const asked: string[] = [];
    const resolve: Resolve = async (host) => {
      asked.push(host);
      return [{ address: "10.0.0.5", family: 4 }];
    };

    await assert.rejects(fetchPublicPage("https://listing.rebind.example/", { resolve }), refused("That address can't be checked."));
    assert.deepEqual(asked, ["listing.rebind.example"]);
  });

  it("one private address among public ones is enough to refuse", async () => {
    const resolve: Resolve = async () => [
      { address: "104.18.32.7", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await assert.rejects(fetchPublicPage("https://listing.mixed.example/", { resolve }), refused("That address can't be checked."));
  });
});

// A stand-in web server. Each address answers with what `site` says, after a
// stand-in connection that, like the real one, asks the lookup first.
type Reply = { status?: number; headers?: Record<string, string>; body?: Buffer | string };

function server(site: Record<string, Reply>, addresses: Record<string, string> = {}) {
  const opened: string[] = [];
  const resolve: Resolve = async (host) => [{ address: addresses[host] ?? "104.18.32.7", family: 4 }];
  const open: Open = async (url, lookup) => {
    if (!url.hostname.startsWith("[") && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      await new Promise<void>((ok, fail) => lookup(url.hostname, { all: true }, (err) => (err ? fail(err) : ok())));
    }
    opened.push(url.toString());
    const reply = site[url.toString()];
    if (!reply) return { status: 404, headers: {}, body: Readable.from([]) } satisfies Opened;
    const body = reply.body ?? PAGE;
    return {
      status: reply.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...reply.headers },
      body: Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]),
    };
  };
  return { opened, deps: { resolve, open } };
}

const redirect = (to: string): Reply => ({ status: 302, headers: { location: to }, body: "" });

describe("redirects", () => {
  it("are followed when they lead to another public page, and the final address is returned", async () => {
    const s = server({
      "https://harbourrealty.example/": redirect("https://www.harbourrealty.example/"),
      "https://www.harbourrealty.example/": redirect("/listing/12"),
      "https://www.harbourrealty.example/listing/12": {},
    });

    const page = await fetchPublicPage("https://harbourrealty.example/", s.deps);

    assert.equal(page.url.toString(), "https://www.harbourrealty.example/listing/12");
    assert.equal(page.html, PAGE);
  });

  it("to the cloud metadata service: refused, and never fetched", async () => {
    const s = server({ "https://bad.example/": redirect("http://169.254.169.254/latest/meta-data/") });

    await assert.rejects(fetchPublicPage("https://bad.example/", s.deps), refused(/start with https/));
    assert.deepEqual(s.opened, ["https://bad.example/"]);
  });

  it("to this machine written as IPv6: refused, and never fetched", async () => {
    const s = server({ "https://bad.example/": redirect("https://[::ffff:127.0.0.1]/admin") });

    await assert.rejects(fetchPublicPage("https://bad.example/", s.deps), refused("That address can't be checked."));
    assert.deepEqual(s.opened, ["https://bad.example/"]);
  });

  it("to a name that resolves to a private address: refused, and never fetched", async () => {
    const s = server({ "https://bad.example/": redirect("https://internal.bad.example/") }, { "internal.bad.example": "172.20.0.4" });

    await assert.rejects(fetchPublicPage("https://bad.example/", s.deps), refused("That address can't be checked."));
    assert.deepEqual(s.opened, ["https://bad.example/"]);
  });

  it("three are followed; a fourth is refused", async () => {
    const hops = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`https://loop.example/${i}`, redirect(`https://loop.example/${i + 1}`)]),
      );

    const three = server({ ...hops(3), "https://loop.example/3": {} });
    assert.equal((await fetchPublicPage("https://loop.example/0", three.deps)).url.pathname, "/3");

    const four = server({ ...hops(4), "https://loop.example/4": {} });
    await assert.rejects(fetchPublicPage("https://loop.example/0", four.deps), refused("The page redirected too many times."));
  });
});

describe("what is read", () => {
  it("a page that isn't there: its status, as before", async () => {
    const s = server({});
    await assert.rejects(fetchPublicPage("https://www.harbourrealty.example/gone", s.deps), refused("The page returned 404."));
  });

  it("only a web page", async () => {
    const s = server({ "https://www.harbourrealty.example/data": { headers: { "content-type": "application/json" }, body: "{}" } });
    await assert.rejects(fetchPublicPage("https://www.harbourrealty.example/data", s.deps), refused("That address isn't a web page."));
  });

  it("only the first 3 MB of a huge page", async () => {
    const huge = "<html>" + "x".repeat(5 * 1024 * 1024);
    const s = server({ "https://www.harbourrealty.example/huge": { body: huge } });

    const page = await fetchPublicPage("https://www.harbourrealty.example/huge", s.deps);
    assert.equal(page.html.length, 3 * 1024 * 1024);
  });

  it("a compressed page, counted after it is unpacked", async () => {
    const bomb = gzipSync(Buffer.from("<html>" + "y".repeat(8 * 1024 * 1024)));
    const s = server({
      "https://www.harbourrealty.example/small": { headers: { "content-encoding": "gzip" }, body: gzipSync(PAGE) },
      "https://www.harbourrealty.example/bomb": { headers: { "content-encoding": "gzip" }, body: bomb },
    });

    assert.equal((await fetchPublicPage("https://www.harbourrealty.example/small", s.deps)).html, PAGE);
    assert.equal((await fetchPublicPage("https://www.harbourrealty.example/bomb", s.deps)).html.length, 3 * 1024 * 1024);
  });

  it("why a page couldn't be reached is not passed on", async () => {
    const open: Open = async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 104.18.32.7:443"), { code: "ECONNREFUSED" });
    };
    await assert.rejects(fetchPublicPage("https://www.harbourrealty.example/", { open }), (err: unknown) => {
      assert.ok(err instanceof PageRefused);
      assert.equal(err.message, "The page couldn't be reached.");
      return true;
    });
  });
});
