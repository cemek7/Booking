/**
 * Phase 6: Component Testing Framework
 * Type-safe component testing utilities with enhanced React Testing Library integration
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders, TestDataFactory, TestUser } from './testUtils';
import type { BookingEvent } from '@/components/Calendar';

// Component test configuration
export interface ComponentTestConfig {
  user?: TestUser;
  props?: Record<string, unknown>;
  queries?: Record<string, unknown>;
  mocks?: Record<string, jest.MockedFunction<any>>;
}

// Form testing utilities
export class FormTestUtils {
  /**
   * Fill form fields with type-safe values
   */
  static async fillForm(
    fields: Record<string, string | number | boolean>,
    user = userEvent.setup()
  ): Promise<void> {
    for (const [fieldName, value] of Object.entries(fields)) {
      const field = screen.getByLabelText(new RegExp(fieldName, 'i'));
      
      if (typeof value === 'string') {
        await user.clear(field);
        await user.type(field, value);
      } else if (typeof value === 'boolean') {
        if (value && !field.checked) {
          await user.click(field);
        } else if (!value && field.checked) {
          await user.click(field);
        }
      }
    }
  }

  /**
   * Submit form and wait for completion
   */
  static async submitForm(
    submitButtonText: string | RegExp = /submit/i,
    user = userEvent.setup()
  ): Promise<void> {
    const submitButton = screen.getByRole('button', { name: submitButtonText });
    await user.click(submitButton);
  }

  /**
   * Validate form errors are displayed
   */
  static expectFormErrors(errors: string[]): void {
    errors.forEach(error => {
      expect(screen.getByText(new RegExp(error, 'i'))).toBeInTheDocument();
    });
  }

  /**
   * Test complete form workflow
   */
  static async testFormWorkflow<T>(config: {
    component: React.ComponentType<any>;
    props?: Record<string, unknown>;
    formData: Record<string, string | number | boolean>;
    submitButtonText?: string | RegExp;
    onSubmit?: jest.MockedFunction<any>;
    expectedErrors?: string[];
    validationFn?: (result: T) => void;
  }): Promise<void> {
    const { 
      component: Component, 
      props = {}, 
      formData, 
      submitButtonText, 
      onSubmit,
      expectedErrors,
      validationFn 
    } = config;

    const { user } = renderWithProviders(<Component {...props} />);

    // Fill form
    await this.fillForm(formData, user);

    // Submit form
    await this.submitForm(submitButtonText, user);

    // Check for errors or success
    if (expectedErrors) {
      this.expectFormErrors(expectedErrors);
    } else if (onSubmit) {
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      
      if (validationFn && onSubmit.mock.calls[0]) {
        validationFn(onSubmit.mock.calls[0][0]);
      }
    }
  }
}

// Calendar component testing
export class CalendarTestUtils {
  /**
   * Test calendar event interactions
   */
  static async testEventInteraction(
    events: BookingEvent[],
    eventId: string,
    action: 'click' | 'drag' | 'resize'
  ): Promise<void> {
    const event = events.find(e => e.id === eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    const eventElement = screen.getByTestId(`booking-event-${eventId}`);
    expect(eventElement).toBeInTheDocument();

    switch (action) {
      case 'click':
        fireEvent.click(eventElement);
        break;
      case 'drag':
        fireEvent.dragStart(eventElement);
        fireEvent.dragEnd(eventElement);
        break;
      case 'resize':
        const resizeHandle = within(eventElement).getByTestId('resize-handle');
        fireEvent.mouseDown(resizeHandle);
        fireEvent.mouseUp(resizeHandle);
        break;
    }
  }

  /**
   * Test calendar view switching
   */
  static async testViewSwitching(
    views: Array<'month' | 'week' | 'day'>,
    user = userEvent.setup()
  ): Promise<void> {
    for (const view of views) {
      const viewButton = screen.getByRole('button', { name: new RegExp(view, 'i') });
      await user.click(viewButton);
      
      // Verify view is active
      expect(viewButton).toHaveClass('active');
    }
  }

  /**
   * Create mock calendar events
   */
  static createMockEvents(count: number, overrides: Partial<BookingEvent> = {}): BookingEvent[] {
    return Array.from({ length: count }, (_, index) => {
      const start = new Date();
      start.setHours(9 + index, 0, 0, 0);
      const end = new Date(start);
      end.setHours(start.getHours() + 1);

      return {
        id: `event-${index}`,
        start: start.toISOString(),
        end: end.toISOString(),
        status: 'confirmed' as const,
        serviceId: `service-${index}`,
        customer: {
          id: `customer-${index}`,
          name: `Customer ${index}`,
          phone: `+1234567890${index}`,
          email: `customer${index}@example.com`
        },
        ...overrides
      };
    });
  }
}

// Data table testing utilities
export class DataTableTestUtils {
  /**
   * Test table sorting functionality
   */
  static async testTableSorting(
    columnHeader: string,
    expectedOrder: 'asc' | 'desc',
    user = userEvent.setup()
  ): Promise<void> {
    const header = screen.getByRole('columnheader', { name: new RegExp(columnHeader, 'i') });
    await user.click(header);

    // Verify sort indicator
    const sortIcon = within(header).getByTestId(`sort-${expectedOrder}`);
    expect(sortIcon).toBeInTheDocument();
  }

  /**
   * Test table filtering
   */
  static async testTableFiltering(
    filterValue: string,
    expectedRowCount: number,
    user = userEvent.setup()
  ): Promise<void> {
    const searchInput = screen.getByPlaceholderText(/search|filter/i);
    await user.clear(searchInput);
    await user.type(searchInput, filterValue);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // Subtract 1 for header row
      expect(rows.length - 1).toBe(expectedRowCount);
    });
  }

  /**
   * Test table pagination
   */
  static async testTablePagination(
    page: number,
    user = userEvent.setup()
  ): Promise<void> {
    const pageButton = screen.getByRole('button', { name: page.toString() });
    await user.click(pageButton);

    // Verify active page
    expect(pageButton).toHaveClass('active');
  }

  /**
   * Test row actions (edit, delete, etc.)
   */
  static async testRowAction(
    rowIndex: number,
    action: 'edit' | 'delete' | 'view',
    user = userEvent.setup()
  ): Promise<void> {
    const rows = screen.getAllByRole('row');
    const targetRow = rows[rowIndex + 1]; // +1 for header row
    
    const actionButton = within(targetRow).getByRole('button', { 
      name: new RegExp(action, 'i') 
    });
    await user.click(actionButton);
  }
}

// Modal and dialog testing utilities
export class ModalTestUtils {
  /**
   * Test modal opening and closing
   */
  static async testModalLifecycle(
    openTrigger: string | RegExp,
    modalTitle: string | RegExp,
    closeTrigger: string | RegExp = /close|cancel/i,
    user = userEvent.setup()
  ): Promise<void> {
    // Open modal
    const openButton = screen.getByRole('button', { name: openTrigger });
    await user.click(openButton);

    // Verify modal is open
    const modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
    expect(screen.getByText(modalTitle)).toBeInTheDocument();

    // Close modal
    const closeButton = screen.getByRole('button', { name: closeTrigger });
    await user.click(closeButton);

    // Verify modal is closed
    await waitFor(() => {
      expect(modal).not.toBeInTheDocument();
    });
  }

  /**
   * Test confirmation dialog
   */
  static async testConfirmationDialog(
    triggerAction: () => Promise<void>,
    confirmText: string | RegExp = /confirm|yes|ok/i,
    user = userEvent.setup()
  ): Promise<void> {
    await triggerAction();

    // Verify confirmation dialog
    const confirmDialog = screen.getByRole('dialog');
    expect(confirmDialog).toBeInTheDocument();

    // Confirm action
    const confirmButton = within(confirmDialog).getByRole('button', { name: confirmText });
    await user.click(confirmButton);

    // Verify dialog is closed
    await waitFor(() => {
      expect(confirmDialog).not.toBeInTheDocument();
    });
  }
}

// Analytics dashboard testing utilities
export class AnalyticsTestUtils {
  /**
   * Test analytics data loading
   */
  static async testAnalyticsDataLoading(
    componentName: string,
    expectedMetrics: string[]
  ): Promise<void> {
    // Wait for loading state to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Verify metrics are displayed
    expectedMetrics.forEach(metric => {
      expect(screen.getByText(new RegExp(metric, 'i'))).toBeInTheDocument();
    });
  }

  /**
   * Test analytics period switching
   */
  static async testPeriodSwitching(
    periods: Array<'day' | 'week' | 'month' | 'quarter'>,
    user = userEvent.setup()
  ): Promise<void> {
    for (const period of periods) {
      const periodButton = screen.getByRole('button', { name: new RegExp(period, 'i') });
      await user.click(periodButton);

      // Wait for data to reload
      await waitFor(() => {
        expect(periodButton).toHaveClass('active');
      });
    }
  }

  /**
   * Create mock analytics data
   */
  static createMockAnalyticsData() {
    return {
      metrics: [
        { id: 'bookings', name: 'Total Bookings', value: 150, trend: 12.5 },
        { id: 'revenue', name: 'Revenue', value: 15000, trend: -2.3 },
        { id: 'customers', name: 'Active Customers', value: 85, trend: 8.7 }
      ],
      trends: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        bookings: Math.floor(Math.random() * 20) + 5,
        revenue: Math.floor(Math.random() * 2000) + 500
      }))
    };
  }
}

// Performance testing for components
export class ComponentPerformanceUtils {
  /**
   * Test component render performance
   */
  static async testRenderPerformance<P>(
    Component: React.ComponentType<P>,
    props: P,
    threshold: number = 100
  ): Promise<number> {
    const start = performance.now();
    renderWithProviders(React.createElement(Component, props));
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(threshold);
    return duration;
  }

  /**
   * Test component re-render performance
   */
  static async testReRenderPerformance<P>(
    Component: React.ComponentType<P>,
    initialProps: P,
    updatedProps: P,
    threshold: number = 50
  ): Promise<{ initialRender: number; reRender: number }> {
    const start1 = performance.now();
    const { rerender } = renderWithProviders(React.createElement(Component, initialProps));
    const initialRender = performance.now() - start1;

    const start2 = performance.now();
    rerender(React.createElement(Component, updatedProps));
    const reRender = performance.now() - start2;

    expect(reRender).toBeLessThan(threshold);
    return { initialRender, reRender };
  }
}

// Accessibility testing utilities
export class AccessibilityTestUtils {
  /**
   * Test keyboard navigation
   */
  static async testKeyboardNavigation(
    elements: Array<{ selector: string; key: string }>,
    user = userEvent.setup()
  ): Promise<void> {
    for (const { selector, key } of elements) {
      const element = screen.getByTestId(selector);
      element.focus();
      await user.keyboard(`{${key}}`);
      
      // Verify focus moved or action occurred
      expect(element).toHaveAttribute('tabindex');
    }
  }

  /**
   * Test ARIA attributes
   */
  static testAriaAttributes(
    element: HTMLElement,
    expectedAttributes: Record<string, string>
  ): void {
    Object.entries(expectedAttributes).forEach(([attr, value]) => {
      expect(element).toHaveAttribute(attr, value);
    });
  }

  /**
   * Test screen reader compatibility
   */
  static testScreenReaderSupport(
    component: React.ReactElement,
    expectedLabels: string[]
  ): void {
    renderWithProviders(component);

    expectedLabels.forEach(label => {
      expect(screen.getByLabelText(new RegExp(label, 'i'))).toBeInTheDocument();
    });
  }
}

// Error boundary testing
export class ErrorBoundaryTestUtils {
  /**
   * Test component error handling
   */
  static async testErrorBoundary(
    ComponentWithError: React.ComponentType,
    ErrorBoundary: React.ComponentType<{ children: React.ReactNode }>
  ): Promise<void> {
    // Suppress console.error for this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(
      React.createElement(ErrorBoundary, {}, React.createElement(ComponentWithError))
    );

    // Verify error boundary caught the error
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    consoleSpy.mockRestore();
  }
}

// Export all utilities
export {
  FormTestUtils,
  CalendarTestUtils,
  DataTableTestUtils,
  ModalTestUtils,
  AnalyticsTestUtils,
  ComponentPerformanceUtils,
  AccessibilityTestUtils,
  ErrorBoundaryTestUtils
};