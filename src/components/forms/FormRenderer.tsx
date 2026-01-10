import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import { 
  ChevronDown, 
  ChevronUp, 
  Upload, 
  Calendar,
  Clock,
  Phone,
  Mail,
  User,
  FileText,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  FormSchema, 
  FormField, 
  FormSection, 
  FormRenderOptions 
} from '@/lib/forms/formSchemaGenerator';

interface FormRendererProps {
  schema: FormSchema;
  initialData?: Record<string, any>;
  options?: FormRenderOptions;
  className?: string;
}

interface FieldComponentProps {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  disabled?: boolean;
  readonly?: boolean;
  tenantBranding?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
  };
}

const FieldComponent: React.FC<FieldComponentProps> = ({
  field,
  value,
  onChange,
  error,
  disabled = false,
  readonly = false,
  tenantBranding
}) => {
  const getFieldIcon = (type: FormField['type']) => {
    switch (type) {
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      case 'date':
      case 'datetime':
        return <Calendar className="h-4 w-4" />;
      case 'time':
        return <Clock className="h-4 w-4" />;
      case 'file':
        return <Upload className="h-4 w-4" />;
      case 'textarea':
        return <FileText className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  const renderField = () => {
    const commonProps = {
      disabled: disabled || readonly,
      className: cn(
        field.styling?.className,
        error && "border-red-500",
        readonly && "bg-gray-50"
      )
    };

    switch (field.type) {
      case 'text':
      case 'email':
      case 'url':
      case 'phone':
        return (
          <div className="relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              {getFieldIcon(field.type)}
            </div>
            <Input
              {...commonProps}
              type={field.type === 'phone' ? 'tel' : field.type}
              placeholder={field.placeholder}
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              className={cn(commonProps.className, "pl-10")}
            />
          </div>
        );

      case 'number':
      case 'range':
        return (
          <Input
            {...commonProps}
            type="number"
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => onChange(Number(e.target.value))}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );

      case 'date':
        return (
          <div className="relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              <Calendar className="h-4 w-4" />
            </div>
            <Input
              {...commonProps}
              type="date"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              min={field.validation?.min as string}
              max={field.validation?.max as string}
              className={cn(commonProps.className, "pl-10")}
            />
          </div>
        );

      case 'time':
        return (
          <div className="relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              <Clock className="h-4 w-4" />
            </div>
            <Input
              {...commonProps}
              type="time"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              className={cn(commonProps.className, "pl-10")}
            />
          </div>
        );

      case 'datetime':
        return (
          <Input
            {...commonProps}
            type="datetime-local"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'color':
        return (
          <Input
            {...commonProps}
            type="color"
            value={value || '#000000'}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'textarea':
        return (
          <Textarea
            {...commonProps}
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
          />
        );

      case 'select':
        return (
          <Select
            disabled={disabled || readonly}
            value={value || ''}
            onValueChange={onChange}
          >
            <SelectTrigger className={commonProps.className}>
              <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem
                  key={option.value}
                  value={String(option.value)}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'multiselect':
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2">
            {field.options?.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`${field.id}_${option.value}`}
                  checked={selectedValues.includes(option.value)}
                  disabled={disabled || readonly || option.disabled}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange([...selectedValues, option.value]);
                    } else {
                      onChange(selectedValues.filter(v => v !== option.value));
                    }
                  }}
                />
                <Label
                  htmlFor={`${field.id}_${option.value}`}
                  className={option.disabled ? 'text-gray-400' : ''}
                >
                  {option.label}
                </Label>
              </div>
            ))}
          </div>
        );

      case 'checkbox':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.id}
              checked={Boolean(value)}
              disabled={disabled || readonly}
              onCheckedChange={onChange}
            />
            <Label
              htmlFor={field.id}
              className={cn(
                "text-sm font-normal",
                field.required && "after:content-['*'] after:ml-0.5 after:text-red-500"
              )}
            >
              {field.label}
            </Label>
          </div>
        );

      case 'radio':
        return (
          <RadioGroup
            disabled={disabled || readonly}
            value={value || ''}
            onValueChange={onChange}
          >
            {field.options?.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <RadioGroupItem
                  value={String(option.value)}
                  id={`${field.id}_${option.value}`}
                  disabled={option.disabled}
                />
                <Label
                  htmlFor={`${field.id}_${option.value}`}
                  className={option.disabled ? 'text-gray-400' : ''}
                >
                  {option.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        );

      case 'file':
        return (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
            <div className="text-center">
              <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
              <Input
                {...commonProps}
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onChange(file);
                  }
                }}
                className="hidden"
                id={`file_${field.id}`}
              />
              <Label
                htmlFor={`file_${field.id}`}
                className="cursor-pointer text-sm text-blue-600 hover:text-blue-500"
              >
                Click to upload or drag and drop
              </Label>
              <p className="text-xs text-gray-500 mt-1">
                {field.placeholder || 'Select a file to upload'}
              </p>
            </div>
          </div>
        );

      default:
        return (
          <Input
            {...commonProps}
            type="text"
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  };

  return (
    <div className={cn(
      "space-y-1",
      field.grid?.colSpan && `col-span-${field.grid.colSpan}`,
      field.grid?.col && `col-start-${field.grid.col}`
    )}>
      {field.type !== 'checkbox' && (
        <Label
          htmlFor={field.id}
          className={cn(
            "text-sm font-medium",
            field.required && "after:content-['*'] after:ml-0.5 after:text-red-500",
            error && "text-red-600"
          )}
        >
          {field.label}
        </Label>
      )}

      {renderField()}

      {field.description && !error && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}

      {error && (
        <div className="flex items-center space-x-1 text-red-600">
          <AlertCircle className="h-3 w-3" />
          <p className="text-xs">{error}</p>
        </div>
      )}
    </div>
  );
};

const SectionComponent: React.FC<{
  section: FormSection;
  values: Record<string, any>;
  errors: Record<string, any>;
  onChange: (fieldId: string, value: any) => void;
  options?: FormRenderOptions;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
}> = ({ section, values, errors, onChange, options, collapsed, onToggle }) => {
  const shouldShowSection = () => {
    if (!section.conditional) return true;

    const fieldValue = values[section.conditional.field];
    const conditionValue = section.conditional.value;

    switch (section.conditional.operator) {
      case 'equals':
        return fieldValue === conditionValue;
      case 'not_equals':
        return fieldValue !== conditionValue;
      case 'contains':
        return String(fieldValue).includes(String(conditionValue));
      case 'greater_than':
        return Number(fieldValue) > Number(conditionValue);
      case 'less_than':
        return Number(fieldValue) < Number(conditionValue);
      default:
        return true;
    }
  };

  const shouldShowField = (field: FormField) => {
    if (!field.conditional) return true;

    const fieldValue = values[field.conditional.field];
    const conditionValue = field.conditional.value;

    switch (field.conditional.operator) {
      case 'equals':
        return fieldValue === conditionValue;
      case 'not_equals':
        return fieldValue !== conditionValue;
      case 'contains':
        return String(fieldValue).includes(String(conditionValue));
      case 'greater_than':
        return Number(fieldValue) > Number(conditionValue);
      case 'less_than':
        return Number(fieldValue) < Number(conditionValue);
      default:
        return true;
    }
  };

  if (!shouldShowSection()) {
    return null;
  }

  const visibleFields = section.fields.filter(shouldShowField);
  const gridCols = Math.max(2, Math.max(...visibleFields.map(f => (f.grid?.col || 1) + (f.grid?.colSpan || 1) - 1)));

  const content = (
    <div className={cn(
      "grid gap-4",
      `grid-cols-${gridCols}`
    )}>
      {visibleFields.map((field) => (
        <FieldComponent
          key={field.id}
          field={field}
          value={values[field.id]}
          onChange={(value) => {
            onChange(field.id, value);
            options?.onFieldChange?.(field.id, value);
          }}
          error={errors[field.id]?.message}
          disabled={options?.disabled}
          readonly={options?.readonly}
          tenantBranding={options?.tenant?.branding}
        />
      ))}
    </div>
  );

  if (section.collapsible) {
    return (
      <Card>
        <Collapsible open={!collapsed} onOpenChange={onToggle}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors">
              <CardTitle className="flex items-center justify-between">
                <span>{section.title}</span>
                {collapsed ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </CardTitle>
              {section.description && (
                <p className="text-sm text-gray-600">{section.description}</p>
              )}
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>{content}</CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  }

  return (
    <Card>
      {(section.title || section.description) && (
        <CardHeader>
          {section.title && <CardTitle>{section.title}</CardTitle>}
          {section.description && (
            <p className="text-sm text-gray-600">{section.description}</p>
          )}
        </CardHeader>
      )}
      <CardContent>{content}</CardContent>
    </Card>
  );
};

export default function FormRenderer({ 
  schema, 
  initialData = {}, 
  options = {},
  className 
}: FormRendererProps) {
  const [sectionCollapseState, setSectionCollapseState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    schema.sections.forEach(section => {
      if (section.collapsible) {
        initial[section.id] = section.defaultCollapsed || false;
      }
    });
    return initial;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generate validation schema
  const generateValidationSchema = () => {
    const schemaFields: Record<string, z.ZodSchema> = {};

    schema.sections.forEach(section => {
      section.fields.forEach(field => {
        let fieldSchema: z.ZodSchema = z.any();

        switch (field.type) {
          case 'text':
          case 'textarea':
          case 'url':
            fieldSchema = z.string();
            break;
          case 'email':
            fieldSchema = z.string().email('Invalid email address');
            break;
          case 'number':
          case 'range':
            fieldSchema = z.number();
            break;
          case 'date':
          case 'datetime':
          case 'time':
            fieldSchema = z.string();
            break;
          case 'checkbox':
            fieldSchema = z.boolean();
            break;
          case 'multiselect':
            fieldSchema = z.array(z.string());
            break;
          case 'phone':
            fieldSchema = z.string().regex(/^[\+]?[1-9][\d]{0,15}$/, 'Invalid phone number');
            break;
          default:
            fieldSchema = z.string();
        }

        // Add validation constraints
        if (field.validation) {
          if (field.validation.min !== undefined && fieldSchema instanceof z.ZodString) {
            fieldSchema = fieldSchema.min(field.validation.min, `Minimum length is ${field.validation.min}`);
          }
          if (field.validation.max !== undefined && fieldSchema instanceof z.ZodString) {
            fieldSchema = fieldSchema.max(field.validation.max, `Maximum length is ${field.validation.max}`);
          }
          if (field.validation.pattern) {
            fieldSchema = (fieldSchema as z.ZodString).regex(
              new RegExp(field.validation.pattern),
              field.validation.message || 'Invalid format'
            );
          }
        }

        // Make field optional or required
        if (field.required) {
          if (fieldSchema instanceof z.ZodString) {
            fieldSchema = fieldSchema.min(1, `${field.label} is required`);
          } else if (fieldSchema instanceof z.ZodArray) {
            fieldSchema = fieldSchema.min(1, `${field.label} is required`);
          }
        } else {
          fieldSchema = fieldSchema.optional();
        }

        schemaFields[field.id] = fieldSchema;
      });
    });

    return z.object(schemaFields);
  };

  const validationSchema = generateValidationSchema();

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid }
  } = useForm({
    resolver: zodResolver(validationSchema),
    defaultValues: initialData,
    mode: schema.validation?.mode || 'onBlur',
    reValidateMode: schema.validation?.reValidateMode || 'onChange'
  });

  const watchedValues = watch();

  const handleFormSubmit = async (data: Record<string, any>) => {
    if (options.onSubmit) {
      setIsSubmitting(true);
      try {
        await options.onSubmit(data);
      } catch (error) {
        console.error('Form submission error:', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleSectionToggle = (sectionId: string, collapsed: boolean) => {
    setSectionCollapseState(prev => ({
      ...prev,
      [sectionId]: collapsed
    }));
    options.onSectionToggle?.(sectionId, collapsed);
  };

  // Apply tenant branding
  const brandingStyles = options.tenant?.branding ? {
    '--primary-color': options.tenant.branding.primaryColor || '#000000',
    '--secondary-color': options.tenant.branding.secondaryColor || '#666666',
    '--font-family': options.tenant.branding.fontFamily || 'inherit',
  } as React.CSSProperties : {};

  return (
    <div 
      className={cn("max-w-4xl mx-auto p-6", className)}
      style={brandingStyles}
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
        {/* Form Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">{schema.title}</h1>
          {schema.description && (
            <p className="text-lg text-gray-600">{schema.description}</p>
          )}
        </div>

        <Separator />

        {/* Form Sections */}
        <div className="space-y-6">
          {schema.sections.map((section) => (
            <Controller
              key={section.id}
              control={control}
              name={section.id as any}
              render={() => (
                <SectionComponent
                  section={section}
                  values={watchedValues}
                  errors={errors}
                  onChange={(fieldId, value) => setValue(fieldId, value)}
                  options={options}
                  collapsed={sectionCollapseState[section.id] || false}
                  onToggle={(collapsed) => handleSectionToggle(section.id, collapsed)}
                />
              )}
            />
          ))}
        </div>

        {/* Form Footer */}
        <Separator />
        
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            {isValid ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>Form is ready to submit</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <span>Please complete all required fields</span>
              </>
            )}
          </div>

          <Button
            type="submit"
            size={schema.submitButton?.size || 'default'}
            variant={schema.submitButton?.variant || 'default'}
            disabled={isSubmitting || options.disabled || !isValid}
            className={cn(
              isSubmitting && "opacity-50 cursor-not-allowed"
            )}
          >
            {isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                {schema.submitButton?.loadingText || 'Processing...'}
              </>
            ) : (
              schema.submitButton?.text || 'Submit'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}