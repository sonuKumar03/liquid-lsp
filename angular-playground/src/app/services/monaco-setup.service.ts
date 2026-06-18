import { Injectable, isDevMode } from '@angular/core';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { initServices } from 'monaco-languageclient/vscode/services';

/** Asset path for the Monaco web worker bundle. */
const MONACO_WORKER_URL = '/assets/monaco/vs/base/worker/workerMain.js';

/** Folder URI used as the virtual workspace root in Monaco. */
const PLAYGROUND_WORKSPACE_URI = 'file:///playground';

/**
 * Handles one-time Monaco bootstrap steps.
 *
 * Each method is idempotent and safe to call multiple times.
 */
@Injectable({ providedIn: 'root' })
export class MonacoSetupService {

  /**
   * Sets `window.MonacoEnvironment` if not already set.
   * Must be called before `initVscodeServices`.
   */
  ensureWorkerEnvironment(): void {
    if (!(window as unknown as Record<string, unknown>)['MonacoEnvironment']) {
      (window as unknown as Record<string, unknown>)['MonacoEnvironment'] = {
        getWorkerUrl: (): string => MONACO_WORKER_URL,
      };
    }
  }

  /**
   * Initialises the vscode-api services required by Monaco Language Client.
   * Skips silently if already initialised.
   */
  async initVscodeServices(): Promise<void> {
    const env = (window as unknown as Record<string, unknown>)['MonacoEnvironment'] as
      | Record<string, unknown>
      | undefined;

    if (env?.['vscodeApiInitialised']) {
      return;
    }

    await initServices({
      serviceConfig: {
        userServices: {},
        workspaceConfig: {
          workspaceProvider: {
            workspace: { folderUri: monaco.Uri.parse(PLAYGROUND_WORKSPACE_URI) },
            trusted: true,
            open: async () => true,
          },
        },
        debugLogging: isDevMode(),
      },
      caller: 'liquid-playground',
    });
  }

  /**
   * Registers the `liquid` language with Monaco:
   * brackets, auto-close pairs, and a Monarch syntax tokeniser.
   */
  registerLiquidLanguage(): void {
    monaco.languages.register({ id: 'liquid', extensions: ['.liquid'] });
    monaco.languages.setLanguageConfiguration('liquid', this.buildLanguageConfig());
    monaco.languages.setMonarchTokensProvider('liquid', this.buildTokensProvider());
  }

  // ─── Private builders ───────────────────────────────────────────────────────

  private buildLanguageConfig(): monaco.languages.LanguageConfiguration {
    return {
      comments: { blockComment: ['{% comment %}', '{% endcomment %}'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '{%', close: ' %}' },
        { open: '{{', close: ' }}' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '{%', close: '%}' },
        { open: '{{', close: '}}' },
      ],
    };
  }

  private buildTokensProvider(): monaco.languages.IMonarchLanguage {
    return {
      defaultToken: '',
      tokenPostfix: '.liquid',
      keywords: [
        'if', 'else', 'elsif', 'endif', 'unless', 'endunless',
        'case', 'when', 'endcase', 'for', 'endfor', 'in', 'reversed',
        'tablerow', 'endtablerow', 'assign', 'assignVar', 'parseAssign',
        'capture', 'endcapture', 'increment', 'decrement', 'comment', 'endcomment',
        'raw', 'endraw', 'computeColumn',
      ],
      operators: ['==', '!=', '<', '>', '<=', '>=', 'contains'],
      tokenizer: {
        root: [
          [/\{%\s*comment\s*%}/, { token: 'comment', next: '@comment' }],
          [/\{#/, { token: 'comment', next: '@commentHash' }],
          [/\{%/, { token: 'delimiter.tag', next: '@tag' }],
          [/\{\{/, { token: 'delimiter.output', next: '@output' }],
          [/./, ''],
        ],
        comment: [
          [/\{%\s*endcomment\s*%}/, { token: 'comment', next: '@pop' }],
          [/./, 'comment'],
        ],
        commentHash: [
          [/#}/, { token: 'comment', next: '@pop' }],
          [/./, 'comment'],
        ],
        tag: [
          [/%}/, { token: 'delimiter.tag', next: '@pop' }],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/[\w-]+/, { cases: { '@keywords': 'keyword', '@operators': 'operator', '@default': 'identifier' } }],
          [/[{}()[\]]/, 'delimiter'],
          [/[:|]/, 'operator'],
          [/[ \t\r\n]+/, ''],
        ],
        output: [
          [/}}/, { token: 'delimiter.output', next: '@pop' }],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/[\w-]+/, { cases: { '@operators': 'operator', '@default': 'identifier' } }],
          [/[:|]/, 'operator'],
          [/[ \t\r\n]+/, ''],
        ],
      },
    };
  }
}
