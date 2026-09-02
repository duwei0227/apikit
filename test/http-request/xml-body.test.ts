import { describe, expect, it } from 'vitest';
import { parseCurl } from '@/utils/curl-parser';
import { beautifyXmlText } from '@/utils/beautifyXml';
import { findXmlTagPairAtCursor } from '@/utils/xmlEditing';

describe('XML request body support', () => {
  it('detects matching tags around the cursor for smart Enter indentation', () => {
    expect(findXmlTagPairAtCursor('<a></a>', 3)).toEqual({ fromCh: 3, toCh: 3 });
    expect(findXmlTagPairAtCursor('  <ns:item id="1">    </ns:item>', 20)).toEqual({
      fromCh: 18,
      toCh: 22,
    });
    expect(findXmlTagPairAtCursor('<a></b>', 3)).toBeNull();
    expect(findXmlTagPairAtCursor('<a/>', 4)).toBeNull();
  });

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
    '<root><item></root>',
    '<root attr=bad/>',
    '<root>&broken;</root>',
    '<root duplicate="one" duplicate="two"/>',
  ])('XML-BODY-003 rejects malformed XML: %s', invalidXml => {
    expect(() => beautifyXmlText(invalidXml)).toThrow(/Invalid XML/);
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
