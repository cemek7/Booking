type TraceEntry = {
  method: string;
  url: string;
  statusCode?: number;
  hasAuthorization: boolean;
};

describe('Booka public page API trace', () => {
  it('captures API calls made by the public /booka page', () => {
    const traces: TraceEntry[] = [];

    cy.intercept('/api/**', (req) => {
      req.continue((res) => {
        traces.push({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          hasAuthorization: Boolean(req.headers.authorization),
        });
      });
    });

    cy.visit('/booka');
    cy.contains('Booka').should('be.visible');
    cy.contains('Start managed onboarding').should('be.visible');

    cy.wait(2500);

    cy.then(() => {
      cy.writeFile('cypress/artifacts/public-booka-trace.json', traces, { log: false });
      const failing = traces.filter((entry) => (entry.statusCode ?? 0) >= 400);
      if (failing.length > 0) {
        console.log('Failing API calls:', JSON.stringify(failing, null, 2));
      }
    });
  });
});
