import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

describe('shared primary action styling', () => {
  it('emits visible background and text utilities for primary actions', async () => {
    const globalsPath = path.resolve(process.cwd(), 'src/app/globals.css');
    const globals = fs.readFileSync(globalsPath, 'utf8');
    const input = `${globals}\n@source inline("bg-primary text-primary hover:bg-primary/90");`;

    const result = await postcss([tailwindcss()]).process(input, {
      from: globalsPath,
    });

    expect(result.css).toContain('.bg-primary {');
    expect(result.css).toContain('.text-primary {');
    expect(result.css).toContain('.hover\\:bg-primary\\/90 {');
  });
});
