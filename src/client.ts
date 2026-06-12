import * as path from 'path';
import type { ExtensionContext } from 'vscode';
import { workspace } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // Path to the compiled server file
  const serverModule = context.asAbsolutePath(path.join('dist', 'main.js'));

  // Configure how the client starts the server (node dist/main.js --stdio)
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio }
  };

  // Set selectors and watchers
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'liquid' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.liquid')
    }
  };

  // Instantiate and launch the client
  client = new LanguageClient('liquidLsp', 'Liquid Language Server', serverOptions, clientOptions);
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
