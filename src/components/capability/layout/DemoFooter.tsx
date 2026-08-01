import { Container } from '../core/Container';
import { Disclaimer } from '../content/Disclaimer';

export type DemoFooterProps = {
  name: string;
  /** Current year rendered in the copyright line; pass explicitly for deterministic tests. */
  year?: number;
};

/** Page-bottom chrome: the demonstrator name and the required disclosure notice. */
export function DemoFooter({ name, year = new Date().getFullYear() }: DemoFooterProps) {
  return (
    <footer className="sc-surface border-t border-current/10 py-10">
      <Container width="wide" className="flex flex-col gap-4">
        <p className="sc-body text-sm opacity-80">
          © {year} {name}
        </p>
        <Disclaimer />
      </Container>
    </footer>
  );
}
