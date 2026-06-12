const lexical = require('./lexical.js')
const TokenizationError = require('./util/error.js').TokenizationError
const _ = require('./util/underscore.js')
const whiteSpaceCtrl = require('./whitespace-ctrl.js')
const assert = require('./util/assert.js')

class Token {
  constructor(type, raw, value, line, begin, end) {
    this.type = type;
    this.kind = type === 'tag' ? 4 : (type === 'value' ? 8 : 16); // 4 = Tag, 8 = Output, 16 = HTML
    this.raw = raw;
    this.value = value;
    this.line = line;
    this.begin = begin;
    this.end = end;
  }
  getText() {
    return this.raw;
  }
}

class TagToken extends Token {
  constructor(raw, value, line, begin, end, name, args, indent, trim_left, trim_right, input, file) {
    super('tag', raw, value, line, begin, end);
    this.name = name;
    this.args = args;
    this.indent = indent;
    this.trim_left = trim_left;
    this.trim_right = trim_right;
    this.input = input;
    this.file = file;
  }
}

function parse (input, file, options) {
  assert(_.isString(input), 'illegal input')

  var rLiquid = /({%-?([\s\S]*?)-?%})|({{-?([\s\S]*?)-?}})/g
  var currIndent = 0
  var lineNumber = LineNumber(input)
  var lastMatchEnd = 0
  var tokens = []

  for (var match; (match = rLiquid.exec(input)); lastMatchEnd = rLiquid.lastIndex) {
    if (match.index > lastMatchEnd) {
      tokens.push(parseHTMLToken(lastMatchEnd, match.index))
    }
    tokens.push(match[1]
      ? parseTagToken(match[1], match[2].trim(), match.index)
      : parseValueToken(match[3], match[4].trim(), match.index))
  }
  if (input.length > lastMatchEnd) {
    tokens.push(parseHTMLToken(lastMatchEnd, input.length))
  }
  whiteSpaceCtrl(tokens, options)
  return tokens

  function parseTagToken (raw, value, pos) {
    var match = value.match(lexical.tagLine)
    if (!match) {
      var errToken = new Token('tag', raw, value, lineNumber.get(pos), pos, pos + raw.length);
      errToken.input = input;
      errToken.file = file;
      throw new TokenizationError(`illegal tag syntax`, errToken)
    }
    var name = match[1];
    var args = match[2];
    return new TagToken(
      raw,
      value,
      lineNumber.get(pos),
      pos,
      pos + raw.length,
      name,
      args,
      currIndent,
      raw.slice(0, 3) === '{%-',
      raw.slice(-3) === '-%}',
      input,
      file
    );
  }

  function parseValueToken (raw, value, pos) {
    var token = new Token(
      'value',
      raw,
      value,
      lineNumber.get(pos),
      pos,
      pos + raw.length
    );
    token.trim_left = raw.slice(0, 3) === '{{-';
    token.trim_right = raw.slice(-3) === '-}}';
    token.input = input;
    token.file = file;
    return token;
  }

  function parseHTMLToken (begin, end) {
    var htmlFragment = input.slice(begin, end)
    currIndent = _.last((htmlFragment).split('\n')).length

    var token = new Token(
      'html',
      htmlFragment,
      htmlFragment,
      lineNumber.get(begin),
      begin,
      end
    );
    token.input = input;
    token.file = file;
    return token;
  }
}

function LineNumber (html) {
  return {
    get: function (pos) {
      return html.slice(0, pos).split('\n').length
    }
  }
}

exports.parse = parse
exports.whiteSpaceCtrl = whiteSpaceCtrl
exports.Token = Token
exports.TagToken = TagToken
