import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import StatsGrid from '@/components/analytics/shared/StatsGrid';

describe('StatsGrid', () => {
  describe('Rendering', () => {
    it('should render children', () => {
      const { getByText } = render(
        <StatsGrid>
          <div>Child 1</div>
          <div>Child 2</div>
        </StatsGrid>
      );

      expect(getByText('Child 1')).toBeInTheDocument();
      expect(getByText('Child 2')).toBeInTheDocument();
    });

    it('should render as grid container', () => {
      const { container } = render(
        <StatsGrid>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid');
    });

    it('should render with custom className', () => {
      const { container } = render(
        <StatsGrid className="custom-grid">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('custom-grid');
    });

    it('should render with no children', () => {
      const { container } = render(<StatsGrid />);
      expect(container.firstChild).toBeInTheDocument();
      expect(container.firstChild).toHaveClass('grid');
    });

    it('should render with single child', () => {
      const { getByText } = render(
        <StatsGrid>
          <div>Single Child</div>
        </StatsGrid>
      );

      expect(getByText('Single Child')).toBeInTheDocument();
    });

    it('should render with many children', () => {
      const { getByText } = render(
        <StatsGrid>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i}>Child {i}</div>
          ))}
        </StatsGrid>
      );

      expect(getByText('Child 0')).toBeInTheDocument();
      expect(getByText('Child 9')).toBeInTheDocument();
    });
  });

  describe('Column Configuration', () => {
    it('should default to 4 columns', () => {
      const { container } = render(
        <StatsGrid>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).toHaveClass('lg:grid-cols-4');
    });

    it('should support 1 column layout', () => {
      const { container } = render(
        <StatsGrid columns={1}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).not.toHaveClass('md:grid-cols-2');
      expect(container.firstChild).not.toHaveClass('lg:grid-cols-4');
    });

    it('should support 2 column layout', () => {
      const { container } = render(
        <StatsGrid columns={2}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).not.toHaveClass('lg:grid-cols-3');
      expect(container.firstChild).not.toHaveClass('lg:grid-cols-4');
    });

    it('should support 3 column layout', () => {
      const { container } = render(
        <StatsGrid columns={3}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).toHaveClass('lg:grid-cols-3');
    });

    it('should support 4 column layout', () => {
      const { container } = render(
        <StatsGrid columns={4}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).toHaveClass('lg:grid-cols-4');
    });
  });

  describe('Gap Configuration', () => {
    it('should default to medium gap', () => {
      const { container } = render(
        <StatsGrid>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('gap-4');
    });

    it('should support small gap', () => {
      const { container } = render(
        <StatsGrid gap="sm">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('gap-3');
      expect(container.firstChild).not.toHaveClass('gap-4');
    });

    it('should support medium gap', () => {
      const { container } = render(
        <StatsGrid gap="md">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('gap-4');
    });

    it('should support large gap', () => {
      const { container } = render(
        <StatsGrid gap="lg">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('gap-6');
      expect(container.firstChild).not.toHaveClass('gap-4');
    });
  });

  describe('Responsive Behavior', () => {
    it('should always be single column on mobile', () => {
      const { container } = render(
        <StatsGrid columns={4}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
    });

    it('should handle all column configurations responsively', () => {
      const configs = [1, 2, 3, 4] as const;

      configs.forEach((cols) => {
        const { container } = render(
          <StatsGrid columns={cols}>
            <div>Test {cols}</div>
          </StatsGrid>
        );

        // All should start with grid-cols-1 for mobile
        expect(container.firstChild).toHaveClass('grid-cols-1');
      });
    });
  });

  describe('Integration with Children', () => {
    it('should work with MetricCard-like children', () => {
      const { getByText } = render(
        <StatsGrid columns={4}>
          <div className="card">Metric 1</div>
          <div className="card">Metric 2</div>
          <div className="card">Metric 3</div>
          <div className="card">Metric 4</div>
        </StatsGrid>
      );

      expect(getByText('Metric 1')).toBeInTheDocument();
      expect(getByText('Metric 2')).toBeInTheDocument();
      expect(getByText('Metric 3')).toBeInTheDocument();
      expect(getByText('Metric 4')).toBeInTheDocument();
    });

    it('should preserve child props', () => {
      const { container } = render(
        <StatsGrid>
          <div data-testid="test-child" className="child-class">
            Child
          </div>
        </StatsGrid>
      );

      const child = container.querySelector('[data-testid="test-child"]');
      expect(child).toBeInTheDocument();
      expect(child).toHaveClass('child-class');
    });

    it('should handle nested components', () => {
      const { getByText } = render(
        <StatsGrid>
          <div>
            <span>Nested</span>
            <strong>Content</strong>
          </div>
        </StatsGrid>
      );

      expect(getByText('Nested')).toBeInTheDocument();
      expect(getByText('Content')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null children', () => {
      const { container } = render(
        <StatsGrid>
          {null}
          <div>Valid Child</div>
          {undefined}
        </StatsGrid>
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should handle conditional children', () => {
      const showChild = true;
      const { getByText, queryByText } = render(
        <StatsGrid>
          {showChild && <div>Shown</div>}
          {!showChild && <div>Hidden</div>}
        </StatsGrid>
      );

      expect(getByText('Shown')).toBeInTheDocument();
      expect(queryByText('Hidden')).not.toBeInTheDocument();
    });

    it('should handle fragments as children', () => {
      const { getByText } = render(
        <StatsGrid>
          <>
            <div>Fragment Child 1</div>
            <div>Fragment Child 2</div>
          </>
        </StatsGrid>
      );

      expect(getByText('Fragment Child 1')).toBeInTheDocument();
      expect(getByText('Fragment Child 2')).toBeInTheDocument();
    });

    it('should handle mapped children', () => {
      const items = ['Item 1', 'Item 2', 'Item 3'];
      const { getByText } = render(
        <StatsGrid>
          {items.map((item, i) => (
            <div key={i}>{item}</div>
          ))}
        </StatsGrid>
      );

      items.forEach((item) => {
        expect(getByText(item)).toBeInTheDocument();
      });
    });
  });

  describe('Combination of Props', () => {
    it('should handle columns and gap together', () => {
      const { container } = render(
        <StatsGrid columns={3} gap="lg">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).toHaveClass('lg:grid-cols-3');
      expect(container.firstChild).toHaveClass('gap-6');
    });

    it('should handle all props together', () => {
      const { container } = render(
        <StatsGrid columns={2} gap="sm" className="custom-grid">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('grid');
      expect(container.firstChild).toHaveClass('grid-cols-1');
      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).toHaveClass('gap-3');
      expect(container.firstChild).toHaveClass('custom-grid');
    });

    it('should allow className to override default classes', () => {
      const { container } = render(
        <StatsGrid className="grid-cols-6">
          <div>Test</div>
        </StatsGrid>
      );

      // Custom class should be present
      expect(container.firstChild).toHaveClass('grid-cols-6');
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when columns prop changes', () => {
      const { container, rerender } = render(
        <StatsGrid columns={2}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).not.toHaveClass('lg:grid-cols-3');

      rerender(
        <StatsGrid columns={3}>
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('md:grid-cols-2');
      expect(container.firstChild).toHaveClass('lg:grid-cols-3');
    });

    it('should update when gap prop changes', () => {
      const { container, rerender } = render(
        <StatsGrid gap="sm">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('gap-3');

      rerender(
        <StatsGrid gap="lg">
          <div>Test</div>
        </StatsGrid>
      );

      expect(container.firstChild).toHaveClass('gap-6');
      expect(container.firstChild).not.toHaveClass('gap-3');
    });

    it('should update when children change', () => {
      const { getByText, queryByText, rerender } = render(
        <StatsGrid>
          <div>Original Child</div>
        </StatsGrid>
      );

      expect(getByText('Original Child')).toBeInTheDocument();

      rerender(
        <StatsGrid>
          <div>New Child</div>
        </StatsGrid>
      );

      expect(queryByText('Original Child')).not.toBeInTheDocument();
      expect(getByText('New Child')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard navigable', () => {
      const { container } = render(
        <StatsGrid>
          <button>Button 1</button>
          <button>Button 2</button>
        </StatsGrid>
      );

      const buttons = container.querySelectorAll('button');
      expect(buttons).toHaveLength(2);
    });

    it('should preserve ARIA attributes from children', () => {
      const { container } = render(
        <StatsGrid>
          <div aria-label="Test Label">Content</div>
        </StatsGrid>
      );

      const child = container.querySelector('[aria-label="Test Label"]');
      expect(child).toBeInTheDocument();
    });
  });
});
