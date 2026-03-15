import { Resend } from 'resend';
import { NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  const { name, email, brand, website } = await req.json();

  if (!email || !brand) {
    return NextResponse.json(
      { error: 'Email and brand name are required' },
      { status: 400 }
    );
  }

  await resend.emails.send({
    from: 'Shadovi Demo Requests <onboarding@resend.dev>',
    to: 'yazararme@gmail.com',
    subject: `Demo request — ${brand}`,
    html: `
      <h2>New demo request</h2>
      <p><strong>Name:</strong> ${name || '—'}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Brand:</strong> ${brand}</p>
      <p><strong>Website:</strong> ${website || '—'}</p>
    `,
  });

  return NextResponse.json({ success: true });
}
