/**
 * LSP stream parser to extract JSON payloads from Content-Length stream.
 *
 * To ensure safe processing of binary streams (like UTF-8 chunk streams),
 * this parser keeps raw bytes inside a Buffer instead of parsing strings.
 */
export class LSPStreamParser {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  constructor(private onMessage: (msg: string) => void) {}

  public append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
    this.processBuffer();
  }

  private processBuffer(): void {
    if (this.chunks.length > 1) {
      this.chunks = [Buffer.concat(this.chunks, this.totalLength)];
    }
    let buffer = this.chunks[0] || Buffer.alloc(0);

    while (true) {
      // Find the header delimiter \r\n\r\n (sequence: 13, 10, 13, 10)
      const delimiterIndex = buffer.indexOf('\r\n\r\n');
      if (delimiterIndex === -1) break;

      const headerPart = buffer.subarray(0, delimiterIndex).toString('utf8');
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch || !contentLengthMatch[1]) {
        // Stream is corrupted. Discard up to next Content-Length header to resynchronize.
        const str = buffer.toString('utf8');
        const nextHeaderMatch = str
          .slice(delimiterIndex + 4)
          .match(/Content-Length:/i);
        if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
          buffer = buffer.subarray(delimiterIndex + 4 + nextHeaderMatch.index);
        } else {
          buffer = Buffer.alloc(0);
        }
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = delimiterIndex + 4;

      if (buffer.length < bodyStart + contentLength) {
        // Wait for more data to complete the body
        break;
      }

      // Extract the body buffer and convert to string
      const bodyBuffer = buffer.subarray(bodyStart, bodyStart + contentLength);
      const bodyPart = bodyBuffer.toString('utf8');

      // Update the remaining buffer
      buffer = buffer.subarray(bodyStart + contentLength);

      this.onMessage(bodyPart);
    }

    if (buffer.length === 0) {
      this.chunks = [];
      this.totalLength = 0;
    } else {
      this.chunks = [buffer];
      this.totalLength = buffer.length;
    }
  }
}

/**
 * Format JSON object/payload to LSP standard stream message with headers.
 */
export function formatLSPMessage(payload: string): string {
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}
