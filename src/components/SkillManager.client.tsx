"use client";
import React, { useEffect, useState } from 'react';
import { authFetch, authPost, authDelete, authPatch } from '@/lib/auth/auth-api-client';

interface Skill { id: string; name: string; category?: string | null; }
interface Staff { user_id: string; role: string; email?: string; name?: string; }
interface Assignment { user_id: string; skill_id: string; skill_name: string; proficiency: number; }

interface SkillManagerProps { tenantId: string; className?: string; }

export const SkillManager: React.FC<SkillManagerProps> = ({ tenantId, className }) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedSkill, setSelectedSkill] = useState<string>('');
  const [proficiency, setProficiency] = useState<number>(1);

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [skillsResp, staffResp, assignResp] = await Promise.all([
        fetch(`/api/skills?tenant_id=${tenantId}`),
        fetch(`/api/staff?tenant_id=${tenantId}`),
        fetch(`/api/staff-skills?tenant_id=${tenantId}`)
      ]);
      if (!skillsResp.ok) throw new Error('skills fetch failed');
      if (!staffResp.ok) throw new Error('staff fetch failed');
      if (!assignResp.ok) throw new Error('assignments fetch failed');
      const skillsJson = await skillsResp.json();
      const staffJson = await staffResp.json();
      const assignJson = await assignResp.json();
      setSkills(skillsJson.skills || []);
      setStaff(staffJson?.staff || staffJson?.data || []); // new endpoint returns { staff }
      setAssignments(assignJson.assignments || []);
    } catch (e: any) {
      setError(e.message || 'Load error');
    } finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, [tenantId]);

  async function createSkill() {
    if (!newSkillName.trim()) return;
    // optimistic insert
    const tempId = `temp_${Date.now()}`;
    const optimistic: Skill = { id: tempId, name: newSkillName.trim(), category: newSkillCategory.trim() || null };
    setSkills(prev => [...prev, optimistic]);
    setNewSkillName(''); setNewSkillCategory('');
    try {
      const response = await authPost('/api/skills', { tenant_id: tenantId, name: optimistic.name, category: optimistic.category });
      if (response.error) throw new Error('create failed');
      if (response.data?.skill) setSkills(prev => prev.map(s => s.id === tempId ? response.data.skill : s));
      else await loadAll();
    } catch (e: any) {
      setSkills(prev => prev.filter(s => s.id !== tempId));
      setError(e.message || 'Create failed');
    }
  }

  async function assignSkill() {
    if (!selectedStaff || !selectedSkill) return;
    const optimistic: Assignment = { user_id: selectedStaff, skill_id: selectedSkill, skill_name: skills.find(s=>s.id===selectedSkill)?.name || 'Skill', proficiency };
    setAssignments(prev => [...prev, optimistic]);
    try {
      const response = await authPost('/api/staff-skills', { tenant_id: tenantId, user_id: selectedStaff, skill_id: selectedSkill, proficiency });
      if (response.error) throw new Error('assign failed');
      if (response.data?.assignment) setAssignments(prev => prev.map(a => a === optimistic ? response.data.assignment : a));
      else await loadAll();
    } catch (e: any) {
      setAssignments(prev => prev.filter(a => a !== optimistic));
      setError(e.message || 'Assign failed');
    }
  }

  async function unassign(userId: string, skillId: string) {
    const existing = assignments.find(a => a.user_id === userId && a.skill_id === skillId);
    if (!existing) return;
    setAssignments(prev => prev.filter(a => !(a.user_id === userId && a.skill_id === skillId)));
    try {
      const response = await authDelete(`/api/staff-skills/${userId}/${skillId}`);
      if (response.error) throw new Error('unassign failed');
    } catch (e: any) {
      // rollback
      setAssignments(prev => [...prev, existing]);
      setError(e.message || 'Unassign failed');
    }
  }

  async function deleteSkill(id: string) {
    const existing = skills.find(s => s.id === id);
    if (!existing) return;
    setSkills(prev => prev.filter(s => s.id !== id));
    try {
      const response = await authDelete(`/api/skills/${id}`);
      if (response.error) throw new Error('delete failed');
      // also remove assignments referencing this skill
      setAssignments(prev => prev.filter(a => a.skill_id !== id));
    } catch (e: any) {
      setSkills(prev => [...prev, existing]);
      setError(e.message || 'Delete failed');
    }
  }

  async function renameSkill(id: string, newName: string) {
    if (!newName.trim()) return;
    setSkills(prev => prev.map(s => s.id === id ? { ...s, name: newName.trim() } : s));
    try {
      const response = await authPatch(`/api/skills/${id}`, { name: newName.trim() });
      if (response.error) throw new Error('rename failed');
      if (response.data?.skill) setSkills(prev => prev.map(s => s.id === id ? response.data.skill : s));
    } catch (e: any) {
      setError(e.message || 'Rename failed');
    }
  }

  return (
    <div className={"p-4 border rounded bg-white " + (className||'')}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg">Skill Management</h3>
        <button onClick={loadAll} disabled={loading} className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">Refresh</button>
      </div>
      {loading && <div className="text-gray-500 animate-pulse">Loading…</div>}
      {error && <div className="text-red-600 mb-2">{error}</div>}

      <div className="mb-4">
        <h4 className="font-medium mb-1">Add Skill</h4>
        <div className="flex gap-2 flex-wrap">
          <input placeholder="Name" value={newSkillName} onChange={e=>setNewSkillName(e.target.value)} className="border rounded px-2 py-1" />
          <input placeholder="Category" value={newSkillCategory} onChange={e=>setNewSkillCategory(e.target.value)} className="border rounded px-2 py-1" />
          <button onClick={createSkill} disabled={!newSkillName.trim()} className="px-3 py-1 bg-blue-600 text-white rounded">Add</button>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="font-medium mb-1">Assign Skill to Staff</h4>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={selectedStaff} onChange={e=>setSelectedStaff(e.target.value)} className="border rounded px-2 py-1">
            <option value="">Select staff</option>
            {staff.map(s=> <option key={s.user_id} value={s.user_id}>{s.name || s.email || s.user_id}</option>)}
          </select>
          <select value={selectedSkill} onChange={e=>setSelectedSkill(e.target.value)} className="border rounded px-2 py-1">
            <option value="">Select skill</option>
            {skills.map(sk=> <option key={sk.id} value={sk.id}>{sk.name}</option>)}
          </select>
          <input type="number" min={1} max={5} value={proficiency} onChange={e=>setProficiency(Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
          <button onClick={assignSkill} disabled={!selectedStaff || !selectedSkill} className="px-3 py-1 bg-green-600 text-white rounded">Assign</button>
        </div>
      </div>

      <div>
        <h4 className="font-medium mb-1">Skills</h4>
        <table className="w-full text-sm border">
          <thead><tr className="bg-gray-50"><th className="p-1 border">Name</th><th className="p-1 border">Category</th><th className="p-1 border">Actions</th></tr></thead>
          <tbody>
            {skills.map(sk=> <tr key={sk.id}>
              <td className="p-1 border">{sk.name}</td>
              <td className="p-1 border text-gray-500">{sk.category || '-'}</td>
              <td className="p-1 border text-xs">
                <button className="px-2 py-0.5 bg-gray-100 rounded mr-1" onClick={() => {
                  const nn = prompt('Rename skill', sk.name);
                  if (nn && nn !== sk.name) renameSkill(sk.id, nn);
                }}>Rename</button>
                <button className="px-2 py-0.5 bg-red-500 text-white rounded" onClick={() => deleteSkill(sk.id)}>Delete</button>
              </td>
            </tr>)}
            {skills.length === 0 && <tr><td colSpan={3} className="p-2 text-center text-gray-400">No skills yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <h4 className="font-medium mb-1">Assignments</h4>
        <table className="w-full text-sm border">
          <thead><tr className="bg-gray-50"><th className="p-1 border">Staff</th><th className="p-1 border">Skill</th><th className="p-1 border">Proficiency</th><th className="p-1 border">Actions</th></tr></thead>
          <tbody>
            {assignments.map(a=> <tr key={`${a.user_id}_${a.skill_id}`}>
              <td className="p-1 border">{a.user_id}</td>
              <td className="p-1 border">{a.skill_name}</td>
              <td className="p-1 border text-center">{a.proficiency}</td>
              <td className="p-1 border text-center text-xs">
                <button className="px-2 py-0.5 bg-red-500 text-white rounded" onClick={() => unassign(a.user_id, a.skill_id)}>Remove</button>
              </td>
            </tr>)}
            {assignments.length === 0 && <tr><td colSpan={4} className="p-2 text-center text-gray-400">No assignments.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SkillManager;
