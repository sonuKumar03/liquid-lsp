export { startServer, type StartServerDependencies } from './server/startServer.js';
export { TypeSystem, type WorkspaceSchemaLoader } from './server/type-system.js';
export { DocumentManager } from './server/document-manager.js';
export { DiagnosticsScheduler } from './server/diagnostics-scheduler.js';
export { SERVER_CAPABILITIES } from './server/capabilities.js';
export { collectVariableNamesFromTokens } from './shared/token-variables.js';
