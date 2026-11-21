/**
 * Поколение формата по тегу документа: `contracts-snapshot/2` → 2, если база
 * тега (`contracts-snapshot`) та же, что у `canonical`. Документы, записанные
 * до 0.4.0, несут тот же тег с префиксом пространства имён
 * (`<scope>-contracts-snapshot/2`): формат у них тот же, и они читаются.
 * Чужая база, не строка, пустой или неверный префикс — `undefined`.
 */
export function formatGeneration(format: unknown, canonical: string): number | undefined {
  if (typeof format !== 'string') {
    return undefined;
  }
  const base = canonical.slice(0, canonical.lastIndexOf('/'));
  const slash = format.lastIndexOf('/');
  const tag = format.slice(0, slash);
  const generation = format.slice(slash + 1);
  if (slash < 0 || !/^[1-9][0-9]{0,5}$/.test(generation)) {
    return undefined;
  }
  const scoped =
    tag.endsWith(`-${base}`) &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(tag.slice(0, tag.length - base.length - 1));
  return tag === base || scoped ? Number(generation) : undefined;
}
