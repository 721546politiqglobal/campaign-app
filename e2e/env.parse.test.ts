import { describe, it, expect } from 'vitest';
import { parseDotEnvText } from './env';

describe('parseDotEnvText (dotenv.parse semantics)', () => {
  it('handles export prefixes, leading whitespace, quotes, comments and CRLF', () => {
    const src = [
      'PLAIN=value',
      '  INDENTED=yes',
      'export EXPORTED=from-export',
      "SINGLE='single quoted # not a comment'",
      'DOUBLE="line1\\nline2"',
      'TRAILING=bare # trailing comment',
      '# COMMENTED=no',
      'EMPTY=',
      'WIN=crlf\r',
      'lower_case=ok',
    ].join('\n');
    expect(parseDotEnvText(src)).toEqual({
      PLAIN: 'value', INDENTED: 'yes', EXPORTED: 'from-export', SINGLE: 'single quoted # not a comment',
      DOUBLE: 'line1\nline2', TRAILING: 'bare', EMPTY: '', WIN: 'crlf', lower_case: 'ok',
    });
  });
});
