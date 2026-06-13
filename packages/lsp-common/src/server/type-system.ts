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

export interface WorkspaceSchemaLoader {
  load(rootPath: string): unknown | null;
}

const defaultLogger: TypeSystemLogger = {
  log: () => {},
  error: () => {},
};

/**
 * Holds client-supplied variable schema state for the LSP session.
 * Parses key-pointer payloads via key-pointer-schema and optionally merges
 * workspace `.liquid-schema.json` through an injected loader (Node only).
 */
export class TypeSystem {
  private liquidSchema = new Map<string, LiquidType>();
  private schemaLoadErrors: SchemaLoadError[] = [];
  private contextData: Record<string, unknown> = {};
  private workspaceRoot: string | null = null;

  constructor(
    private readonly logger: TypeSystemLogger = defaultLogger,
    private readonly workspaceSchemaLoader?: WorkspaceSchemaLoader,
  ) {}

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
    if (!this.workspaceSchemaLoader) {
      return;
    }

    try {
      const raw = this.workspaceSchemaLoader.load(rootPath);
      if (!raw) {
        return;
      }

      const fileResult = parseVariableSchema(raw);
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
      this.logger.log(
        `LSP server: Loaded workspace schema for ${rootPath}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.log(
        `LSP server: Error loading workspace schema for ${rootPath}: ${message}`,
      );
      this.schemaLoadErrors = [
        ...this.schemaLoadErrors,
        {
          severity: 'error',
          code: 'key_pointer.schema.load_error',
          message: `Failed to load workspace schema for ${rootPath}: ${message}`,
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
