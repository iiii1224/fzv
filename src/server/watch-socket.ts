import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ProjectChange } from '../shared.js';

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header = Buffer.alloc(length < 126 ? 2 : length <= 0xffff ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (header.length === 2) {
    header[1] = length;
  } else if (header.length === 4) {
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Notifications are server-to-client. Only WebSocket control frames may come back. */
export class WatchSockets {
  private clients = new Set<Duplex>();
  private revision = randomUUID();

  upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    hosts: Set<string>,
  ): void {
    socket.on('error', () => socket.destroy());
    const reject = (status: string) =>
      socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    if (req.url !== '/api/events') {
      reject('404 Not Found');
      return;
    }
    const authority = req.headers.host?.toLowerCase() ?? '';
    const origin = URL.parse(`http://${authority}`);
    if (
      !origin ||
      (authority !== origin.host && authority !== `${origin.host}:80`) ||
      !hosts.has(origin.hostname) ||
      (req.headers.origin !== `http://${authority}` &&
        req.headers.origin !== `https://${authority}`)
    ) {
      reject('403 Forbidden');
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (
      req.method !== 'GET' ||
      req.headers.upgrade?.toLowerCase() !== 'websocket' ||
      req.headers['sec-websocket-version'] !== '13' ||
      typeof key !== 'string' ||
      !/^[A-Za-z0-9+/]{21}[AQgw]==$/.test(key)
    ) {
      reject('400 Bad Request');
      return;
    }
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    this.clients.add(socket);
    socket.once('close', () => this.clients.delete(socket));
    this.send(socket, this.message([]));

    let pending: Buffer<ArrayBufferLike> = head;
    const read = (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 2 && !socket.writableEnded) {
        const opcode = pending[0];
        const length = pending[1] & 0x7f;
        if (
          ![0x88, 0x89, 0x8a].includes(opcode) ||
          !(pending[1] & 0x80) ||
          length > 125 ||
          (opcode === 0x88 && length === 1)
        ) {
          socket.end(frame(0x8, Buffer.from([0x03, 0xea]))); // 1002: protocol error
          return;
        }
        if (pending.length < 6 + length) return;
        const payload = Buffer.alloc(length);
        for (let i = 0; i < length; i++)
          payload[i] = pending[6 + i] ^ pending[2 + (i % 4)];
        pending = pending.subarray(6 + length);
        if (opcode === 0x88) socket.end(frame(0x8, payload));
        if (opcode === 0x89) this.send(socket, frame(0xa, payload));
      }
    };
    if (head.length) read(Buffer.alloc(0));
    socket.on('data', read);
  }

  broadcast(paths: ProjectChange['paths']): void {
    this.revision = randomUUID();
    const message = this.message(paths);
    for (const client of this.clients) this.send(client, message);
  }

  close(): void {
    for (const client of this.clients) client.destroy();
    this.clients.clear();
  }

  private message(paths: ProjectChange['paths']): Buffer {
    const change: ProjectChange = { revision: this.revision, paths };
    return frame(0x1, Buffer.from(JSON.stringify(change)));
  }

  private send(socket: Duplex, message: Buffer): void {
    if (socket.destroyed || socket.writableEnded) return;
    if (socket.writableNeedDrain) socket.destroy();
    else socket.write(message);
  }
}
