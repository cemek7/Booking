const fs = require('fs');

describe('Techclave Gate workflow trust boundary', () => {
  const readWorkflow = () => fs.readFileSync('.github/workflows/techclave-gate.yml', 'utf8');

  it('uses a trusted base checkout for pull requests to release branches', () => {
    const workflow = readWorkflow();
    expect(workflow).toContain('pull_request_target:');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(workflow).toContain('branches: [staging, main]');
  });

  it('does not install dependencies or execute PR code', () => {
    const workflow = readWorkflow();
    expect(workflow).not.toMatch(/npm (ci|install|test)/);
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pull-requests: read');
    expect(workflow).toContain('checks: write');
  });
});
