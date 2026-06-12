declare module 'liquidjs' {
  export enum TokenKind {
    HTML = 16,
    Output = 8,
    Tag = 4
  }

  export class Token {
    type: string;
    kind: TokenKind;
    raw: string;
    value: string;
    line: number;
    begin: number;
    end: number;
    constructor(type: string, raw: string, value: string, line: number, begin: number, end: number);
    getText(): string;
  }

  export class TagToken extends Token {
    name: string;
    args: string;
    constructor(raw: string, value: string, line: number, begin: number, end: number, name: string, args: string);
  }

  export class Tokenizer {
    text: string;
    options: any;
    constructor(text: string, options?: any);
    readTopLevelTokens(): Token[];
  }

  export interface LiquidOptions {
    root?: string[];
    cache?: boolean;
    extname?: string;
    dynamicPartials?: boolean;
    trim_tag_right?: boolean;
    trim_tag_left?: boolean;
    trim_value_right?: boolean;
    trim_value_left?: boolean;
    greedy?: boolean;
    strict_filters?: boolean;
    strict_variables?: boolean;
  }

  export interface Liquid {
    options: LiquidOptions;
    parse(html: string, filepath?: string): any[];
    render(tpl: any[], ctx?: any, opts?: any): Promise<string>;
    parseAndRender(html: string, ctx?: any, opts?: any): Promise<string>;
    evalValue(str: string, scope?: any): any;
    registerFilter(name: string, filter: Function): void;
    registerTag(name: string, tag: any): void;
    checkValidJSON(expression: string): any[];
  }

  export interface LiquidFactory {
    (options?: LiquidOptions): Liquid;
    Liquid: new (options?: LiquidOptions) => Liquid;
    Tokenizer: typeof Tokenizer;
    Token: typeof Token;
    TagToken: typeof TagToken;
    TokenKind: typeof TokenKind;
  }

  const factory: LiquidFactory;
  export default factory;
}
