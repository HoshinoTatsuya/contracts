import { FINDING_CODE } from '../constants/finding-code.constant';
import type { Finding } from '../types/finding.type';
import type { Shape } from '../types/shape.type';
import { validateAgainstShape } from './validate-against-shape';

/** Образцы писателя, которых читатель не примет, — по нарушению на отклонение. */
export function checkExamples(
  examples: readonly unknown[],
  reader: Shape,
  options: { readonly contract: string; readonly direction: string },
): Finding[] {
  return examples.flatMap((example, index) =>
    validateAgainstShape(example, reader).map((issue) => ({
      contract: options.contract,
      code: FINDING_CODE.exampleRejected,
      path: issue.path,
      message: `${options.direction}: образец #${index + 1} писателя читатель не примет — ${issue.path === '' ? 'корень' : `«${issue.path}»`}: ${issue.message}`,
    })),
  );
}
