import * as fs from 'fs';
import * as path from 'path';
import type { WorkspaceSchemaLoader } from 'lsp-common';

/** Node filesystem loader for workspace `.liquid-schema.json` merge on init/update. */
export const nodeWorkspaceSchemaLoader: WorkspaceSchemaLoader = {
  load(rootPath: string): unknown | null {
    const configPath = path.join(rootPath, '.liquid-schema.json');
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const rawData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(rawData);
  },
};
