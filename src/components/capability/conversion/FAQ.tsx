import { Container } from '../core/Container';
import { Heading } from '../core/Heading';
import { Card } from '../core/Card';
import { Text } from '../core/Text';

export type FAQItem = {
  question: string;
  answer: string;
};

export type FAQProps = {
  title?: string;
  items: FAQItem[];
};

/** Accessible FAQ list using native <details>/<summary> — no JS state, keyboard-operable by default. */
export function FAQ({ title = 'Frequently asked questions', items }: FAQProps) {
  return (
    <Container width="default">
      <Heading level={2} className="mb-8">
        {title}
      </Heading>
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <Card key={item.question}>
            <details>
              <summary className="cursor-pointer list-none sc-display text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
                {item.question}
              </summary>
              <Text tone="muted" className="mt-3">
                {item.answer}
              </Text>
            </details>
          </Card>
        ))}
      </div>
    </Container>
  );
}
