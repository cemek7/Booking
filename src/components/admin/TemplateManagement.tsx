'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, 
  Search, 
  Edit, 
  Copy, 
  Trash2, 
  Send, 
  Eye, 
  Filter,
  MoreVertical,
  CheckCircle,
  XCircle,
  MessageSquare
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import TemplateEditor from './TemplateEditor';

interface Template {
  id: string;
  name: string;
  description: string;
  category: 'confirmation' | 'reminder' | 'cancellation' | 'welcome' | 'follow_up' | 'custom';
  content: string;
  variables: any[];
  language: 'en' | 'es' | 'fr' | 'de' | 'pt';
  active: boolean;
  usage_count: number;
  last_used: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_ICONS = {
  confirmation: '✅',
  reminder: '⏰',
  cancellation: '❌',
  welcome: '👋',
  follow_up: '💬',
  custom: '🎨'
};

export default function TemplateManagement() {
  const headers = useAuthHeaders();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<Template[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | undefined>();
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive'>('all');

  const loadTemplates = useCallback(async () => {
    if (!headers) return;
    const res = await fetch('/api/templates', { headers });
    if (!res.ok) { setLoadError('Failed to load templates'); return; }
    const data = await res.json();
    setTemplates(data?.templates ?? []);
    setLoadError(null);
  }, [headers]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Filter templates based on search and filters
  useEffect(() => {
    let filtered = templates;

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(template =>
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(template => template.category === selectedCategory);
    }

    // Filter by language
    if (selectedLanguage !== 'all') {
      filtered = filtered.filter(template => template.language === selectedLanguage);
    }

    // Filter by active tab
    if (activeTab === 'active') {
      filtered = filtered.filter(template => template.active);
    } else if (activeTab === 'inactive') {
      filtered = filtered.filter(template => !template.active);
    }

    setFilteredTemplates(filtered);
  }, [templates, searchQuery, selectedCategory, selectedLanguage, activeTab]);

  const handleCreateTemplate = () => {
    setEditingTemplate(undefined);
    setShowEditor(true);
  };

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setShowEditor(true);
  };

  const handleSaveTemplate = async (template: Template) => {
    if (!headers) return;
    try {
      if (template.id) {
        const res = await fetch(`/api/templates?id=${template.id}`, {
          method: 'PATCH', headers,
          body: JSON.stringify(template),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setTemplates(prev => prev.map(t => t.id === template.id ? data.template : t));
      } else {
        const res = await fetch('/api/templates', {
          method: 'POST', headers,
          body: JSON.stringify(template),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setTemplates(prev => [data.template, ...prev]);
      }
      setShowEditor(false);
    } catch {
      console.error('Failed to save template');
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?') || !headers) return;
    try {
      const res = await fetch(`/api/templates?id=${templateId}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error();
      setTemplates(prev => prev.filter(t => t.id !== templateId));
    } catch {
      console.error('Failed to delete template');
    }
  };

  const handleDuplicateTemplate = async (template: Template) => {
    if (!headers) return;
    try {
      const res = await fetch('/api/templates', {
        method: 'POST', headers,
        body: JSON.stringify({ ...template, name: `${template.name} (Copy)` }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTemplates(prev => [data.template, ...prev]);
    } catch {
      console.error('Failed to duplicate template');
    }
  };

  const toggleTemplateStatus = async (templateId: string) => {
    if (!headers) return;
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    const newActive = !template.active;
    setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, active: newActive } : t));
    try {
      const res = await fetch(`/api/templates?id=${templateId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ active: newActive }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, active: template.active } : t));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (showEditor) {
    return (
      <TemplateEditor
        initialTemplate={editingTemplate}
        onSave={handleSaveTemplate as any}
        onCancel={() => setShowEditor(false)}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {loadError && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          {loadError}
        </div>
      )}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-3xl font-bold">Message Templates</h1>
            <p className="text-muted-foreground">
              Manage automated messages for bookings, reminders, and notifications
            </p>
          </div>
          <Button onClick={handleCreateTemplate} className="flex items-center space-x-2">
            <Plus className="w-4 h-4" />
            <span>Create Template</span>
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="text-sm font-medium">Total Templates</div>
                  <div className="text-2xl font-bold">{templates.length}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-2xl font-bold">{templates.filter(t => t.active).length}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Send className="w-5 h-5 text-purple-500" />
                <div>
                  <div className="text-sm font-medium">Total Sent</div>
                  <div className="text-2xl font-bold">{templates.reduce((sum, t) => sum + t.usage_count, 0).toLocaleString()}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Eye className="w-5 h-5 text-orange-500" />
                <div>
                  <div className="text-sm font-medium">Most Used</div>
                  <div className="text-lg font-bold truncate">
                    {templates.length > 0 
                      ? templates.reduce((max, t) => t.usage_count > max.usage_count ? t : max).name
                      : 'None'
                    }
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search templates by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <div className="flex gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">All Categories</option>
              <option value="confirmation">Confirmation</option>
              <option value="reminder">Reminder</option>
              <option value="cancellation">Cancellation</option>
              <option value="welcome">Welcome</option>
              <option value="follow_up">Follow-up</option>
              <option value="custom">Custom</option>
            </select>
            
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">All Languages</option>
              <option value="en">🇺🇸 English</option>
              <option value="es">🇪🇸 Español</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="pt">🇵🇹 Português</option>
            </select>
          </div>
        </div>
      </div>

      {/* Templates List */}
      <Card>
        <CardHeader>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
            <TabsList>
              <TabsTrigger value="all">All Templates</TabsTrigger>
              <TabsTrigger value="active">Active ({templates.filter(t => t.active).length})</TabsTrigger>
              <TabsTrigger value="inactive">Inactive ({templates.filter(t => !t.active).length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No templates found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery ? 'Try adjusting your search criteria' : 'Create your first template to get started'}
              </p>
              {!searchQuery && (
                <Button onClick={handleCreateTemplate}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Template
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTemplates.map((template) => (
                <Card key={template.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <span className="text-lg">
                            {CATEGORY_ICONS[template.category]}
                          </span>
                          <div>
                            <h3 className="font-medium">{template.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {template.description}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <Badge variant={template.active ? "default" : "secondary"}>
                            {template.active ? 'Active' : 'Inactive'}
                          </Badge>
                          
                          <Badge variant="outline">
                            {template.category}
                          </Badge>
                          
                          <Badge variant="outline">
                            {template.language.toUpperCase()}
                          </Badge>
                          
                          <span>Sent: {template.usage_count.toLocaleString()}</span>
                          <span>Last used: {formatDateTime(template.last_used)}</span>
                          <span>Updated: {formatDate(template.updated_at)}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleTemplateStatus(template.id)}
                        >
                          {template.active ? (
                            <XCircle className="w-4 h-4 text-red-600" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          )}
                        </Button>
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => handleEditTemplate(template)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicateTemplate(template)}>
                              <Copy className="w-4 h-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDeleteTemplate(template.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}