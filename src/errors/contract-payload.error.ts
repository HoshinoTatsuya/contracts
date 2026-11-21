import type { PayloadIssue } from '../types/payload-issue.type';

/**
 * Payload не прошёл схему контракта: нет обязательного поля, не тот тип,
 * строгий объект получил лишнее, схема бросила исключение на этом payload
 * (тогда исключение — в `cause`). Каждое отклонение — с путём к полю.
 */
export class ContractPayloadError extends Error {
  public override readonly name = 'ContractPayloadError';

  public constructor(
    public readonly contract: string,
    public readonly issues: readonly PayloadIssue[],
    options: { readonly cause?: unknown } = {},
  ) {
    super(
      `${contract}: payload не соответствует контракту: ${issues
        .map((issue) => `${issue.path === '' ? '(корень)' : issue.path} — ${issue.message}`)
        .join('; ')}`,
      'cause' in options ? { cause: options.cause } : undefined,
    );
  }
}
