"use client";

import React from 'react';
import AuthMagicLinkForm from '@/components/AuthMagicLinkForm';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-gray-50 to-white px-4">
      <main className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold">Welcome back</h1>
          <p className="text-gray-600 mt-2">Sign in with a magic link — no password required.</p>
        </div>

        <AuthMagicLinkForm mode="signin" />
      </main>
    </div>
  );
}
