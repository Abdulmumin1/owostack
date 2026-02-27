/**
 * Email helper — placeholder for sending transactional emails.
 *
 * Currently logs to console. Replace with a real email provider
 * (Resend, Postmark, SES, etc.) when ready.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Send an email. Currently a no-op that logs to console.
 * Replace with real provider integration when ready.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  console.log(
    `[EMAIL] Would send email to=${options.to}, subject="${options.subject}"`,
  );
  console.log(
    `[EMAIL] Body preview: ${options.text?.slice(0, 500) || "(html only)"}`,
  );
  // TODO: Integrate with an email provider (Resend, Postmark, etc.)
}

/**
 * Send a checkout activation email to a customer.
 * This is used when a pending subscription needs payment.
 */
export async function sendCheckoutEmail(options: {
  to: string;
  customerName?: string;
  planName: string;
  checkoutUrl: string;
  amount?: number;
  currency?: string;
}): Promise<void> {
  const { to, customerName, planName, checkoutUrl, amount, currency } = options;
  const displayName = customerName || to;
  const priceStr =
    amount && currency
      ? ` for ${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
      : "";

  await sendEmail({
    to,
    subject: `Complete your subscription to ${planName}`,
    text: `Hi ${displayName},\n\nYou've been subscribed to the ${planName} plan${priceStr}. To activate your subscription, please complete the checkout:\n\n${checkoutUrl}\n\nThis link will take you to a secure payment page.\n\nThanks!`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="font-size: 18px; margin-bottom: 8px;">Complete Your Subscription</h2>
        <p>Hi ${displayName},</p>
        <p>You've been subscribed to the <strong>${planName}</strong> plan${priceStr}.</p>
        <p>To activate your subscription, please complete the checkout:</p>
        <a href="${checkoutUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0;">
          Complete Payment →
        </a>
        <p style="font-size: 12px; color: #888;">This link will take you to a secure payment page.</p>
      </div>
    `.trim(),
  });
}
