import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import DateRangePicker, {
  TimePeriod,
} from '@/components/analytics/shared/DateRangePicker';

describe('DateRangePicker', () => {
  const mockOnPeriodChange = jest.fn();
  const mockOnCustomDateClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering - Default Mode', () => {
    it('should render all period options as buttons', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('This Week')).toBeInTheDocument();
      expect(screen.getByText('This Month')).toBeInTheDocument();
      expect(screen.getByText('This Quarter')).toBeInTheDocument();
      expect(screen.getByText('This Year')).toBeInTheDocument();
      expect(screen.getByText('Custom Range')).toBeInTheDocument();
    });

    it('should render period descriptions', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
      expect(screen.getByText('Last 7 days')).toBeInTheDocument();
      expect(screen.getByText('Last 30 days')).toBeInTheDocument();
      expect(screen.getByText('Last 90 days')).toBeInTheDocument();
      expect(screen.getByText('Last 365 days')).toBeInTheDocument();
      expect(screen.getByText('Pick dates')).toBeInTheDocument();
    });

    it('should render calendar icon', () => {
      const { container } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const calendarIcon = container.querySelector('svg');
      expect(calendarIcon).toBeInTheDocument();
    });

    it('should render "Period:" label', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      expect(screen.getByText('Period:')).toBeInTheDocument();
    });

    it('should highlight selected period button', () => {
      const { container } = render(
        <DateRangePicker
          period="week"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const weekButton = screen.getByText('This Week').closest('button');
      const monthButton = screen.getByText('This Month').closest('button');

      // Selected button should have different styling (we'll check classes)
      expect(weekButton).toBeInTheDocument();
      expect(monthButton).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          className="custom-date-picker"
        />
      );

      expect(container.firstChild).toHaveClass('custom-date-picker');
    });
  });

  describe('Rendering - Compact Mode', () => {
    it('should render as Select component when compact=true', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact
        />
      );

      // Should not render buttons in compact mode
      const buttons = screen.queryAllByRole('button');
      // Only the trigger button should be present
      expect(buttons.length).toBeLessThanOrEqual(1);
    });

    it('should render calendar icon in compact mode', () => {
      const { container } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact
        />
      );

      const calendarIcon = container.querySelector('svg');
      expect(calendarIcon).toBeInTheDocument();
    });

    it('should not render "Period:" label in compact mode', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact
        />
      );

      expect(screen.queryByText('Period:')).not.toBeInTheDocument();
    });

    it('should not render descriptions in compact mode', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact
        />
      );

      expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument();
    });

    it('should apply custom className in compact mode', () => {
      const { container } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact
          className="w-64"
        />
      );

      // The select trigger should have the className
      const trigger = container.querySelector('button');
      expect(trigger).toHaveClass('w-64');
    });
  });

  describe('Period Selection - Default Mode', () => {
    it('should call onPeriodChange when day is selected', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const dayButton = screen.getByText('Today').closest('button');
      fireEvent.click(dayButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledWith('day');
      expect(mockOnPeriodChange).toHaveBeenCalledTimes(1);
    });

    it('should call onPeriodChange when week is selected', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const weekButton = screen.getByText('This Week').closest('button');
      fireEvent.click(weekButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledWith('week');
    });

    it('should call onPeriodChange when month is selected', () => {
      render(
        <DateRangePicker
          period="week"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const monthButton = screen.getByText('This Month').closest('button');
      fireEvent.click(monthButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledWith('month');
    });

    it('should call onPeriodChange when quarter is selected', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const quarterButton = screen.getByText('This Quarter').closest('button');
      fireEvent.click(quarterButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledWith('quarter');
    });

    it('should call onPeriodChange when year is selected', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const yearButton = screen.getByText('This Year').closest('button');
      fireEvent.click(yearButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledWith('year');
    });

    it('should allow selecting the same period multiple times', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const monthButton = screen.getByText('This Month').closest('button');
      fireEvent.click(monthButton!);
      fireEvent.click(monthButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledTimes(2);
    });
  });

  describe('Custom Date Handling', () => {
    it('should call onCustomDateClick when custom is selected with callback provided', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          onCustomDateClick={mockOnCustomDateClick}
        />
      );

      const customButton = screen.getByText('Custom Range').closest('button');
      fireEvent.click(customButton!);

      expect(mockOnCustomDateClick).toHaveBeenCalledTimes(1);
      expect(mockOnPeriodChange).not.toHaveBeenCalled();
    });

    it('should call onPeriodChange when custom is selected without onCustomDateClick', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const customButton = screen.getByText('Custom Range').closest('button');
      fireEvent.click(customButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledWith('custom');
      expect(mockOnCustomDateClick).not.toHaveBeenCalled();
    });

    it('should handle custom period as initial value', () => {
      render(
        <DateRangePicker
          period="custom"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const customButton = screen.getByText('Custom Range').closest('button');
      expect(customButton).toBeInTheDocument();
    });
  });

  describe('Period State Management', () => {
    it('should update visual state when period prop changes', () => {
      const { rerender } = render(
        <DateRangePicker
          period="week"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      rerender(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      // Month should now be selected
      expect(screen.getByText('This Month')).toBeInTheDocument();
    });

    it('should handle all valid TimePeriod values', () => {
      const periods: TimePeriod[] = ['day', 'week', 'month', 'quarter', 'year', 'custom'];

      periods.forEach((period) => {
        const { container, unmount } = render(
          <DateRangePicker
            period={period}
            onPeriodChange={mockOnPeriodChange}
          />
        );
        // Should render without errors
        expect(container.firstChild).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible buttons in default mode', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should be keyboard navigable', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const firstButton = screen.getByText('Today').closest('button');
      firstButton?.focus();

      expect(document.activeElement).toBe(firstButton);
    });

    it('should have proper button text for screen readers', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      // All buttons should have descriptive text
      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid clicks', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      const weekButton = screen.getByText('This Week').closest('button');
      fireEvent.click(weekButton!);
      fireEvent.click(weekButton!);
      fireEvent.click(weekButton!);

      expect(mockOnPeriodChange).toHaveBeenCalledTimes(3);
    });

    it('should handle switching between multiple periods quickly', () => {
      render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      fireEvent.click(screen.getByText('Today').closest('button')!);
      fireEvent.click(screen.getByText('This Week').closest('button')!);
      fireEvent.click(screen.getByText('This Month').closest('button')!);

      expect(mockOnPeriodChange).toHaveBeenCalledTimes(3);
      expect(mockOnPeriodChange).toHaveBeenNthCalledWith(1, 'day');
      expect(mockOnPeriodChange).toHaveBeenNthCalledWith(2, 'week');
      expect(mockOnPeriodChange).toHaveBeenNthCalledWith(3, 'month');
    });

    it('should not crash with undefined className', () => {
      const { container } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          className={undefined}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should not crash with empty className', () => {
      const { container } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          className=""
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with React state', () => {
      const TestComponent = () => {
        const [period, setPeriod] = React.useState<TimePeriod>('month');

        return (
          <div>
            <DateRangePicker
              period={period}
              onPeriodChange={setPeriod}
            />
            <div data-testid="current-period">{period}</div>
          </div>
        );
      };

      render(<TestComponent />);

      expect(screen.getByTestId('current-period')).toHaveTextContent('month');

      fireEvent.click(screen.getByText('This Week').closest('button')!);

      expect(screen.getByTestId('current-period')).toHaveTextContent('week');
    });

    it('should work with custom date modal trigger', () => {
      const TestComponent = () => {
        const [period, setPeriod] = React.useState<TimePeriod>('month');
        const [showModal, setShowModal] = React.useState(false);

        return (
          <div>
            <DateRangePicker
              period={period}
              onPeriodChange={setPeriod}
              onCustomDateClick={() => setShowModal(true)}
            />
            {showModal && <div data-testid="custom-modal">Custom Date Modal</div>}
          </div>
        );
      };

      render(<TestComponent />);

      expect(screen.queryByTestId('custom-modal')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Custom Range').closest('button')!);

      expect(screen.getByTestId('custom-modal')).toBeInTheDocument();
    });

    it('should work in both compact and default modes simultaneously', () => {
      const { container } = render(
        <div>
          <DateRangePicker
            period="month"
            onPeriodChange={mockOnPeriodChange}
            compact
            className="compact-picker"
          />
          <DateRangePicker
            period="week"
            onPeriodChange={mockOnPeriodChange}
            compact={false}
            className="default-picker"
          />
        </div>
      );

      // Both should render
      expect(container.querySelector('.compact-picker')).toBeInTheDocument();
      expect(container.querySelector('.default-picker')).toBeInTheDocument();
      // Check that we have both select (compact) and buttons (default)
      expect(container.querySelector('select')).toBeInTheDocument();
      expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when period prop changes externally', () => {
      const { rerender } = render(
        <DateRangePicker
          period="day"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      rerender(
        <DateRangePicker
          period="year"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      // Should reflect new period
      expect(screen.getByText('This Year')).toBeInTheDocument();
    });

    it('should update when compact mode changes', () => {
      const { rerender } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact={false}
        />
      );

      expect(screen.getByText('Last 30 days')).toBeInTheDocument();

      rerender(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          compact={true}
        />
      );

      expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument();
    });

    it('should update when onCustomDateClick is added', () => {
      const { rerender } = render(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
        />
      );

      fireEvent.click(screen.getByText('Custom Range').closest('button')!);
      expect(mockOnPeriodChange).toHaveBeenCalledWith('custom');

      jest.clearAllMocks();

      rerender(
        <DateRangePicker
          period="month"
          onPeriodChange={mockOnPeriodChange}
          onCustomDateClick={mockOnCustomDateClick}
        />
      );

      fireEvent.click(screen.getByText('Custom Range').closest('button')!);
      expect(mockOnCustomDateClick).toHaveBeenCalledTimes(1);
      expect(mockOnPeriodChange).not.toHaveBeenCalled();
    });
  });
});
