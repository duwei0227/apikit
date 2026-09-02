const XML_NAME = '[A-Za-z_][\\w:.-]*';

export interface XmlTagPairAtCursor {
  fromCh: number;
  toCh: number;
}

/**
 * Finds an XML opening/closing tag pair surrounding a cursor on one line.
 * Whitespace immediately around the cursor is included so Enter can replace it
 * with a clean indented blank line.
 */
export const findXmlTagPairAtCursor = (
  line: string,
  cursorCh: number
): XmlTagPairAtCursor | null => {
  const before = line.slice(0, cursorCh);
  const after = line.slice(cursorCh);
  const openingPattern = new RegExp(
    `<(${XML_NAME})(?:\\s+(?:"[^"]*"|'[^']*'|[^"'<>])*)?>\\s*$`
  );
  const closingPattern = new RegExp(`^(\\s*)<\\/(${XML_NAME})\\s*>`);
  const opening = before.match(openingPattern);
  const closing = after.match(closingPattern);

  if (!opening || !closing || opening[1] !== closing[2]) return null;

  const whitespaceBeforeCursor = opening[0].match(/\s*$/)?.[0].length ?? 0;
  return {
    fromCh: cursorCh - whitespaceBeforeCursor,
    toCh: cursorCh + closing[1].length,
  };
};
