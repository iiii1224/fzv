import { networkInterfaces } from 'node:os';

export function viewerUrls(
  host: string,
  port: number,
  interfaces = networkInterfaces(),
): string[] {
  const addresses = new Set<string>();
  if (host === '0.0.0.0' || host === '::') {
    addresses.add('127.0.0.1');
    if (host === '::') addresses.add('::1');
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && entry.address !== '0.0.0.0')
          addresses.add(entry.address);
        else if (
          host === '::' &&
          entry.family === 'IPv6' &&
          entry.scopeid === 0 &&
          entry.address !== '::'
        )
          addresses.add(entry.address);
      }
    }
  } else addresses.add(host);
  return [...addresses].map(
    (address) =>
      `http://${address.includes(':') ? `[${address}]` : address}:${port}/`,
  );
}
