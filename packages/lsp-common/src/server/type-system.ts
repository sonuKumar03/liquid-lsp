import * as fs from 'fs';
import * as path from 'path';
import {
  mergeVariableSchemas,
  parseVariableSchema,
  type LiquidType,
  type SchemaLoadError,
} from 'key-pointer-schema';

export interface TypeSystemLogger {
  log(message: string): void;
  error(message: string): void;
}

const defaultLogger: TypeSystemLogger = {
  log: () => {},
  error: () => {},
};

export class TypeSystem {
  private liquidSchema = new Map<string, LiquidType>();
  private schemaLoadErrors: SchemaLoadError[] = [];
  private contextData: Record<string, unknown> = {};
  private workspaceRoot: string | null = null;

  constructor(private readonly logger: TypeSystemLogger = defaultLogger) {}

  getLiquidSchema(): Map<string, LiquidType> {
    return this.liquidSchema;
  }

  getSchemaLoadErrors(): SchemaLoadError[] {
    return this.schemaLoadErrors;
  }

  getContextData(): Record<string, unknown> {
    return this.contextData;
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  setWorkspaceRoot(rootPath: string | null): void {
    this.workspaceRoot = rootPath;
  }

  setContextData(contextData: Record<string, unknown>): void {
    this.contextData = contextData;
  }

  applyVariableSchema(raw: unknown, context?: string): void {
    const parsed = parseVariableSchema(raw);
    if (parsed.usedLegacyLiquidSchema) {
      this.logger.log(
        `LSP server: loaded legacy liquid schema${context ? ` from ${context}` : ''}.`,
      );
    }

    this.liquidSchema = parsed.liquidSchema;
    this.schemaLoadErrors = parsed.errors;

    if (this.schemaLoadErrors.length > 0) {
      this.reportSchemaLoadErrors();
      this.logger.log(
        `LSP server: variable schema has ${this.schemaLoadErrors.length} issue(s)${context ? ` (${context})` : ''}.`,
      );
    }
  }

  loadWorkspaceSchemaFile(rootPath: string): void {
    const configPath = path.join(rootPath, '.liquid-schema.json');
    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const rawData = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(rawData);
      const fileResult = parseVariableSchema(parsed);
      const merged = mergeVariableSchemas(
        {
          variables: new Map(),
          liquidSchema: this.liquidSchema,
          errors: [],
          usedLegacyLiquidSchema: false,
        },
        fileResult,
      );
      this.liquidSchema = merged.liquidSchema;
      this.schemaLoadErrors = [...this.schemaLoadErrors, ...merged.errors];
      this.logger.log(`LSP server: Loaded local schema from ${configPath}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.log(`LSP server: Error parsing ${configPath}: ${message}`);
      this.schemaLoadErrors = [
        ...this.schemaLoadErrors,
        {
          severity: 'error',
          code: 'key_pointer.schema.load_error',
          message: `Failed to parse ${configPath}: ${message}`,
        },
      ];
    }
  }

  mergeWorkspaceSchemaIfPresent(): void {
    if (this.workspaceRoot) {
      this.loadWorkspaceSchemaFile(this.workspaceRoot);
    }
  }

  private reportSchemaLoadErrors(): void {
    for (const error of this.schemaLoadErrors) {
      if (error.severity !== 'error') {
        continue;
      }
      this.logger.error(`Schema error: ${error.message}`);
    }
  }
}
