describe('SIAS ops route protection', () => {
  it('rejects unauthenticated access and keeps the sign-in page available', () => {
    cy.request({
      url: '/dashboard/ops',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(401);
    });

    cy.visit('/auth/signin');
    cy.contains('Welcome back').should('be.visible');
    cy.contains('Send magic link').should('be.visible');
  });
});
