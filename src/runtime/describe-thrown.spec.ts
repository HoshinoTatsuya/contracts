import { describeThrown } from './describe-thrown';

const messageGetterThrows = (): Error =>
  Object.defineProperty(new Error('исходное'), 'message', {
    get: () => {
      throw new Error('геттер message');
    },
  });

/**
 * Текст брошенного значения для отказа не бросает сам: `String()` на значении
 * без прототипа, с бросающим `toString` / `Symbol.toPrimitive` и чтение
 * бросающего геттера `message` бросают TypeError — в ветке, которая разбирает
 * отказ, исходная причина подменилась бы им.
 */
describe('describeThrown', () => {
  it.each([
    ['без прототипа', (): unknown => Object.create(null), '[object Object]'],
    [
      'с бросающим toString',
      (): unknown => ({
        toString: () => {
          throw new Error('toString');
        },
      }),
      '[object Object]',
    ],
    [
      'с бросающим Symbol.toPrimitive',
      (): unknown => ({
        [Symbol.toPrimitive]: () => {
          throw new Error('toPrimitive');
        },
      }),
      '[object Object]',
    ],
    ['ошибка с бросающим геттером message', messageGetterThrows, '[object Error]'],
    [
      'без прототипа, но со строкой message',
      (): unknown => Object.assign(Object.create(null) as object, { message: 'своё сообщение' }),
      'своё сообщение',
    ],
    [
      'отозванный Proxy (бросает даже тег объекта)',
      (): unknown => {
        const proxy = Proxy.revocable({}, {});
        proxy.revoke();
        return proxy.proxy;
      },
      '[значение без текста]',
    ],
  ])('%s — текст, а не TypeError', (_label, make, expected) => {
    expect(describeThrown(make())).toBe(expected);
    expect(describeThrown(make(), 'message')).toBe(expected);
  });

  it('обычная ошибка — «Имя: сообщение»; в форме message — только сообщение', () => {
    expect(describeThrown(new TypeError('сломано'))).toBe('TypeError: сломано');
    expect(describeThrown(new TypeError('сломано'), 'message')).toBe('сломано');
  });

  it('строка, undefined, null, число, символ — как String()', () => {
    expect(
      ['строка', undefined, null, 42, 10n, Symbol('метка')].map((value) => describeThrown(value)),
    ).toEqual(['строка', 'undefined', 'null', '42', '10', 'Symbol(метка)']);
  });
});
