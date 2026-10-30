import { describe, expect, it } from 'vitest';
import { parseCurl } from '@/utils/curl-parser';
import { beautifyXmlText, findXmlSyntaxError, repairXmlText } from '@/utils/beautifyXml';

describe('XML request body support', () => {
  it('XML-BODY-001 formats nested XML while preserving declarations and variables', () => {
    const input = '<?xml version="1.0"?><root><name>{{NAME}}</name><item id="1"/></root>';

    expect(beautifyXmlText(input)).toBe([
      '<?xml version="1.0"?>',
      '<root>',
      '  <name>{{NAME}}</name>',
      '  <item id="1"/>',
      '</root>',
    ].join('\n'));
  });

  it('XML-BODY-002 preserves whitespace-sensitive content', () => {
    const mixed = '<message>Hello <strong>ApiKit</strong>!</message>';
    expect(beautifyXmlText(mixed)).toBe(mixed);

    const cdata = '<root><![CDATA[<raw>]]></root>';
    expect(beautifyXmlText(cdata)).toBe(cdata);

    const preservedWhitespace = '<value xml:space="preserve">   </value>';
    expect(beautifyXmlText(preservedWhitespace)).toBe(preservedWhitespace);

  });

  it('normalizes empty element whitespace using VS Code-style indentation', () => {
    const input = '<a>\n  <b>\n\n  </b>\n  <c>\n    <d>\n\n    </d>\n  </c>\n</a>';
    expect(beautifyXmlText(input)).toBe([
      '<a>',
      '  <b></b>',
      '  <c>',
      '    <d></d>',
      '  </c>',
      '</a>',
    ].join('\n'));
  });

  it.each([
    '<root attr=bad/>',
    '<root>&broken;</root>',
    '<root duplicate="one" duplicate="two"/>',
  ])('XML-BODY-003 rejects malformed XML: %s', invalidXml => {
    expect(() => beautifyXmlText(invalidXml)).toThrow(/Invalid XML/);
  });

  it.each([
    ['closes unclosed tags in nesting order', '<a><b>x', '<a><b>x</b></a>'],
    ['closes a tag left open before its parent closes', '<root><item></root>', '<root><item></item></root>'],
    ['completes a truncated attribute and tag', '<a id="1', '<a id="1"></a>'],
    ['completes a truncated tag before the next one', '<a><b id="1"<c/></a>', '<a><b id="1"><c/></b></a>'],
    ['completes a truncated closing tag', '<a>x</a', '<a>x</a>'],
    ['escapes bare & in text and attributes', '<a b="x & y">1 & 2 &amp; &#38; &lt;</a>', '<a b="x &amp; y">1 &amp; 2 &amp; &#38; &lt;</a>'],
    ['escapes bare < in text', '<a>1 < 2</a>', '<a>1 &lt; 2</a>'],
    ['closes an unterminated comment and CDATA', '<a><!-- note', '<a><!-- note--></a>'],
    ['leaves CDATA and comments alone', '<a><![CDATA[1 & 2 < 3]]><!-- a & b --></a>', '<a><![CDATA[1 & 2 < 3]]><!-- a & b --></a>'],
    ['keeps variables', '<a id="{{id}}">{{name}}', '<a id="{{id}}">{{name}}</a>'],
  ])('repairXmlText %s', (_name, input, expected) => {
    expect(repairXmlText(input)).toBe(expected);
  });

  it('Beautify completes truncated XML before formatting', () => {
    expect(beautifyXmlText('<root><item id="1">a & b')).toBe([
      '<root>',
      '  <item id="1">a &amp; b</item>',
      '</root>',
    ].join('\n'));
  });

  it.each([
    ['<a>x & y</a>', "Bare '&' must be escaped as &amp;", 1, 6],
    ['<a b="x & y"/>', "Bare '&' must be escaped as &amp;", 1, 9],
    ['<a b="<"/>', "'<' in an attribute value must be escaped as &lt;", 1, 7],
    ['<a>\n  &nope;\n</a>', 'Undeclared entity &nope;', 2, 3],
  ])('findXmlSyntaxError locates %s', (xml, message, line, column) => {
    expect(findXmlSyntaxError(xml)).toEqual({ message, line, column });
  });

  it('findXmlSyntaxError accepts valid XML', () => {
    expect(findXmlSyntaxError('<a b="1 &amp; 2"><![CDATA[x & y]]></a>')).toBeNull();
  });

  it('accepts built-in and declared XML entities', () => {
    expect(beautifyXmlText('<root>&amp;</root>')).toBe('<root>&amp;</root>');
    const declared = '<!DOCTYPE root [<!ENTITY company "ApiKit">]><root>&company;</root>';
    expect(beautifyXmlText(declared)).toContain('&company;');
    expect(beautifyXmlText('<root><![CDATA[&not-an-entity;]]></root>'))
      .toBe('<root><![CDATA[&not-an-entity;]]></root>');
  });

  it('XML-BODY-004 recognizes XML when importing cURL', () => {
    const byHeader = parseCurl("curl -X POST -H 'Content-Type: application/soap+xml' -d '<Envelope><Body/></Envelope>' https://example.com");
    expect(byHeader.body.type).toBe('xml');
    expect(byHeader.body.raw).toBe('<Envelope><Body/></Envelope>');

    const byContent = parseCurl("curl -X POST -d '<?xml version=\"1.0\"?><root/>' https://example.com");
    expect(byContent.body.type).toBe('xml');
  });
});
