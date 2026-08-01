import { Container } from '../core/Container';
import { Heading } from '../core/Heading';
import { Text } from '../core/Text';

export type ProcessStep = {
  title: string;
  description: string;
};

export type ProcessStepsProps = {
  title?: string;
  steps: ProcessStep[];
};

/** Numbered ordered-list of process stages (e.g. assessment → design → install). Semantic <ol> for a11y. */
export function ProcessSteps({ title = 'How it works', steps }: ProcessStepsProps) {
  return (
    <Container width="default">
      <Heading level={2} className="mb-10">
        {title}
      </Heading>
      <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2">
            <span className="sc-display text-sm font-semibold opacity-60" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="sc-display text-lg font-semibold">{step.title}</span>
            <Text tone="muted" size="sm">
              {step.description}
            </Text>
          </li>
        ))}
      </ol>
    </Container>
  );
}
