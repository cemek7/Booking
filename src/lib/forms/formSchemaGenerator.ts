import { JSONSchema7 } from 'json-schema';

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'radio' | 'textarea' | 'date' | 'time' | 'datetime' | 'file' | 'phone' | 'color' | 'range' | 'url';
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  options?: Array<{
    label: string;
    value: string | number;
    disabled?: boolean;
  }>;
  defaultValue?: any;
  conditional?: {
    field: string;
    operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
    value: any;
  };
  grid?: {
    col?: number;
    row?: number;
    colSpan?: number;
    rowSpan?: number;
  };
  styling?: {
    className?: string;
    variant?: 'default' | 'outline' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
  };
}

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  fields: FormField[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  conditional?: {
    field: string;
    operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
    value: any;
  };
}

export interface FormSchema {
  id: string;
  title: string;
  description?: string;
  sections: FormSection[];
  submitButton?: {
    text: string;
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loadingText?: string;
  };
  layout?: {
    columns?: number;
    spacing?: 'compact' | 'comfortable' | 'spacious';
    alignment?: 'left' | 'center' | 'right';
  };
  validation?: {
    mode?: 'onChange' | 'onBlur' | 'onSubmit';
    reValidateMode?: 'onChange' | 'onBlur' | 'onSubmit';
  };
  styling?: {
    theme?: 'default' | 'minimal' | 'modern' | 'classic';
    className?: string;
  };
}

export interface FormRenderOptions {
  readonly?: boolean;
  disabled?: boolean;
  showValidation?: boolean;
  onFieldChange?: (fieldId: string, value: any) => void;
  onSectionToggle?: (sectionId: string, collapsed: boolean) => void;
  onSubmit?: (data: Record<string, any>) => Promise<void>;
  customComponents?: Record<string, React.ComponentType<any>>;
  tenant?: {
    id: string;
    branding?: {
      primaryColor?: string;
      secondaryColor?: string;
      fontFamily?: string;
    };
  };
}

class FormSchemaGenerator {
  /**
   * Generate form schema from JSON Schema
   */
  static fromJSONSchema(
    jsonSchema: JSONSchema7,
    options: {
      title?: string;
      description?: string;
      layout?: FormSchema['layout'];
      styling?: FormSchema['styling'];
    } = {}
  ): FormSchema {
    const fields = this.parseJSONSchemaProperties(jsonSchema.properties || {}, jsonSchema.required || []);
    
    return {
      id: jsonSchema.$id || `form_${Date.now()}`,
      title: options.title || jsonSchema.title || 'Generated Form',
      description: options.description || jsonSchema.description,
      sections: [
        {
          id: 'main',
          fields: fields
        }
      ],
      layout: options.layout,
      styling: options.styling,
      submitButton: {
        text: 'Submit',
        variant: 'default'
      },
      validation: {
        mode: 'onBlur',
        reValidateMode: 'onChange'
      }
    };
  }

  /**
   * Generate form schema for vertical-specific forms
   */
  static forVertical(
    vertical: 'beauty' | 'hospitality' | 'medicine',
    formType: 'booking' | 'registration' | 'consultation' | 'feedback' | 'intake',
    options: {
      includePayment?: boolean;
      includeConsent?: boolean;
      customFields?: FormField[];
      layout?: FormSchema['layout'];
    } = {}
  ): FormSchema {
    const sections: FormSection[] = [];

    // Basic information section
    sections.push(this.generateBasicInfoSection(vertical, formType));

    // Vertical-specific sections
    switch (vertical) {
      case 'beauty':
        sections.push(...this.generateBeautySections(formType));
        break;
      case 'hospitality':
        sections.push(...this.generateHospitalitySections(formType));
        break;
      case 'medicine':
        sections.push(...this.generateMedicineSections(formType));
        break;
    }

    // Additional sections
    if (options.includePayment && formType === 'booking') {
      sections.push(this.generatePaymentSection());
    }

    if (options.includeConsent) {
      sections.push(this.generateConsentSection(vertical));
    }

    // Custom fields
    if (options.customFields && options.customFields.length > 0) {
      sections.push({
        id: 'custom',
        title: 'Additional Information',
        fields: options.customFields
      });
    }

    return {
      id: `${vertical}_${formType}_${Date.now()}`,
      title: this.getFormTitle(vertical, formType),
      description: this.getFormDescription(vertical, formType),
      sections,
      layout: options.layout || { columns: 1, spacing: 'comfortable' },
      styling: { theme: 'modern' },
      submitButton: {
        text: this.getSubmitButtonText(formType),
        variant: 'default',
        loadingText: 'Processing...'
      },
      validation: {
        mode: 'onBlur',
        reValidateMode: 'onChange'
      }
    };
  }

  /**
   * Generate booking form schema
   */
  static forBooking(
    vertical: 'beauty' | 'hospitality' | 'medicine',
    serviceType: string,
    options: {
      allowMultipleServices?: boolean;
      requireDeposit?: boolean;
      includeMedicalHistory?: boolean;
      includePreferences?: boolean;
    } = {}
  ): FormSchema {
    const sections: FormSection[] = [];

    // Customer information
    sections.push({
      id: 'customer',
      title: 'Your Information',
      fields: [
        {
          id: 'firstName',
          type: 'text',
          label: 'First Name',
          required: true,
          grid: { col: 1, colSpan: 1 }
        },
        {
          id: 'lastName',
          type: 'text',
          label: 'Last Name',
          required: true,
          grid: { col: 2, colSpan: 1 }
        },
        {
          id: 'email',
          type: 'email',
          label: 'Email Address',
          required: true,
          grid: { col: 1, colSpan: 2 }
        },
        {
          id: 'phone',
          type: 'phone',
          label: 'Phone Number',
          required: true,
          grid: { col: 1, colSpan: 1 }
        },
        {
          id: 'dateOfBirth',
          type: 'date',
          label: 'Date of Birth',
          required: vertical === 'medicine',
          grid: { col: 2, colSpan: 1 }
        }
      ]
    });

    // Service selection
    sections.push({
      id: 'service',
      title: 'Service Details',
      fields: [
        {
          id: 'serviceType',
          type: options.allowMultipleServices ? 'multiselect' : 'select',
          label: 'Service(s)',
          required: true,
          options: this.getServiceOptions(vertical, serviceType)
        },
        {
          id: 'preferredDate',
          type: 'date',
          label: 'Preferred Date',
          required: true,
          validation: {
            min: new Date().toISOString().split('T')[0]
          } as any
        },
        {
          id: 'preferredTime',
          type: 'select',
          label: 'Preferred Time',
          required: true,
          options: this.getTimeSlotOptions()
        }
      ]
    });

    // Vertical-specific sections
    if (vertical === 'medicine' && options.includeMedicalHistory) {
      sections.push(this.generateMedicalHistorySection());
    }

    if (options.includePreferences) {
      sections.push(this.generatePreferencesSection(vertical));
    }

    // Payment section
    if (options.requireDeposit) {
      sections.push({
        id: 'payment',
        title: 'Payment Information',
        fields: [
          {
            id: 'paymentMethod',
            type: 'select',
            label: 'Payment Method',
            required: true,
            options: [
              { label: 'Credit Card', value: 'card' },
              { label: 'Debit Card', value: 'debit' },
              { label: 'PayPal', value: 'paypal' },
              { label: 'Pay at Visit', value: 'cash' }
            ]
          }
        ]
      });
    }

    return {
      id: `${vertical}_booking_${Date.now()}`,
      title: `Book ${serviceType}`,
      description: 'Please fill out the form below to book your appointment',
      sections,
      layout: { columns: 2, spacing: 'comfortable' },
      styling: { theme: 'modern' },
      submitButton: {
        text: 'Book Appointment',
        variant: 'default',
        loadingText: 'Creating Booking...'
      },
      validation: {
        mode: 'onBlur',
        reValidateMode: 'onChange'
      }
    };
  }

  // Private helper methods

  private static parseJSONSchemaProperties(
    properties: Record<string, JSONSchema7>,
    required: string[]
  ): FormField[] {
    return Object.entries(properties).map(([key, schema], index) => {
      const field: FormField = {
        id: key,
        type: this.mapJSONSchemaType(schema),
        label: schema.title || this.formatFieldLabel(key),
        description: schema.description,
        required: required.includes(key),
        grid: { col: (index % 2) + 1, colSpan: 1 }
      };

      // Handle validation
      if (schema.minimum !== undefined || schema.maximum !== undefined) {
        field.validation = {
          min: schema.minimum,
          max: schema.maximum
        };
      }

      if (schema.pattern) {
        field.validation = {
          ...field.validation,
          pattern: schema.pattern
        };
      }

      // Handle options for select fields
      if (schema.enum) {
        field.options = schema.enum.map(value => ({
          label: String(value),
          value: value as string | number
        }));
        field.type = 'select';
      }

      // Handle default values
      if (schema.default !== undefined) {
        field.defaultValue = schema.default;
      }

      return field;
    });
  }

  private static mapJSONSchemaType(schema: JSONSchema7): FormField['type'] {
    switch (schema.type) {
      case 'string':
        if (schema.format === 'email') return 'email';
        if (schema.format === 'date') return 'date';
        if (schema.format === 'date-time') return 'datetime';
        if (schema.format === 'time') return 'time';
        if (schema.format === 'uri') return 'url';
        if (schema.maxLength && schema.maxLength > 100) return 'textarea';
        return 'text';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'checkbox';
      case 'array':
        return 'multiselect';
      default:
        return 'text';
    }
  }

  private static formatFieldLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  private static generateBasicInfoSection(
    vertical: string,
    formType: string
  ): FormSection {
    const fields: FormField[] = [
      {
        id: 'firstName',
        type: 'text',
        label: 'First Name',
        required: true,
        grid: { col: 1, colSpan: 1 }
      },
      {
        id: 'lastName',
        type: 'text',
        label: 'Last Name',
        required: true,
        grid: { col: 2, colSpan: 1 }
      },
      {
        id: 'email',
        type: 'email',
        label: 'Email Address',
        required: true,
        grid: { col: 1, colSpan: 2 }
      },
      {
        id: 'phone',
        type: 'phone',
        label: 'Phone Number',
        required: true,
        grid: { col: 1, colSpan: 1 }
      }
    ];

    // Add date of birth for medical forms
    if (vertical === 'medicine') {
      fields.push({
        id: 'dateOfBirth',
        type: 'date',
        label: 'Date of Birth',
        required: true,
        grid: { col: 2, colSpan: 1 }
      });
    }

    return {
      id: 'basic_info',
      title: 'Personal Information',
      fields
    };
  }

  private static generateBeautySections(formType: string): FormSection[] {
    const sections: FormSection[] = [];

    if (formType === 'booking') {
      sections.push({
        id: 'beauty_preferences',
        title: 'Beauty Preferences',
        fields: [
          {
            id: 'skinType',
            type: 'select',
            label: 'Skin Type',
            options: [
              { label: 'Normal', value: 'normal' },
              { label: 'Oily', value: 'oily' },
              { label: 'Dry', value: 'dry' },
              { label: 'Combination', value: 'combination' },
              { label: 'Sensitive', value: 'sensitive' }
            ]
          },
          {
            id: 'allergies',
            type: 'textarea',
            label: 'Known Allergies or Sensitivities',
            placeholder: 'List any known allergies or sensitivities to beauty products'
          },
          {
            id: 'currentProducts',
            type: 'textarea',
            label: 'Current Skincare Routine',
            placeholder: 'Describe your current skincare products and routine'
          }
        ]
      });
    }

    return sections;
  }

  private static generateHospitalitySections(formType: string): FormSection[] {
    const sections: FormSection[] = [];

    if (formType === 'booking') {
      sections.push({
        id: 'stay_preferences',
        title: 'Stay Preferences',
        fields: [
          {
            id: 'roomType',
            type: 'select',
            label: 'Room Type',
            options: [
              { label: 'Standard Room', value: 'standard' },
              { label: 'Deluxe Room', value: 'deluxe' },
              { label: 'Suite', value: 'suite' },
              { label: 'Family Room', value: 'family' }
            ]
          },
          {
            id: 'specialRequests',
            type: 'textarea',
            label: 'Special Requests',
            placeholder: 'Any special requirements or requests'
          },
          {
            id: 'arrivalTime',
            type: 'time',
            label: 'Expected Arrival Time'
          }
        ]
      });
    }

    return sections;
  }

  private static generateMedicineSections(formType: string): FormSection[] {
    const sections: FormSection[] = [];

    if (formType === 'booking' || formType === 'consultation') {
      sections.push({
        id: 'medical_info',
        title: 'Medical Information',
        fields: [
          {
            id: 'chiefComplaint',
            type: 'textarea',
            label: 'Chief Complaint',
            placeholder: 'Describe your primary concern or reason for visit',
            required: true
          },
          {
            id: 'currentMedications',
            type: 'textarea',
            label: 'Current Medications',
            placeholder: 'List all current medications, dosages, and frequency'
          },
          {
            id: 'medicalHistory',
            type: 'textarea',
            label: 'Medical History',
            placeholder: 'Previous surgeries, chronic conditions, etc.'
          }
        ]
      });
    }

    return sections;
  }

  private static generatePaymentSection(): FormSection {
    return {
      id: 'payment',
      title: 'Payment Information',
      fields: [
        {
          id: 'paymentMethod',
          type: 'select',
          label: 'Payment Method',
          required: true,
          options: [
            { label: 'Credit Card', value: 'card' },
            { label: 'Debit Card', value: 'debit' },
            { label: 'PayPal', value: 'paypal' },
            { label: 'Insurance', value: 'insurance' }
          ]
        },
        {
          id: 'billingAddress',
          type: 'textarea',
          label: 'Billing Address',
          conditional: {
            field: 'paymentMethod',
            operator: 'not_equals',
            value: 'insurance'
          }
        }
      ]
    };
  }

  private static generateConsentSection(vertical: string): FormSection {
    return {
      id: 'consent',
      title: 'Consent & Agreements',
      fields: [
        {
          id: 'termsAccepted',
          type: 'checkbox',
          label: 'I agree to the Terms of Service',
          required: true
        },
        {
          id: 'privacyAccepted',
          type: 'checkbox',
          label: 'I agree to the Privacy Policy',
          required: true
        },
        {
          id: 'medicalConsent',
          type: 'checkbox',
          label: 'I consent to medical treatment',
          required: vertical === 'medicine'
        }
      ]
    };
  }

  private static generateMedicalHistorySection(): FormSection {
    return {
      id: 'medical_history',
      title: 'Medical History',
      fields: [
        {
          id: 'previousSurgeries',
          type: 'textarea',
          label: 'Previous Surgeries',
          placeholder: 'List any previous surgeries and dates'
        },
        {
          id: 'chronicConditions',
          type: 'textarea',
          label: 'Chronic Conditions',
          placeholder: 'Diabetes, hypertension, etc.'
        },
        {
          id: 'familyHistory',
          type: 'textarea',
          label: 'Family Medical History',
          placeholder: 'Relevant family medical history'
        },
        {
          id: 'emergencyContact',
          type: 'text',
          label: 'Emergency Contact',
          placeholder: 'Name and phone number',
          required: true
        }
      ]
    };
  }

  private static generatePreferencesSection(vertical: string): FormSection {
    const commonFields: FormField[] = [
      {
        id: 'communicationPreference',
        type: 'select',
        label: 'Preferred Communication Method',
        options: [
          { label: 'Email', value: 'email' },
          { label: 'SMS', value: 'sms' },
          { label: 'Phone Call', value: 'phone' },
          { label: 'WhatsApp', value: 'whatsapp' }
        ]
      },
      {
        id: 'specialNotes',
        type: 'textarea',
        label: 'Special Notes or Requests',
        placeholder: 'Any additional information or special requests'
      }
    ];

    return {
      id: 'preferences',
      title: 'Preferences',
      fields: commonFields
    };
  }

  private static getFormTitle(vertical: string, formType: string): string {
    const titles: Record<string, Record<string, string>> = {
      beauty: {
        booking: 'Beauty Appointment Booking',
        registration: 'Beauty Client Registration',
        consultation: 'Beauty Consultation Form',
        feedback: 'Beauty Service Feedback'
      },
      hospitality: {
        booking: 'Room Reservation',
        registration: 'Guest Registration',
        feedback: 'Guest Feedback'
      },
      medicine: {
        booking: 'Medical Appointment Booking',
        registration: 'Patient Registration',
        consultation: 'Medical Consultation',
        intake: 'Patient Intake Form',
        feedback: 'Patient Feedback'
      }
    };

    return titles[vertical]?.[formType] || 'Form';
  }

  private static getFormDescription(vertical: string, formType: string): string {
    const descriptions: Record<string, Record<string, string>> = {
      beauty: {
        booking: 'Book your beauty treatment appointment',
        registration: 'Register as a new beauty client',
        consultation: 'Tell us about your beauty goals'
      },
      hospitality: {
        booking: 'Reserve your stay with us',
        registration: 'Complete your guest registration'
      },
      medicine: {
        booking: 'Schedule your medical appointment',
        registration: 'Register as a new patient',
        consultation: 'Prepare for your medical consultation',
        intake: 'Complete your patient intake information'
      }
    };

    return descriptions[vertical]?.[formType] || 'Please fill out this form';
  }

  private static getSubmitButtonText(formType: string): string {
    const buttonTexts: Record<string, string> = {
      booking: 'Book Appointment',
      registration: 'Complete Registration',
      consultation: 'Submit Consultation',
      intake: 'Submit Information',
      feedback: 'Submit Feedback'
    };

    return buttonTexts[formType] || 'Submit';
  }

  private static getServiceOptions(vertical: string, serviceType: string): Array<{label: string; value: string}> {
    const services: Record<string, Array<{label: string; value: string}>> = {
      beauty: [
        { label: 'Facial Treatment', value: 'facial' },
        { label: 'Massage Therapy', value: 'massage' },
        { label: 'Hair Styling', value: 'hair' },
        { label: 'Manicure/Pedicure', value: 'nails' },
        { label: 'Eyebrow/Lash Services', value: 'brows_lashes' }
      ],
      hospitality: [
        { label: 'Room Booking', value: 'room' },
        { label: 'Event Space', value: 'event' },
        { label: 'Restaurant Reservation', value: 'restaurant' },
        { label: 'Spa Services', value: 'spa' }
      ],
      medicine: [
        { label: 'General Consultation', value: 'consultation' },
        { label: 'Follow-up Visit', value: 'followup' },
        { label: 'Specialist Consultation', value: 'specialist' },
        { label: 'Diagnostic Test', value: 'diagnostic' }
      ]
    };

    return services[vertical] || [{ label: serviceType, value: serviceType }];
  }

  private static getTimeSlotOptions(): Array<{label: string; value: string}> {
    const timeSlots = [];
    for (let hour = 9; hour <= 17; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const label = new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        timeSlots.push({ label, value: time });
      }
    }
    return timeSlots;
  }
}

export { FormSchemaGenerator };