'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Save, 
  Eye, 
  Code2, 
  Sparkles, 
  Send, 
  Copy, 
  RefreshCw, 
  AlertTriangle,
  CheckCircle,
  Info
} from 'lucide-react';

import { generateAITemplate, TemplateGenerationRequest } from '@/lib/aiTemplateGenerator';

interface TemplateVariable {
  name: string;
  type: 'text' | 'number' | 'date' | 'time' | 'email' | 'phone' | 'boolean';
  description: string;
  required: boolean;
  defaultValue?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

interface Template {
  id?: string;
  name: string;
  description: string;
  category: 'confirmation' | 'reminder' | 'cancellation' | 'welcome' | 'follow_up' | 'custom';
  content: string;
  variables: TemplateVariable[];
  language: 'en' | 'es' | 'fr' | 'de' | 'pt';
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

interface TemplateEditorProps {
  initialTemplate?: Template;
  onSave: (template: Template) => void;
  onCancel: () => void;
}

const DEFAULT_VARIABLES: TemplateVariable[] = [
  { name: 'customer_name', type: 'text', description: 'Customer\'s full name', required: true },
  { name: 'business_name', type: 'text', description: 'Business name', required: true },
  { name: 'appointment_date', type: 'date', description: 'Appointment date', required: true },
  { name: 'appointment_time', type: 'time', description: 'Appointment time', required: true },
  { name: 'service_name', type: 'text', description: 'Service or treatment name', required: true },
  { name: 'staff_name', type: 'text', description: 'Staff member name', required: false },
  { name: 'business_phone', type: 'phone', description: 'Business contact number', required: false },
  { name: 'business_address', type: 'text', description: 'Business address', required: false },
  { name: 'cancellation_link', type: 'text', description: 'Link to cancel appointment', required: false },
  { name: 'booking_reference', type: 'text', description: 'Booking reference number', required: false }
];

const TEMPLATE_CATEGORIES = [
  { value: 'confirmation', label: 'Booking Confirmation', icon: '✅' },
  { value: 'reminder', label: 'Appointment Reminder', icon: '⏰' },
  { value: 'cancellation', label: 'Cancellation Notice', icon: '❌' },
  { value: 'welcome', label: 'Welcome Message', icon: '👋' },
  { value: 'follow_up', label: 'Follow-up Message', icon: '💬' },
  { value: 'custom', label: 'Custom Template', icon: '🎨' }
];

const SAMPLE_TEMPLATES = {
  confirmation: `Hi {{customer_name}}! 👋

Your appointment at {{business_name}} has been confirmed:

📅 **Date:** {{appointment_date}}
🕐 **Time:** {{appointment_time}}
💼 **Service:** {{service_name}}
{{#if staff_name}}👨‍💼 **With:** {{staff_name}}{{/if}}

{{#if business_address}}📍 **Location:** {{business_address}}{{/if}}

{{#if cancellation_link}}Need to cancel? [Click here]({{cancellation_link}}){{/if}}

Looking forward to seeing you!`,

  reminder: `Hi {{customer_name}}! ⏰

Just a friendly reminder about your upcoming appointment:

📅 **Tomorrow at {{appointment_time}}**
💼 **Service:** {{service_name}}
📍 **At:** {{business_name}}

{{#if business_phone}}Questions? Call us at {{business_phone}}{{/if}}

See you soon! ✨`,

  cancellation: `Hi {{customer_name}},

We've received your cancellation request for:

📅 **{{appointment_date}} at {{appointment_time}}**
💼 **Service:** {{service_name}}

Your appointment has been cancelled. {{#if booking_reference}}Reference: {{booking_reference}}{{/if}}

We hope to see you again soon! Book anytime at {{business_name}}.`
};

export default function TemplateEditor({ initialTemplate, onSave, onCancel }: TemplateEditorProps) {
  const [template, setTemplate] = useState<Template>(() => ({
    name: '',
    description: '',
    category: 'confirmation',
    content: '',
    variables: [...DEFAULT_VARIABLES],
    language: 'en',
    active: true,
    ...initialTemplate
  }));

  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'variables'>('edit');
  const [previewData, setPreviewData] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Initialize preview data with sample values
  useEffect(() => {
    const sampleData: Record<string, string> = {
      customer_name: 'John Smith',
      business_name: 'Bella Salon & Spa',
      appointment_date: '2025-12-15',
      appointment_time: '2:30 PM',
      service_name: 'Haircut & Style',
      staff_name: 'Sarah Wilson',
      business_phone: '(555) 123-4567',
      business_address: '123 Main St, Downtown',
      cancellation_link: 'https://book.example.com/cancel/abc123',
      booking_reference: 'BK-2025-001'
    };
    setPreviewData(sampleData);
  }, []);

  // Load sample template when category changes
  useEffect(() => {
    if (!initialTemplate && template.category && SAMPLE_TEMPLATES[template.category as keyof typeof SAMPLE_TEMPLATES]) {
      setTemplate(prev => ({
        ...prev,
        content: SAMPLE_TEMPLATES[template.category as keyof typeof SAMPLE_TEMPLATES]
      }));
    }
  }, [template.category, initialTemplate]);

  const handleVariableChange = (index: number, field: keyof TemplateVariable, value: any) => {
    setTemplate(prev => ({
      ...prev,
      variables: prev.variables.map((variable, i) => 
        i === index ? { ...variable, [field]: value } : variable
      )
    }));
  };

  const addCustomVariable = () => {
    setTemplate(prev => ({
      ...prev,
      variables: [
        ...prev.variables,
        {
          name: 'custom_field',
          type: 'text',
          description: 'Custom field',
          required: false
        }
      ]
    }));
  };

  const removeVariable = (index: number) => {
    setTemplate(prev => ({
      ...prev,
      variables: prev.variables.filter((_, i) => i !== index)
    }));
  };

  const validateTemplate = (): string[] => {
    const errors: string[] = [];

    if (!template.name.trim()) {
      errors.push('Template name is required');
    }

    if (!template.content.trim()) {
      errors.push('Template content is required');
    }

    // Validate variables in content
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const usedVariables = new Set<string>();
    let match;
    
    while ((match = variablePattern.exec(template.content)) !== null) {
      const variableName = match[1].replace(/^#if\s+/, '').trim();
      usedVariables.add(variableName);
    }

    // Check for undefined variables
    const definedVariables = new Set(template.variables.map(v => v.name));
    for (const used of usedVariables) {
      if (!definedVariables.has(used)) {
        errors.push(`Variable "{{${used}}}" is not defined`);
      }
    }

    // Check for duplicate variable names
    const variableNames = template.variables.map(v => v.name);
    const duplicates = variableNames.filter((name, index) => variableNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate variable names: ${duplicates.join(', ')}`);
    }

    return errors;
  };

  const renderPreview = () => {
    let content = template.content;
    
    // Replace simple variables
    template.variables.forEach(variable => {
      const value = previewData[variable.name] || `{{${variable.name}}}`;
      const pattern = new RegExp(`\\{\\{${variable.name}\\}\\}`, 'g');
      content = content.replace(pattern, value);
    });

    // Handle conditional blocks (basic implementation)
    content = content.replace(/\{\{#if\s+([^}]+)\}\}(.*?)\{\{\/if\}\}/gs, (match, condition, block) => {
      const value = previewData[condition.trim()];
      return value ? block : '';
    });

    // Convert markdown-like formatting to HTML
    content = content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');

    return content;
  };

  const handleSave = async () => {
    const errors = validateTemplate();
    setValidationErrors(errors);
    
    if (errors.length > 0) {
      setActiveTab('edit');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(template);
    } catch (error) {
      console.error('Failed to save template:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const generateWithAI = async () => {
    if (!template.category) {
      alert('Please select a category first');
      return;
    }

    setIsGenerating(true);
    try {
      const request: TemplateGenerationRequest = {
        category: template.category as any,
        vertical: 'general', // TODO: Get from tenant settings
        language: template.language,
        tone: 'professional', // TODO: Make this configurable
        description: template.description || undefined,
        includeEmojis: true,
        length: 'medium'
      };

      // TODO: Get tenant ID and user ID from auth context
      const generated = await generateAITemplate(request);
      
      setTemplate(prev => ({
        ...prev,
        name: generated.name,
        content: generated.content,
        description: generated.description,
        variables: [...DEFAULT_VARIABLES, ...generated.variables.map(v => ({
          ...v,
          validation: undefined
        }))]
      }));

      alert(`Template generated successfully! (Confidence: ${(generated.confidence * 100).toFixed(1)}%)`);
    } catch (error) {
      console.error('AI generation failed:', error);
      alert('Failed to generate template with AI. Please try again or create manually.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">
          {initialTemplate ? 'Edit Template' : 'Create Template'}
        </h1>
        <p className="text-muted-foreground">
          Design and customize messaging templates for your booking system
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Basic Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Template Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                value={template.name}
                onChange={(e) => setTemplate(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Booking Confirmation"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={template.description}
                onChange={(e) => setTemplate(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What is this template used for?"
                rows={2}
              />
            </div>

            <div>
              <Label htmlFor="category">Category</Label>
              <Select
                value={template.category}
                onValueChange={(value) => setTemplate(prev => ({ ...prev, category: value as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex items-center space-x-2">
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="language">Language</Label>
              <Select
                value={template.language}
                onValueChange={(value) => setTemplate(prev => ({ ...prev, language: value as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                  <SelectItem value="es">🇪🇸 Español</SelectItem>
                  <SelectItem value="fr">🇫🇷 Français</SelectItem>
                  <SelectItem value="de">🇩🇪 Deutsch</SelectItem>
                  <SelectItem value="pt">🇵🇹 Português</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="active"
                checked={template.active}
                onChange={(e) => setTemplate(prev => ({ ...prev, active: e.target.checked }))}
              />
              <Label htmlFor="active">Active template</Label>
            </div>
          </CardContent>
        </Card>

        {/* Right Panel - Main Editor */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Template Editor</CardTitle>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={generateWithAI}
                    disabled={!template.category || isGenerating}
                  >
                    {isGenerating ? (
                      <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1" />
                    )}
                    {isGenerating ? 'Generating...' : 'AI Generate'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(template.content)}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
              
              {validationErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center space-x-2 text-red-600 mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="font-medium">Validation Errors</span>
                  </div>
                  <ul className="text-sm text-red-600 space-y-1">
                    {validationErrors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="edit">
                    <Code2 className="w-4 h-4 mr-1" />
                    Edit
                  </TabsTrigger>
                  <TabsTrigger value="preview">
                    <Eye className="w-4 h-4 mr-1" />
                    Preview
                  </TabsTrigger>
                  <TabsTrigger value="variables">
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Variables
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="edit" className="mt-4">
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <Label>Template Content</Label>
                        <div className="flex space-x-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{{variable}} for variables</Badge>
                          <Badge variant="outline">**bold** for formatting</Badge>
                        </div>
                      </div>
                      <Textarea
                        value={template.content}
                        onChange={(e) => setTemplate(prev => ({ ...prev, content: e.target.value }))}
                        placeholder="Enter your template content here. Use {{variable_name}} for dynamic content."
                        className="min-h-[400px] font-mono text-sm"
                      />
                    </div>
                    
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{template.content.length} characters</span>
                      <span>{template.content.split(' ').length} words</span>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="preview" className="mt-4">
                  <div className="space-y-4">
                    <div className="bg-gray-50 border rounded-lg p-4 min-h-[400px]">
                      <div className="bg-white rounded border p-4 shadow-sm">
                        <div 
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: renderPreview() }}
                        />
                      </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground">
                      <Info className="w-3 h-3 inline mr-1" />
                      This preview uses sample data. Actual values will be substituted when the template is used.
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="variables" className="mt-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-medium">Template Variables</h3>
                      <Button onClick={addCustomVariable} size="sm" variant="outline">
                        Add Variable
                      </Button>
                    </div>
                    
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {template.variables.map((variable, index) => (
                        <Card key={index} className="p-3">
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <Label className="text-xs">Name</Label>
                              <Input
                                value={variable.name}
                                onChange={(e) => handleVariableChange(index, 'name', e.target.value)}
                                className="h-7 text-xs"
                                placeholder="variable_name"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Type</Label>
                              <Select
                                value={variable.type}
                                onValueChange={(value) => handleVariableChange(index, 'type', value)}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="text">Text</SelectItem>
                                  <SelectItem value="number">Number</SelectItem>
                                  <SelectItem value="date">Date</SelectItem>
                                  <SelectItem value="time">Time</SelectItem>
                                  <SelectItem value="email">Email</SelectItem>
                                  <SelectItem value="phone">Phone</SelectItem>
                                  <SelectItem value="boolean">Boolean</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-2">
                              <Label className="text-xs">Description</Label>
                              <Input
                                value={variable.description}
                                onChange={(e) => handleVariableChange(index, 'description', e.target.value)}
                                className="h-7 text-xs"
                                placeholder="What this variable represents"
                              />
                            </div>
                            <div className="col-span-2 flex justify-between items-center">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  checked={variable.required}
                                  onChange={(e) => handleVariableChange(index, 'required', e.target.checked)}
                                  className="h-3 w-3"
                                />
                                <Label className="text-xs">Required</Label>
                              </div>
                              <Button
                                onClick={() => removeVariable(index)}
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-red-600 hover:text-red-700"
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end space-x-4 mt-6">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          {isSaving ? 'Saving...' : 'Save Template'}
        </Button>
      </div>
    </div>
  );
}