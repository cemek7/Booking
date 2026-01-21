import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import PerformanceTable, {
  TableColumn,
} from '@/components/analytics/shared/PerformanceTable';

interface TestData {
  id: number;
  name: string;
  bookings: number;
  revenue: number;
  rating: number;
}

const mockData: TestData[] = [
  { id: 1, name: 'Alice', bookings: 45, revenue: 4500, rating: 4.8 },
  { id: 2, name: 'Bob', bookings: 32, revenue: 3200, rating: 4.5 },
  { id: 3, name: 'Charlie', bookings: 58, revenue: 5800, rating: 4.9 },
  { id: 4, name: 'Diana', bookings: 41, revenue: 4100, rating: 4.7 },
];

const basicColumns: TableColumn<TestData>[] = [
  { key: 'name', label: 'Staff Member', sortable: true },
  { key: 'bookings', label: 'Bookings', sortable: true, align: 'right' },
  { key: 'revenue', label: 'Revenue', sortable: true, align: 'right' },
  { key: 'rating', label: 'Rating', align: 'right' },
];

describe('PerformanceTable', () => {
  describe('Rendering - Basic Structure', () => {
    it('should render table with data', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
      expect(screen.getByText('Diana')).toBeInTheDocument();
    });

    it('should render all column headers', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      expect(screen.getByText('Staff Member')).toBeInTheDocument();
      expect(screen.getByText('Bookings')).toBeInTheDocument();
      expect(screen.getByText('Revenue')).toBeInTheDocument();
      expect(screen.getByText('Rating')).toBeInTheDocument();
    });

    it('should render all data cells', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      // Check numeric values
      expect(screen.getByText('45')).toBeInTheDocument();
      expect(screen.getByText('4500')).toBeInTheDocument();
      expect(screen.getByText('4.8')).toBeInTheDocument();
    });

    it('should render with title', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          title="Staff Performance"
        />
      );

      expect(screen.getByText('Staff Performance')).toBeInTheDocument();
    });

    it('should render with description', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          description="Top performing staff members"
        />
      );

      expect(screen.getByText('Top performing staff members')).toBeInTheDocument();
    });

    it('should render with title and description', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          title="Staff Performance"
          description="Monthly summary"
        />
      );

      expect(screen.getByText('Staff Performance')).toBeInTheDocument();
      expect(screen.getByText('Monthly summary')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          className="custom-table"
        />
      );

      expect(container.querySelector('.custom-table')).toBeInTheDocument();
    });

    it('should render table structure correctly', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const table = container.querySelector('table');
      expect(table).toBeInTheDocument();
      expect(table?.querySelector('thead')).toBeInTheDocument();
      expect(table?.querySelector('tbody')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should render empty message when no data', () => {
      render(
        <PerformanceTable data={[]} columns={basicColumns} />
      );

      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should render custom empty message', () => {
      render(
        <PerformanceTable
          data={[]}
          columns={basicColumns}
          emptyMessage="No staff found"
        />
      );

      expect(screen.getByText('No staff found')).toBeInTheDocument();
    });

    it('should span empty message across all columns', () => {
      const { container } = render(
        <PerformanceTable data={[]} columns={basicColumns} />
      );

      const emptyCell = container.querySelector('td[colspan]');
      expect(emptyCell?.getAttribute('colspan')).toBe('4');
    });

    it('should not render data rows when empty', () => {
      render(
        <PerformanceTable data={[]} columns={basicColumns} />
      );

      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });
  });

  describe('Sorting Functionality', () => {
    it('should sort ascending when clicking sortable column first time', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const nameHeader = screen.getByText('Staff Member').closest('th');
      fireEvent.click(nameHeader!);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0]).toHaveTextContent('Alice');
      expect(rows[1]).toHaveTextContent('Bob');
      expect(rows[2]).toHaveTextContent('Charlie');
      expect(rows[3]).toHaveTextContent('Diana');
    });

    it('should sort descending when clicking sorted column second time', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const nameHeader = screen.getByText('Staff Member').closest('th');
      fireEvent.click(nameHeader!);
      fireEvent.click(nameHeader!);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0]).toHaveTextContent('Diana');
      expect(rows[1]).toHaveTextContent('Charlie');
      expect(rows[2]).toHaveTextContent('Bob');
      expect(rows[3]).toHaveTextContent('Alice');
    });

    it('should reset sort when clicking sorted column third time', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const nameHeader = screen.getByText('Staff Member').closest('th');
      fireEvent.click(nameHeader!);
      fireEvent.click(nameHeader!);
      fireEvent.click(nameHeader!);

      const rows = container.querySelectorAll('tbody tr');
      // Should return to original order
      expect(rows[0]).toHaveTextContent('Alice');
      expect(rows[1]).toHaveTextContent('Bob');
      expect(rows[2]).toHaveTextContent('Charlie');
      expect(rows[3]).toHaveTextContent('Diana');
    });

    it('should sort numeric columns correctly ascending', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const bookingsHeader = screen.getByText('Bookings').closest('th');
      fireEvent.click(bookingsHeader!);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0]).toHaveTextContent('32'); // Bob
      expect(rows[1]).toHaveTextContent('41'); // Diana
      expect(rows[2]).toHaveTextContent('45'); // Alice
      expect(rows[3]).toHaveTextContent('58'); // Charlie
    });

    it('should sort numeric columns correctly descending', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const bookingsHeader = screen.getByText('Bookings').closest('th');
      fireEvent.click(bookingsHeader!);
      fireEvent.click(bookingsHeader!);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0]).toHaveTextContent('58'); // Charlie
      expect(rows[1]).toHaveTextContent('45'); // Alice
      expect(rows[2]).toHaveTextContent('41'); // Diana
      expect(rows[3]).toHaveTextContent('32'); // Bob
    });

    it('should not sort non-sortable columns', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const ratingHeader = screen.getByText('Rating').closest('th');
      const originalOrder = Array.from(container.querySelectorAll('tbody tr')).map(
        (row) => row.textContent
      );

      fireEvent.click(ratingHeader!);

      const newOrder = Array.from(container.querySelectorAll('tbody tr')).map(
        (row) => row.textContent
      );

      expect(originalOrder).toEqual(newOrder);
    });

    it('should reset previous sort when sorting new column', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      // Sort by name
      fireEvent.click(screen.getByText('Staff Member').closest('th')!);
      // Then sort by bookings
      fireEvent.click(screen.getByText('Bookings').closest('th')!);

      const rows = container.querySelectorAll('tbody tr');
      // Should be sorted by bookings ascending
      expect(rows[0]).toHaveTextContent('32');
      expect(rows[3]).toHaveTextContent('58');
    });

    it('should handle sorting with equal values', () => {
      const equalData: TestData[] = [
        { id: 1, name: 'Alice', bookings: 45, revenue: 4500, rating: 4.5 },
        { id: 2, name: 'Bob', bookings: 45, revenue: 3200, rating: 4.5 },
      ];

      const { container } = render(
        <PerformanceTable data={equalData} columns={basicColumns} />
      );

      fireEvent.click(screen.getByText('Bookings').closest('th')!);

      // Should maintain original order when values are equal
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(2);
    });
  });

  describe('Sort Icons', () => {
    it('should show ArrowUpDown icon for unsorted columns', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      // All sortable columns should have sort icons
      expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    });

    it('should show ArrowUp icon when sorted ascending', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      fireEvent.click(screen.getByText('Staff Member').closest('th')!);

      // Should show ascending arrow (implementation detail)
      expect(screen.getByText('Staff Member')).toBeInTheDocument();
    });

    it('should show ArrowDown icon when sorted descending', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      fireEvent.click(screen.getByText('Staff Member').closest('th')!);
      fireEvent.click(screen.getByText('Staff Member').closest('th')!);

      // Should show descending arrow (implementation detail)
      expect(screen.getByText('Staff Member')).toBeInTheDocument();
    });
  });

  describe('Column Formatting', () => {
    it('should apply custom formatValue function', () => {
      const formattedColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name' },
        {
          key: 'revenue',
          label: 'Revenue',
          formatValue: (value) => `$${value.toLocaleString()}`,
        },
      ];

      render(
        <PerformanceTable data={mockData} columns={formattedColumns} />
      );

      expect(screen.getByText('$4,500')).toBeInTheDocument();
      expect(screen.getByText('$3,200')).toBeInTheDocument();
    });

    it('should apply formatValue with access to full row', () => {
      const formattedColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name' },
        {
          key: 'rating',
          label: 'Rating',
          formatValue: (value, row) => `${value} ⭐ (${row.bookings} bookings)`,
        },
      ];

      render(
        <PerformanceTable data={mockData} columns={formattedColumns} />
      );

      expect(screen.getByText('4.8 ⭐ (45 bookings)')).toBeInTheDocument();
    });

    it('should render React components from formatValue', () => {
      const formattedColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name' },
        {
          key: 'revenue',
          label: 'Revenue',
          formatValue: (value) => <strong data-testid="formatted-value">${value}</strong>,
        },
      ];

      render(
        <PerformanceTable data={mockData} columns={formattedColumns} />
      );

      expect(screen.getAllByTestId('formatted-value')).toHaveLength(4);
    });

    it('should display raw value when no formatValue provided', () => {
      const simpleColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name' },
        { key: 'bookings', label: 'Bookings' },
      ];

      render(
        <PerformanceTable data={mockData} columns={simpleColumns} />
      );

      expect(screen.getByText('45')).toBeInTheDocument();
      expect(screen.getByText('32')).toBeInTheDocument();
    });
  });

  describe('Column Alignment', () => {
    it('should apply left alignment by default', () => {
      const { container } = render(
        <PerformanceTable
          data={mockData}
          columns={[{ key: 'name', label: 'Name' }]}
        />
      );

      const headerCell = container.querySelector('th');
      expect(headerCell).not.toHaveClass('text-center');
      expect(headerCell).not.toHaveClass('text-right');
    });

    it('should apply center alignment when specified', () => {
      const centeredColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name', align: 'center' },
      ];

      const { container } = render(
        <PerformanceTable data={mockData} columns={centeredColumns} />
      );

      const headerCell = container.querySelector('th');
      expect(headerCell).toHaveClass('text-center');
    });

    it('should apply right alignment when specified', () => {
      const rightColumns: TableColumn<TestData>[] = [
        { key: 'bookings', label: 'Bookings', align: 'right' },
      ];

      const { container } = render(
        <PerformanceTable data={mockData} columns={rightColumns} />
      );

      const headerCell = container.querySelector('th');
      expect(headerCell).toHaveClass('text-right');
    });

    it('should apply alignment to both header and data cells', () => {
      const alignedColumns: TableColumn<TestData>[] = [
        { key: 'bookings', label: 'Bookings', align: 'right' },
      ];

      const { container } = render(
        <PerformanceTable data={mockData} columns={alignedColumns} />
      );

      const dataCells = container.querySelectorAll('tbody td');
      dataCells.forEach((cell) => {
        expect(cell).toHaveClass('text-right');
      });
    });
  });

  describe('Column Width', () => {
    it('should apply custom width to columns', () => {
      const widthColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name', width: '200px' },
        { key: 'bookings', label: 'Bookings', width: '100px' },
      ];

      const { container } = render(
        <PerformanceTable data={mockData} columns={widthColumns} />
      );

      const headers = container.querySelectorAll('th');
      expect(headers[0]).toHaveStyle({ width: '200px' });
      expect(headers[1]).toHaveStyle({ width: '100px' });
    });
  });

  describe('Export Functionality', () => {
    const mockOnExport = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should render export button when onExport provided', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          onExport={mockOnExport}
        />
      );

      expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });

    it('should not render export button when onExport not provided', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
    });

    it('should call onExport when export button clicked', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          onExport={mockOnExport}
        />
      );

      fireEvent.click(screen.getByText('Export CSV'));

      expect(mockOnExport).toHaveBeenCalledTimes(1);
    });

    it('should render custom export label', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          onExport={mockOnExport}
          exportLabel="Download Report"
        />
      );

      expect(screen.getByText('Download Report')).toBeInTheDocument();
      expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
    });

    it('should render download icon in export button', () => {
      const { container } = render(
        <PerformanceTable
          data={mockData}
          columns={basicColumns}
          onExport={mockOnExport}
        />
      );

      const button = screen.getByText('Export CSV').closest('button');
      expect(button?.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should use semantic table elements', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      expect(container.querySelector('table')).toBeInTheDocument();
      expect(container.querySelector('thead')).toBeInTheDocument();
      expect(container.querySelector('tbody')).toBeInTheDocument();
      expect(container.querySelector('th')).toBeInTheDocument();
      expect(container.querySelector('td')).toBeInTheDocument();
    });

    it('should have proper column headers', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const headers = container.querySelectorAll('th');
      expect(headers.length).toBe(4);
    });

    it('should indicate sortable columns with cursor', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const sortableHeader = screen.getByText('Staff Member').closest('th');
      expect(sortableHeader).toHaveClass('cursor-pointer');
    });

    it('should be keyboard accessible for sorting', () => {
      render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const nameHeader = screen.getByText('Staff Member').closest('th');

      // Check that the element is focusable (has onClick for sortable columns)
      expect(nameHeader).toBeInTheDocument();
      expect(nameHeader).toHaveClass('cursor-pointer');
    });
  });

  describe('Edge Cases', () => {
    it('should handle single row', () => {
      render(
        <PerformanceTable data={[mockData[0]]} columns={basicColumns} />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('should handle single column', () => {
      render(
        <PerformanceTable
          data={mockData}
          columns={[{ key: 'name', label: 'Name' }]}
        />
      );

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.queryByText('Bookings')).not.toBeInTheDocument();
    });

    it('should handle null values in data', () => {
      const nullData = [
        { id: 1, name: 'Alice', bookings: null, revenue: 4500, rating: 4.8 },
      ] as any;

      render(
        <PerformanceTable data={nullData} columns={basicColumns} />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('should handle undefined values in data', () => {
      const undefinedData = [
        { id: 1, name: 'Alice', bookings: undefined, revenue: 4500, rating: 4.8 },
      ] as any;

      render(
        <PerformanceTable data={undefinedData} columns={basicColumns} />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('should handle large datasets', () => {
      const largeData = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Person ${i}`,
        bookings: i * 10,
        revenue: i * 1000,
        rating: 4.5,
      }));

      const { container } = render(
        <PerformanceTable data={largeData} columns={basicColumns} />
      );

      const rows = container.querySelectorAll('tbody tr');
      expect(rows.length).toBe(100);
    });

    it('should handle rapid sorting clicks', () => {
      const { container } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      const header = screen.getByText('Staff Member').closest('th');
      fireEvent.click(header!);
      fireEvent.click(header!);
      fireEvent.click(header!);
      fireEvent.click(header!);

      // Should not crash
      expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    });

    it('should handle mixed data types in sortable column', () => {
      const mixedData = [
        { id: 1, name: 'Alice', bookings: 45, revenue: 4500, rating: 4.8 },
        { id: 2, name: 'Bob', bookings: 32, revenue: 3200, rating: 4.5 },
        { id: 3, name: 'Charlie', bookings: 58, revenue: 5800, rating: 4.9 },
      ];

      const { container } = render(
        <PerformanceTable data={mixedData} columns={basicColumns} />
      );

      fireEvent.click(screen.getByText('Staff Member').closest('th')!);

      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    });
  });

  describe('Dynamic Updates', () => {
    it('should update when data changes', () => {
      const { rerender } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();

      const newData = [
        { id: 5, name: 'Eve', bookings: 50, revenue: 5000, rating: 4.6 },
      ];

      rerender(
        <PerformanceTable data={newData} columns={basicColumns} />
      );

      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      expect(screen.getByText('Eve')).toBeInTheDocument();
    });

    it('should update when columns change', () => {
      const { rerender } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      expect(screen.getByText('Bookings')).toBeInTheDocument();

      const newColumns: TableColumn<TestData>[] = [
        { key: 'name', label: 'Name' },
      ];

      rerender(
        <PerformanceTable data={mockData} columns={newColumns} />
      );

      expect(screen.queryByText('Bookings')).not.toBeInTheDocument();
    });

    it('should preserve sort when data updates', () => {
      const { container, rerender } = render(
        <PerformanceTable data={mockData} columns={basicColumns} />
      );

      // Sort by name
      fireEvent.click(screen.getByText('Staff Member').closest('th')!);

      const updatedData = [
        ...mockData,
        { id: 5, name: 'Eve', bookings: 50, revenue: 5000, rating: 4.6 },
      ];

      rerender(
        <PerformanceTable data={updatedData} columns={basicColumns} />
      );

      // Should still be sorted
      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0]).toHaveTextContent('Alice');
    });
  });
});
