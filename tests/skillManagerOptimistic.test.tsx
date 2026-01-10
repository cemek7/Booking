// Jest globals are available without import
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillManager } from '@/components/SkillManager.client';

// Sequence-based fetch mock
const fetchMock = jest.fn();
// @ts-ignore
global.fetch = fetchMock;

describe('SkillManager optimistic flows', () => {
  it('optimistically creates skill', async () => {
    // Initial load: skills, staff, assignments
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ staff: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ assignments: [] }) });
    // POST create
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ skill: { id: 'real1', name: 'NewSkill', category: null } }) });
    render(<SkillManager tenantId="t1" />);
    // Enter skill name
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'NewSkill' } });
    fireEvent.click(screen.getByText('Add'));
    // Optimistic row present
    expect(screen.getByText('NewSkill')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('optimistically assigns skill', async () => {
    // Initial load with one skill and one staff and no assignments
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [{ id: 's1', name: 'Base', category: null }] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ staff: [{ user_id: 'u1', role: 'staff', name: 'Staff One' }] }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ assignments: [] }) });
    // POST assign
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ assignment: { user_id: 'u1', skill_id: 's1', skill_name: 'Base', proficiency: 3 } }) });
    render(<SkillManager tenantId="t1" />);
    fireEvent.change(screen.getByDisplayValue('Select staff'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByDisplayValue('Select skill'), { target: { value: 's1' } });
    fireEvent.click(screen.getByText('Assign'));
    expect(screen.getByText('Base')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
