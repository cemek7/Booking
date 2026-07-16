import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig = {
  experimental: {
    webpackBuildWorker: false,
  },

  // Keep Winston and its file-transport dependency out of the Node.js server bundle
  // (Turbopack will leave these as native Node.js require() calls).
  serverExternalPackages: ['winston', 'winston-daily-rotate-file', 'file-stream-rotator'],

  // For browser/edge builds, redirect winston packages to a no-op shim so the
  // bundler never tries to resolve Node.js `fs`. The runtime-aware logger in
  // src/lib/logger/index.ts already guards all winston calls behind `useWinston`,
  // so the shim is never actually called at runtime.
  turbopack: {
    resolveAlias: {
      winston: {
        browser: './src/lib/logger/browser-shim',
        default: 'winston',
      },
      'winston-daily-rotate-file': {
        browser: './src/lib/logger/browser-shim',
        default: 'winston-daily-rotate-file',
      },
      'file-stream-rotator': {
        browser: './src/lib/logger/browser-shim',
        default: 'file-stream-rotator',
      },
    },
  },

  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        winston: path.join(process.cwd(), 'src/lib/logger/browser-shim'),
        'winston-daily-rotate-file': path.join(process.cwd(), 'src/lib/logger/browser-shim'),
        'file-stream-rotator': path.join(process.cwd(), 'src/lib/logger/browser-shim'),
      };
    }

    return config;
  },

  async headers() {
    const commonHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ];

    return [
      {
        source: '/(.*)',
        headers: commonHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
});
