// The local CA of `pnpm dev:phone` (scripts/phone.ts), docs/security.md (M4). It is installed on the phone
// as a trusted CA, so its key could sign any site: critical name constraints limit it to localhost and the
// private IPv4 ranges, and the server certificate names only those (a name outside them would make the
// whole certificate invalid).
import { spawnSync } from "node:child_process";

/** Private and loopback IPv4 ranges the CA may vouch for: [network, mask]. */
const PERMITTED_IPV4: [string, string][] = [
  ["127.0.0.0", "255.0.0.0"],
  ["10.0.0.0", "255.0.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.168.0.0", "255.255.0.0"],
];

const toInt = (ip: string): number => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

export function isPrivateIPv4(address: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
  const a = toInt(address);
  return PERMITTED_IPV4.some(([net, mask]) => (a & toInt(mask)) >>> 0 === toInt(net));
}

/** subjectAltName of the server certificate: localhost, 127.0.0.1 and the private LAN addresses. */
export function leafSan(addresses: string[]): string {
  return ["DNS:localhost", "IP:127.0.0.1", ...addresses.filter(isPrivateIPv4).map((a) => `IP:${a}`)].join(", ");
}

/** OpenSSL config of the CA certificate. */
export function caConfig(hostname: string): string[] {
  return [
    "[req]",
    "prompt = no",
    "distinguished_name = dn",
    "x509_extensions = v3_ca",
    "[dn]",
    `CN = Pagina Viva dev CA (${hostname})`,
    "O = Pagina Viva (solo sviluppo)",
    "[v3_ca]",
    "basicConstraints = critical, CA:TRUE, pathlen:0",
    "keyUsage = critical, keyCertSign, cRLSign",
    "subjectKeyIdentifier = hash",
    `nameConstraints = critical, permitted;DNS:localhost, ${PERMITTED_IPV4.map(([net, mask]) => `permitted;IP:${net}/${mask}`).join(", ")}`,
  ];
}

export function findOpenssl(): string | null {
  const candidates = [
    "openssl",
    "C:/Program Files/Git/mingw64/bin/openssl.exe",
    "C:/Program Files/Git/usr/bin/openssl.exe",
    "C:/Program Files (x86)/Git/mingw64/bin/openssl.exe",
  ];
  for (const c of candidates) {
    if (spawnSync(c, ["version"], { stdio: "ignore" }).status === 0) return c;
  }
  return null;
}

/** True when the CA certificate file has name constraints (CAs made before 2026-11-10 have none). */
export function caIsConstrained(openssl: string, caCrt: string): boolean {
  const r = spawnSync(openssl, ["x509", "-in", caCrt, "-noout", "-ext", "nameConstraints"], { encoding: "utf8" });
  return r.status === 0 && /Name Constraints/i.test(r.stdout);
}
