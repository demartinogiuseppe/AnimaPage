// docs/security.md (M4): the local CA of `pnpm dev:phone` can only vouch for localhost and private LAN addresses.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caConfig, findOpenssl, isPrivateIPv4, leafSan } from "../scripts/dev-ca.ts";

describe("dev CA helpers", () => {
  it("knows the private IPv4 ranges", () => {
    for (const a of ["10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.10", "127.0.0.1"]) expect(isPrivateIPv4(a), a).toBe(true);
    for (const a of ["172.32.0.1", "8.8.8.8", "100.64.1.2", "169.254.1.1", "192.169.0.1"]) expect(isPrivateIPv4(a), a).toBe(false);
  });
  it("the server certificate names localhost and private addresses only", () => {
    expect(leafSan(["192.168.1.10", "100.101.102.103", "10.0.0.5"])).toBe("DNS:localhost, IP:127.0.0.1, IP:192.168.1.10, IP:10.0.0.5");
  });
  it("the CA carries critical name constraints", () => {
    expect(caConfig("pc").join("\n")).toMatch(/^nameConstraints = critical, permitted;DNS:localhost, permitted;IP:127\.0\.0\.0\/255\.0\.0\.0,.*permitted;IP:192\.168\.0\.0\/255\.255\.0\.0$/m);
  });
});

const openssl = findOpenssl();
describe.skipIf(!openssl)("dev CA with OpenSSL", () => {
  it("signs LAN certificates that verify, and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-ca-"));
    const p = (f: string) => join(dir, f);
    const run = (args: string[]) => execFileSync(openssl!, args, { stdio: ["ignore", "ignore", "pipe"] });
    writeFileSync(p("ca.cnf"), caConfig("pc").join("\n"));
    run(["req", "-x509", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", p("ca.key"), "-out", p("ca.crt"), "-days", "2", "-config", p("ca.cnf")]);
    const leaf = (name: string, san: string) => {
      writeFileSync(p(`${name}.cnf`), ["[req]", "prompt = no", "distinguished_name = dn", "[dn]", "CN = Pagina Viva dev server", "[v3_leaf]", "basicConstraints = critical, CA:FALSE", "extendedKeyUsage = serverAuth", `subjectAltName = ${san}`].join("\n"));
      run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", p(`${name}.key`), "-out", p(`${name}.csr`), "-config", p(`${name}.cnf`)]);
      run(["x509", "-req", "-in", p(`${name}.csr`), "-CA", p("ca.crt"), "-CAkey", p("ca.key"), "-set_serial", "1", "-days", "1", "-extfile", p(`${name}.cnf`), "-extensions", "v3_leaf", "-out", p(`${name}.crt`)]);
      return spawnSync(openssl!, ["verify", "-CAfile", p("ca.crt"), p(`${name}.crt`)], { encoding: "utf8" });
    };
    expect(leaf("lan", leafSan(["192.168.1.10", "10.0.0.5"])).status).toBe(0);
    const evil = leaf("evil", "DNS:www.example.com");
    expect(evil.status).not.toBe(0);
    expect(evil.stdout + evil.stderr).toMatch(/subtree violation/i);
    expect(leaf("public-ip", "IP:8.8.8.8").status).not.toBe(0);
  }, 60_000);
});
