import * as path from 'path';
import * as net from 'net';
import type { ExtensionContext } from 'vscode';
import { workspace } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  console.log('Liquid LSP extension activating...');

  const config = workspace.getConfiguration('liquid');
  const mode = config.get<'local' | 'remote'>('server.mode') || 'local';
  const host = config.get<string>('server.host') || 'localhost';
  const port = config.get<number>('server.port') || 6009;

  // Path to the compiled server file
  const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'main.js'));

  let serverOptions: ServerOptions;

  if (mode === 'remote') {
    console.log(`Connecting to remote LSP server at ${host}:${port}`);
    serverOptions = () => {
      const socket = net.connect({ host, port });
      return Promise.resolve({
        writer: socket,
        reader: socket
      });
    };
  } else {
    console.log('Spawning LSP server process: node ' + serverModule + ' --stdio');
    serverOptions = {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: {
        module: serverModule,
        transport: TransportKind.stdio,
        options: { execArgv: ['--nolazy', '--inspect=6009'] }
      }
    };
  }

  // Set selectors and watchers
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'liquid' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.liquid')
    },
    initializationOptions: {
      schema: config.get('schema') || {}
    }
  };

  // Instantiate and launch the client
  client = new LanguageClient('liquidLsp', 'Liquid Language Server', serverOptions, clientOptions);
  client.start();

  console.log('Liquid LSP extension activated successfully.');
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
