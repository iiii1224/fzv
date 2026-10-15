import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerUrls } from '../dist/server/network.js';

const interfaces = {
  lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  wlan: [
    { family: 'IPv4', address: '192.168.0.95' },
    { family: 'IPv6', address: 'fe80::1234', scopeid: 2 },
    { family: 'IPv6', address: '2001:db8::1', scopeid: 0 },
  ],
  tailscale: [{ family: 'IPv4', address: '100.64.0.10' }],
  duplicate: [{ family: 'IPv4', address: '192.168.0.95' }],
};
test('wildcard IPv4 binding lists loopback, LAN, and VPN URLs once', () => {
  assert.deepEqual(viewerUrls('0.0.0.0', 4321, interfaces), [
    'http://127.0.0.1:4321/',
    'http://192.168.0.95:4321/',
    'http://100.64.0.10:4321/',
  ]);
  assert.deepEqual(viewerUrls('0.0.0.0', 4321, {}), ['http://127.0.0.1:4321/']);
});
test('IPv6 wildcard includes usable IPv6 addresses and explicit bindings stay scoped', () => {
  assert.deepEqual(viewerUrls('::', 4321, interfaces), [
    'http://127.0.0.1:4321/',
    'http://[::1]:4321/',
    'http://192.168.0.95:4321/',
    'http://[2001:db8::1]:4321/',
    'http://100.64.0.10:4321/',
  ]);
  assert.deepEqual(viewerUrls('127.0.0.1', 8000, interfaces), [
    'http://127.0.0.1:8000/',
  ]);
  assert.deepEqual(viewerUrls('::1', 8000, interfaces), ['http://[::1]:8000/']);
});
