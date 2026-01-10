"use client";

import React from 'react';
import AuthMagicLinkForm from '@/components/AuthMagicLinkForm';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-gray-50 to-white px-4">
      <main className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold">Create an account</h1>
          <p className="text-gray-600 mt-2">Enter your email and we’ll send a magic link to get started.</p>
        </div>

        <AuthMagicLinkForm mode="signup" />
      </main>
    </div>
  );
}
