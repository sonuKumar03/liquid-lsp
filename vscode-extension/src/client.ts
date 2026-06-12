import * as path from 'path';
import type { ExtensionContext } from 'vscode';
import { workspace } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  console.log('Liquid LSP extension activating...');

  // Path to the compiled server file
  const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'main.js'));

  // Configure how the client starts the server (node dist/main.js --stdio)
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  // Set selectors and watchers
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'liquid' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.liquid')
    },
    initializationOptions: {
      schema: workspace.getConfiguration('liquid').get('schema') || {}
    }
  };

  console.log('Spawning LSP server process: node ' + serverModule + ' --stdio');

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
