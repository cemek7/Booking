"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";

/**
 * The Techclave contact form. Unlike the showcase demonstrator this one really
 * submits: every state below reflects what the server actually did, and a
 * success message is only ever shown after a 2xx.
 */

const INTERESTS = [
  "Booka for my business",
  "A custom build",
  "Partnership",
  "Press or speaking",
  "Something else",
];

type Status = "idle" | "submitting" | "success" | "error";

type Fields = {
  name: string;
  email: string;
  company: string;
  phone: string;
  interest: string;
  message: string;
  website: string;
};

const EMPTY: Fields = {
  name: "",
  email: "",
  company: "",
  phone: "",
  interest: "",
  message: "",
  website: "",
};

const inputClass =
  "mt-2 w-full rounded-2xl border border-[#d8d3c4] bg-white px-4 py-3 text-[15px] text-[#10211a] shadow-sm outline-none transition placeholder:text-[#9aa29e] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function ContactForm() {
  const formId = useId();
  const [values, setValues] = useState<Fields>(EMPTY);
  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set<K extends keyof Fields>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (response.ok) {
        setStatus("success");
        setValues(EMPTY);
        return;
      }

      const body = await response.json().catch(() => ({}));
      setFieldErrors(body.fields ?? {});
      setFormError(
        body.error ?? "We could not send that. Please try again shortly.",
      );
      setStatus("error");
    } catch {
      // A network failure must never look like a send.
      setFormError(
        "We could not reach the server. Check your connection and try again.",
      );
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="rounded-[1.8rem] border border-emerald-200 bg-emerald-50/70 p-8 text-center"
      >
        <h2 className="text-2xl font-semibold text-[#10211a]">
          Your message is with us.
        </h2>
        <p className="mt-3 text-[15px] leading-7 text-[#4f5d59]">
          We read every one and reply to the address you gave, usually within a
          working day.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-6 rounded-full border border-[#c8d4ca] bg-white px-5 py-2.5 text-sm font-medium text-[#1d3326] transition hover:border-emerald-300"
        >
          Send another
        </button>
      </div>
    );
  }

  const busy = status === "submitting";

  function error(field: keyof Fields) {
    return fieldErrors[field];
  }

  function describedBy(field: keyof Fields) {
    return error(field) ? `${formId}-${field}-error` : undefined;
  }

  function fieldError(field: keyof Fields) {
    const message = error(field);
    if (!message) return null;
    return (
      <p id={`${formId}-${field}-error`} className="mt-2 text-sm text-red-700">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {formError ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {formError}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${formId}-name`}
            className="text-sm font-medium text-[#10211a]"
          >
            Your name
          </label>
          <input
            id={`${formId}-name`}
            name="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={!!error("name")}
            aria-describedby={describedBy("name")}
            className={inputClass}
            placeholder="Ada Okafor"
          />
          {fieldError("name")}
        </div>

        <div>
          <label
            htmlFor={`${formId}-email`}
            className="text-sm font-medium text-[#10211a]"
          >
            Email
          </label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            aria-invalid={!!error("email")}
            aria-describedby={describedBy("email")}
            className={inputClass}
            placeholder="ada@yourbusiness.ng"
          />
          {fieldError("email")}
        </div>

        <div>
          <label
            htmlFor={`${formId}-company`}
            className="text-sm font-medium text-[#10211a]"
          >
            Business{" "}
            <span className="font-normal text-[#8a8f8c]">(optional)</span>
          </label>
          <input
            id={`${formId}-company`}
            name="company"
            value={values.company}
            onChange={(e) => set("company", e.target.value)}
            className={inputClass}
            placeholder="Glow Studio"
          />
        </div>

        <div>
          <label
            htmlFor={`${formId}-phone`}
            className="text-sm font-medium text-[#10211a]"
          >
            WhatsApp number{" "}
            <span className="font-normal text-[#8a8f8c]">(optional)</span>
          </label>
          <input
            id={`${formId}-phone`}
            name="phone"
            type="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            className={inputClass}
            placeholder="0801 234 5678"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={`${formId}-interest`}
          className="text-sm font-medium text-[#10211a]"
        >
          What is this about?
        </label>
        <select
          id={`${formId}-interest`}
          name="interest"
          value={values.interest}
          onChange={(e) => set("interest", e.target.value)}
          className={inputClass}
        >
          <option value="">Choose one</option>
          {INTERESTS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor={`${formId}-message`}
          className="text-sm font-medium text-[#10211a]"
        >
          What do you need?
        </label>
        <textarea
          id={`${formId}-message`}
          name="message"
          rows={6}
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
          aria-invalid={!!error("message")}
          aria-describedby={describedBy("message")}
          className={inputClass}
          placeholder="Tell us how enquiries reach you today, and what keeps going wrong."
        />
        {fieldError("message")}
      </div>

      {/* Honeypot. Hidden from people and from screen readers; only bots fill it. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor={`${formId}-website`}>Website</label>
        <input
          id={`${formId}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-emerald-600 px-7 py-3 text-sm font-medium text-white shadow-[0_14px_34px_rgba(5,150,105,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-[#9cbfae] disabled:shadow-none"
        >
          {busy ? "Sending…" : "Send message"}
        </button>
        <p className="text-sm text-[#6c756f]">
          We use this only to reply to you.
        </p>
      </div>
    </form>
  );
}
