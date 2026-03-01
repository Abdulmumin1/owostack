import { Resend } from "resend";
import { json } from "@sveltejs/kit";


export async function POST({ request }) {
  try {
    const { email } = await request.json();
const resend = new Resend(process.env.RESEND_API_KEY);

    if (!email) {
      return json({ error: "Email is required" }, { status: 400 });
    }

    const { data, error } = await resend.emails.send({
      from: "Owostack <join@mail.owostack.com>",
      to: ["abdulmuminyqn@gmail.com"],
      subject: "New Waitlist Join Request",
      html: `
        <div style="background-color: #fafaf5; padding: 48px 24px; font-family: 'Outfit', 'DM Sans', system-ui, sans-serif; color: #1a1a1a;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 32px; border: 1px solid #e0d9cc; border-radius: 12px; box-shadow: 6px 6px 0 0 #e0d9cc;">
            <div style="margin-bottom: 24px;">
              <span style="font-size: 10px; font-weight: 700; color: #e8a855; text-transform: uppercase; letter-spacing: 2px;">Owostack Waitlist</span>
            </div>
            
            <h1 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: -0.5px;">New Invite Request</h1>
            <p style="font-size: 14px; color: #3d3d3d; line-height: 1.6; margin-bottom: 32px;">A new user has requested to join the Owostack private beta. Here are their details:</p>
            
            <div style="background-color: #f3f0e8; border: 1px solid #e0d9cc; border-radius: 4px; padding: 20px;">
              <p style="margin: 0; font-size: 10px; color: #8b8b8b; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;">User Email</p>
              <p style="margin: 0; font-size: 18px; color: #1a1a1a; font-weight: 700;">${email}</p>
            </div>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error("[WAITLIST] Resend Error:", error);
      return json(
        { error: error.message || "Failed to send notification" },
        { status: 500 },
      );
    }

    return json({ success: true, data });
  } catch (error: any) {
    console.error("[WAITLIST] Server Error:", error);
    return json(
      { error: error.message || "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
