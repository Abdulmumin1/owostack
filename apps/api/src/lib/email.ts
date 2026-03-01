import { Resend } from "resend";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Send an email via Resend.
 */
export async function sendEmail(
  env: { RESEND_API_KEY?: string },
  options: SendEmailOptions,
): Promise<void> {
  const { to, subject, html, text, from } = options;
  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn(`[EMAIL-MISSING-API-KEY] to=${to}, subject="${subject}"`);
    console.log(`[EMAIL-BODY-PREVIEW] ${text?.slice(0, 500) || "(html only)"}`);
    return;
  }

  const resend = new Resend(apiKey);
  const sender = from || "Owostack <no-reply@mail.owostack.com>";

  try {
    const { data, error } = await resend.emails.send({
      from: sender,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>?/gm, ""), // simple fallback
    });

    if (error) {
      console.error(`[RESEND-ERROR]`, error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    console.log(`[RESEND-SUCCESS] ID: ${data?.id}`);
  } catch (err) {
    console.error(`[EMAIL-FAILURE]`, err);
    // We don't necessarily want to crash the whole request if email fails,
    // but better to throw so the caller knows.
    throw err;
  }
}

/**
 * Send a checkout activation email to a customer.
 * This is used when a pending subscription needs payment.
 */
export async function sendCheckoutEmail(
  env: { RESEND_API_KEY?: string },
  options: {
    to: string;
    customerName?: string;
    planName: string;
    checkoutUrl: string;
    amount?: number;
    currency?: string;
    organizationName: string;
    organizationLogo?: string;
  },
): Promise<void> {
  const {
    to,
    customerName,
    planName,
    checkoutUrl,
    amount,
    currency,
    organizationName,
    organizationLogo,
  } = options;
  const displayName = customerName || to;
  const priceStr =
    amount && currency
      ? ` for ${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
      : "";

  await sendEmail(env, {
    to,
    subject: `Complete your subscription to ${planName}`,
    text: `Hi ${displayName},\n\nYou've been subscribed to the ${planName} plan${priceStr} by ${organizationName}. To activate your subscription, please complete the checkout:\n\n${checkoutUrl}\n\nThis link will take you to a secure payment page.\n\nThanks!`,
    html: `
      <div style="background-color: #fafaf5; padding: 48px 24px; font-family: 'Outfit', 'DM Sans', system-ui, sans-serif; color: #1a1a1a;">
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px; border: 1px solid #e0d9cc; border-radius: 12px; box-shadow: 6px 6px 0 0 #e0d9cc;">          
          <h2 style="font-size: 20px; margin: 0 0 16px 0; font-weight: 700; color: #1a1a1a;">Complete Your Subscription</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #3d3d3d; margin-bottom: 24px;">
            Hi ${displayName},<br><br>
            You've been subscribed to the <strong>${planName}</strong> plan${priceStr} from <strong>${organizationName}</strong>. 
            To activate your subscription and start using their services, please complete the secure checkout below.
          </p>
          
          <a href="${checkoutUrl}" style="display: inline-block; background-color: #e8a855; color: #1a1a1a; padding: 12px 24px; border: 1px solid #c07515; border-radius: 4px; text-decoration: none; font-weight: 700; font-size: 14px; box-shadow: 0 4px 0 0 #c07515;">
            Complete Checkout →
          </a>
          
          <div style="font-size: 12px; color: #8b8b8b; margin-top: 32px; border-top: 1px solid #ede9df; padding-top: 16px;">
            <p style="margin: 0 0 8px 0;">This secure checkout is processed for <strong>${organizationName}</strong>.</p>
            <p style="margin: 0;">If you didn't expect this, you can safely ignore this email.</p>
          </div>
        </div>
      </div>
    `.trim(),
  });
}
