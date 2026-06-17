import * as path from 'path';
import * as net from 'net';
import type { ExtensionContext } from 'vscode';
import { workspace, window, type OutputChannel } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import type {
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';

const DEFAULT_REMOTE_LSP_PORT = 6009;
const DEFAULT_LSP_INSPECT_PORT = 6010;

let client: LanguageClient;
let outputChannel: OutputChannel;

export function activate(context: ExtensionContext) {
  outputChannel = window.createOutputChannel('Liquid LSP');
  outputChannel.appendLine('Liquid LSP extension activating...');

  const config = workspace.getConfiguration('liquid');
  const mode = config.get<'local' | 'remote'>('server.mode') || 'local';
  const host = config.get<string>('server.host') || 'localhost';
  const port = config.get<number>('server.port') || DEFAULT_REMOTE_LSP_PORT;

  // Path to the compiled server file
  const serverModule = context.asAbsolutePath(
    path.join('dist', 'server', 'main.cjs'),
  );

  let serverOptions: ServerOptions;

  if (mode === 'remote') {
    outputChannel.appendLine(`Connecting to remote LSP server at ${host}:${port}`);
    serverOptions = () => {
      const socket = net.connect({ host, port });
      socket.on('error', (err) => {
        outputChannel.appendLine(`LSP remote connection error: ${err.message}`);
      });
      return Promise.resolve({
        writer: socket,
        reader: socket,
      });
    };
  } else {
    outputChannel.appendLine(
      'Spawning LSP server process: node ' + serverModule + ' --stdio',
    );
    serverOptions = {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: {
        module: serverModule,
        transport: TransportKind.stdio,
        options: {
          execArgv: [`--nolazy`, `--inspect=${DEFAULT_LSP_INSPECT_PORT}`],
        },
      },
    };
  }

  // Set selectors and watchers
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'liquid' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.liquid'),
    },
    initializationOptions: {
      schema: config.get('schema') || {},
    },
  };

  // Instantiate and launch the client
  client = new LanguageClient(
    'liquidLsp',
    'Liquid Language Server',
    serverOptions,
    clientOptions,
  );
  
  client.start().catch((err) => {
    outputChannel.appendLine(`Liquid LSP server failed to start: ${err instanceof Error ? err.message : String(err)}`);
  });

  outputChannel.appendLine('Liquid LSP extension activated successfully.');
}

export function deactivate(): Thenable<void> | undefined {
  if (outputChannel) {
    outputChannel.dispose();
  }
  if (!client) {
    return undefined;
  }
  return client.stop();
}
