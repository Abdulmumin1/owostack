const { Resend } = require("resend");

const email = process.argv[2];
const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.error("Error: RESEND_API_KEY required");
  process.exit(1);
}

if (!email || !email.includes("@")) {
  console.error("Error: valid email required");
  process.exit(1);
}

const resend = new Resend(apiKey);

resend.emails
  .send({
    from: "Owostack <no-reply@mail.owostack.com>",
    to: email,
    subject: "Welcome to Owostack beta",
    html: `
    <div style="background:#fafaf5;padding:48px 24px;font-family:system-ui,sans-serif;color:#1a1a1a;">
      <div style="max-width:480px;margin:0 auto;background:#fff;padding:32px;border:1px solid #e0d9cc;border-radius:12px;box-shadow:6px 6px 0 0 #e0d9cc;">
        <p>Hey,</p>
        <p>Thanks for joining Owostack beta!</p>
        <p>
          <a href="https://app.owostack.com/join/0e4eb93e-2800-4da3-a5d0-d37bfae7005f" style="display:inline-block;background:#e8a855;color:#1a1a1a;padding:12px 24px;border:1px solid #c07515;border-radius:4px;text-decoration:none;font-weight:700;">
            Get started
          </a>
        </p>
        <p style="color:#3d3d3d;margin-top:24px;">
          Feel free to join our Discord community if you want to hang out or ask questions.
        </p>
        <p>
          <a href="https://discord.gg/JMXr4EKmtf" style="color:#c07515;text-decoration:underline;">
            Join Discord
          </a>
        </p>
      </div>
    </div>
  `,
    text: "Hey,\n\nThanks for joining Owostack beta!\n\nGet started: https://app.owostack.com/join/0e4eb93e-2800-4da3-a5d0-d37bfae7005f\n\nFeel free to join our Discord community if you want to hang out or ask questions:\nhttps://discord.gg/JMXr4EKmtf",
  })
  .then(({ data, error }) => {
    if (error) {
      console.error("Failed:", error);
      process.exit(1);
    }
    console.log("Sent to", email);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
