'use client';

import { useState, useEffect } from 'react';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DemoModal({ isOpen, onClose }: DemoModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [brand, setBrand] = useState('');
  const [website, setWebsite] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setName('');
      setEmail('');
      setBrand('');
      setWebsite('');
      setIsSubmitting(false);
      setIsSuccess(false);
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, brand, website }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Something went wrong');
      }
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(13,4,55,0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0D0437',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          padding: '2.5rem',
          width: '100%',
          maxWidth: 480,
          margin: '1rem',
          position: 'relative',
          color: '#F5F4FF',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            fontSize: '1.25rem',
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          &times;
        </button>

        {isSuccess ? (
          /* ---- Success state ---- */
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: '1rem' }}>
              <circle cx="24" cy="24" r="23" stroke="#00B4D8" strokeWidth="2" />
              <path d="M15 24l6 6 12-12" stroke="#00B4D8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3 style={{
              fontFamily: "var(--font-exo2), 'Exo 2', sans-serif",
              fontWeight: 700,
              fontSize: '1.25rem',
              marginBottom: '0.5rem',
            }}>
              We&apos;ll be in touch soon.
            </h3>
            <p style={{
              fontSize: '0.875rem',
              color: 'rgba(245,244,255,0.5)',
              lineHeight: 1.6,
              marginBottom: '1rem',
            }}>
              Check your inbox &mdash; we&apos;ll reach out to schedule your intelligence brief.
            </p>
            <span style={{
              fontFamily: "var(--font-mono), 'DM Mono', monospace",
              fontSize: '0.75rem',
              color: '#00B4D8',
            }}>
              admin@shadovi.com
            </span>
          </div>
        ) : (
          /* ---- Form state ---- */
          <>
            <p style={{
              fontFamily: "var(--font-mono), 'DM Mono', monospace",
              fontSize: '0.75rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#00B4D8',
              marginBottom: '0.5rem',
            }}>
              GET A DEMO
            </p>
            <h2 style={{
              fontFamily: "var(--font-exo2), 'Exo 2', sans-serif",
              fontWeight: 700,
              fontSize: '1.5rem',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              marginBottom: 0,
            }}>
              See your brand through the eyes of AI.
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
              <Field label="YOUR NAME" type="text" placeholder="Alex Chen" value={name} onChange={setName} />
              <Field label="WORK EMAIL *" type="email" placeholder="alex@company.com" value={email} onChange={setEmail} required />
              <Field label="BRAND / COMPANY *" type="text" placeholder="Acme Inc." value={brand} onChange={setBrand} required />
              <Field label="WEBSITE" type="url" placeholder="https://acme.com" value={website} onChange={setWebsite} />

              <p style={{
                fontFamily: "var(--font-mono), 'DM Mono', monospace",
                fontSize: '0.6875rem',
                color: 'rgba(255,255,255,0.3)',
                margin: 0,
              }}>
                We&apos;ll run a quick AI audit on your brand before the call.
              </p>

              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  padding: '0.875rem',
                  background: 'linear-gradient(135deg, #FF4B6E, #7B5EA7)',
                  color: '#fff',
                  fontFamily: "var(--font-exo2), 'Exo 2', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  borderRadius: 8,
                  border: 'none',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                {isSubmitting ? 'Sending...' : 'Request a demo \u2192'}
              </button>

              {error && (
                <p style={{
                  color: '#FF4B6E',
                  fontSize: '0.8rem',
                  margin: 0,
                  textAlign: 'center',
                }}>
                  {error}
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* Reusable form field sub-component */
function Field({
  label, type, placeholder, value, onChange, required,
}: {
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        display: 'block',
        fontFamily: "var(--font-mono), 'DM Mono', monospace",
        fontSize: '0.625rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)',
        marginBottom: 4,
      }}>
        {label}
      </span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '0.75rem 1rem',
          color: '#F5F4FF',
          fontFamily: "var(--font-exo2), 'Exo 2', sans-serif",
          fontSize: '0.9375rem',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(0,180,216,0.6)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
      />
    </label>
  );
}
