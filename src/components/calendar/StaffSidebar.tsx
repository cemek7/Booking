'use client';

import React from 'react';

// Define the structure for a resource (e.g., a staff member)
interface Resource {
  resourceId: number;
  resourceTitle: string;
  // Add any other properties you need for a resource, like a color
}

interface StaffSidebarProps {
  staff: Resource[];
  selectedStaff: number[];
  onSelectionChange: (selectedIds: number[]) => void;
}

const StaffSidebar: React.FC<StaffSidebarProps> = ({
  staff,
  selectedStaff,
  onSelectionChange,
}) => {
  const handleCheckboxChange = (staffId: number) => {
    const newSelection = selectedStaff.includes(staffId)
      ? selectedStaff.filter((id) => id !== staffId)
      : [...selectedStaff, staffId];
    onSelectionChange(newSelection);
  };

  return (
    <div className="p-4 border-r" style={{ minWidth: '200px' }}>
      <h3 className="text-lg font-semibold mb-4">Staff</h3>
      <ul>
        {staff.map((person) => (
          <li key={person.resourceId} className="mb-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={selectedStaff.includes(person.resourceId)}
                onChange={() => handleCheckboxChange(person.resourceId)}
              />
              <span>{person.resourceTitle}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 pt-4 border-t">
        <label className="flex items-center space-x-2">
          <input type="checkbox" />
          <span>View Unassigned Tasks</span>
        </label>
      </div>
    </div>
  );
};

export default StaffSidebar;
