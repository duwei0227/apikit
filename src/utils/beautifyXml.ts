import { XMLValidator } from 'fast-xml-parser';
import xmlFormat from 'xml-formatter';

const validateEntityReferences = (xml: string) => {
  const knownEntities = new Set(['amp', 'apos', 'gt', 'lt', 'quot']);
  for (const match of xml.matchAll(/<!ENTITY\s+([A-Za-z_:][\w:.-]*)\s+/g)) {
    knownEntities.add(match[1]);
  }

  const entityAwareContent = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
  for (const match of entityAwareContent.matchAll(/&([A-Za-z_:][\w:.-]*);/g)) {
    if (!knownEntities.has(match[1])) {
      throw new Error(`Invalid XML: undeclared entity &${match[1]};`);
    }
  }
};

export const beautifyXmlText = (xml: string): string => {
  const source = String(xml || '').trim();
  if (!source) throw new Error('No valid XML content found to beautify');

  const validation = XMLValidator.validate(source, { allowBooleanAttributes: false });
  if (validation !== true) {
    throw new Error(`Invalid XML: ${validation.err.msg} (line ${validation.err.line}, column ${validation.err.col})`);
  }
  validateEntityReferences(source);

  return xmlFormat(source, {
    indentation: '  ',
    lineSeparator: '\n',
    collapseContent: true,
    throwOnFailure: true,
    strictMode: true,
  });
};
