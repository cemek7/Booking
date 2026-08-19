'use client';

import React, { useState } from 'react';

interface CloseAccountSectionProps {
  tenantId: string;
  tenantName: string;
  lifecycleState: 'active' | 'scheduled_for_deletion' | 'purging' | 'purged';
  scheduledPurgeAt?: string | null;
}

export default function CloseAccountSection({
  tenantId,
  tenantName,
  lifecycleState,
  scheduledPurgeAt,
}: CloseAccountSectionProps) {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const isConfirmed = confirmText === tenantName;

  async function handleCloseAccount() {
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/offboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(
          (data as { message?: string }).message || 'Something went wrong. Please try again.'
        );
      } else {
        setSuccessMessage(
          'Your account is scheduled for deletion. You will receive a data export via email within 24 hours.'
        );
      }
    } catch {
      setErrorMessage('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReactivate() {
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(
          (data as { message?: string }).message || 'Reactivation failed. Please try again.'
        );
      } else {
        setSuccessMessage('Your account has been reactivated.');
      }
    } catch {
      setErrorMessage('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (lifecycleState !== 'active') {
    return (
      <section aria-labelledby="close-account-heading">
        <h2 id="close-account-heading">Account Status</h2>
        <div role="alert" style={{ padding: '1rem', border: '1px solid #f59e0b', borderRadius: '0.375rem', background: '#fffbeb' }}>
          <p>
            <strong>This account is scheduled for deletion.</strong>
            {scheduledPurgeAt && (
              <> Scheduled purge date: {new Date(scheduledPurgeAt).toLocaleDateString()}</>
            )}
          </p>
          <p>Changed your mind? You can reactivate your account before the purge date.</p>
          {successMessage && <p style={{ color: 'green' }}>{successMessage}</p>}
          {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
          <button
            type="button"
            onClick={handleReactivate}
            disabled={loading}
            style={{ marginTop: '0.75rem', padding: '0.5rem 1rem', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Reactivating…' : 'Reactivate'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="close-account-heading">
      <h2 id="close-account-heading">Close account</h2>
      <div style={{ padding: '1rem', border: '1px solid #ef4444', borderRadius: '0.375rem' }}>
        <p>
          <strong>Before you close your account, please read carefully:</strong>
        </p>
        <ul>
          <li>You have a <strong>30-day grace period</strong> during which you can reactivate your account.</li>
          <li>Any remaining <strong>cash wallet balance</strong> will be refunded.</li>
          <li><strong>AI credits</strong> are non-refundable and will be forfeited.</li>
          <li>A full <strong>data export</strong> will be emailed to you within 24 hours.</li>
        </ul>

        <div style={{ marginTop: '1rem' }}>
          <label htmlFor="confirm-tenant-name">
            Type <strong>{tenantName}</strong> to confirm
          </label>
          <br />
          <input
            id="confirm-tenant-name"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="Type tenant name to confirm"
            placeholder={tenantName}
            style={{ marginTop: '0.25rem', padding: '0.375rem 0.5rem', width: '100%', maxWidth: '320px' }}
          />
        </div>

        {successMessage && <p style={{ color: 'green', marginTop: '0.75rem' }}>{successMessage}</p>}
        {errorMessage && <p style={{ color: 'red', marginTop: '0.75rem' }}>{errorMessage}</p>}

        <button
          type="button"
          onClick={handleCloseAccount}
          disabled={!isConfirmed || loading}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: isConfirmed && !loading ? '#ef4444' : '#fca5a5',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: isConfirmed && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? 'Closing…' : 'Close account'}
        </button>
      </div>
    </section>
  );
}
