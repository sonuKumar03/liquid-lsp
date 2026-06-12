import { fork } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function formatLSPMessage(jsonPayload: object): string {
  const content = JSON.stringify(jsonPayload);
  return `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n${content}`;
}

export class LSPMessageReader {
  private buffer = '';

  constructor(
    private stdout: NodeJS.ReadableStream,
    private onMessage: (msg: any) => void
  ) {
    this.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });
  }

  private processBuffer() {
    while (true) {
      const delimiterIndex = this.buffer.indexOf('\r\n\r\n');
      if (delimiterIndex === -1) break;

      const headerPart = this.buffer.slice(0, delimiterIndex);
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch || !contentLengthMatch[1]) {
        this.buffer = this.buffer.slice(delimiterIndex + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = delimiterIndex + 4;

      if (Buffer.byteLength(this.buffer.slice(bodyStart), 'utf8') < contentLength) {
        break;
      }

      const bodyPart = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const json = JSON.parse(bodyPart);
        this.onMessage(json);
      } catch (e) {
        console.error('Failed to parse message:', bodyPart, e);
      }
    }
  }
}

export function startLspServer(): ChildProcess {
  const serverPath = path.resolve(__dirname, '../../dist/main.js');
  return fork(serverPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });
}
