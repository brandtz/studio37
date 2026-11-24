// Initial-password links go only to the account's own address, never notify/BCC lists.
// Uses RESEND_API_KEY and optional RESEND_FROM. No fallback delivery or token logging.
// Keep Resend click/open tracking disabled for authentication emails.
import { Resend } from 'resend';

export async function sendPasswordSetupEmail(email, token) {
  if (!process.env.RESEND_API_KEY) return false;
  // Do not derive this origin from request Host, forwarded headers, or body input.
  // A fragment avoids sending the credential in HTTP URLs, referrers, or access logs.
  const link = `https://studio37customdesigns.com/admin#setup=${encodeURIComponent(token)}`;
  try {
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM || 'Studio 37 Custom Designs <orders@studio37customdesigns.com>',
      to: [email],
      subject: 'Set up your Studio 37 admin password',
      text: `An initial password setup was requested for your approved Studio 37 admin account.\n\nOpen this link to choose your password:\n${link}\n\nThis link expires in 15 minutes. Only the newest link works. If you did not request it, ignore this email. Do not forward or share this link.`,
    });
    return !!result?.data?.id && !result.error;
  } catch {
    return false;
  }
}
