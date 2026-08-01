'use client';

import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../core/Button';

export type LeadFormFieldType = 'text' | 'email' | 'tel' | 'textarea';

export type LeadFormField = {
  /** Key used in the submitted values object; must be unique within `fields`. */
  name: string;
  label: string;
  type?: LeadFormFieldType;
  required?: boolean;
  placeholder?: string;
};

export type LeadFormValues = Record<string, string>;

export type LeadFormProps = {
  fields: LeadFormField[];
  submitLabel?: string;
  /** Note shown near the submit button explaining data handling. Defaults to a demonstrator-appropriate note. */
  privacyNote?: string;
  /**
   * Local mock submit hook — no network request is ever made by this component.
   * Return/resolve normally for a simulated success, or throw/reject to exercise
   * the error state. Optional; if omitted, every valid submit simulates success.
   */
  onMockSubmit?: (values: LeadFormValues) => void | Promise<void>;
};

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(fields: LeadFormField[], values: LeadFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.name] ?? '').trim();
    if (field.required && value.length === 0) {
      errors[field.name] = 'This field is required.';
      continue;
    }
    if (value.length > 0 && field.type === 'email' && !EMAIL_PATTERN.test(value)) {
      errors[field.name] = 'Enter a valid email address.';
    }
  }
  return errors;
}

/**
 * Local-mock lead-capture form. Never performs a network request — a valid
 * submit simulates a short delay and then shows a success message that makes
 * clear no real message was sent. Suitable for capability demonstrators only.
 */
export function LeadForm({
  fields,
  submitLabel = 'Submit',
  privacyNote = 'This is a demonstrator form. No data is transmitted, stored, or sent to any third party.',
  onMockSubmit,
}: LeadFormProps) {
  const [values, setValues] = useState<LeadFormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idPrefix = useId();

  const isSubmitting = status === 'submitting';

  function handleChange(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(fields, values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStatus('idle');
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);
    try {
      // Simulated local processing delay — no network call is made.
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      if (onMockSubmit) {
        await onMockSubmit(values);
      }
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong with this demonstration form.');
    }
  }

  if (status === 'success') {
    return (
      <div role="status" className="sc-surface rounded-lg border border-current/10 p-6">
        <p className="sc-body font-medium">Thank you — this is a demonstrator; no message was sent.</p>
        <p className="sc-body mt-2 text-sm opacity-70">{privacyNote}</p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
      {fields.map((field) => {
        const inputId = `${idPrefix}-${field.name}`;
        const errorId = `${inputId}-error`;
        const hasError = Boolean(errors[field.name]);
        const type = field.type ?? 'text';
        const commonProps = {
          id: inputId,
          name: field.name,
          value: values[field.name] ?? '',
          disabled: isSubmitting,
          placeholder: field.placeholder,
          'aria-required': field.required || undefined,
          'aria-invalid': hasError || undefined,
          'aria-describedby': hasError ? errorId : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            handleChange(field.name, event.target.value),
          className:
            'w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-not-allowed disabled:opacity-50',
        };

        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="sc-body text-sm font-medium">
              {field.label}
              {field.required ? (
                <span aria-hidden="true" className="ml-0.5 text-red-500">
                  *
                </span>
              ) : null}
            </label>
            {type === 'textarea' ? (
              <textarea {...commonProps} rows={4} />
            ) : (
              <input {...commonProps} type={type} />
            )}
            {hasError ? (
              <p id={errorId} role="alert" className="text-sm text-red-600">
                {errors[field.name]}
              </p>
            ) : null}
          </div>
        );
      })}

      {status === 'error' ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : null}

      <p className="sc-body text-xs opacity-70">{privacyNote}</p>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Submitting…' : submitLabel}
      </Button>
    </form>
  );
}
