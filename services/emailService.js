const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// ── OTP verification email ────────────────────────────────────────────────────
exports.sendVerificationEmail = async (user, otp) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM || "Wispy <noreply@wispyaii.com>",
    to: user.email,
    subject: `${otp} — Verify your Wispy account`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#fafaf8;padding:40px 32px;border-radius:12px;">
        <div style="font-size:24px;font-weight:800;margin-bottom:8px;">💬 Wispy</div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;color:#0f0f0d;">Verify your email</h2>
        <p style="color:#3a3a35;line-height:1.6;margin-bottom:24px;">Hi ${user.name}, use the code below to verify your Wispy account. It expires in 10 minutes.</p>
        <div style="background:#fff;border:1px solid #e2e2da;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#1a9e5c;">${otp}</div>
        </div>
        <p style="color:#8a8a82;font-size:13px;">If you didn't create a Wispy account, you can safely ignore this email.</p>
      </div>
    `,
  });
};

// ── Password reset email ──────────────────────────────────────────────────────
exports.sendPasswordResetEmail = async (user, resetUrl) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM || "Wispy <noreply@wispyaii.com>",
    to: user.email,
    subject: "Reset your Wispy password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#fafaf8;padding:40px 32px;border-radius:12px;">
        <div style="font-size:24px;font-weight:800;margin-bottom:8px;">💬 Wispy</div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;">Reset your password</h2>
        <p style="color:#3a3a35;line-height:1.6;margin-bottom:24px;">Hi ${user.name}, click the button below to reset your password. This link expires in 30 minutes.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#1a9e5c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin-bottom:24px;">Reset password</a>
        <p style="color:#8a8a82;font-size:13px;">If you didn't request this, ignore this email. Your password won't change.</p>
      </div>
    `,
  });
};

// ── Welcome email ─────────────────────────────────────────────────────────────
exports.sendWelcomeEmail = async (user) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM || "Wispy <noreply@wispyaii.com>",
    to: user.email,
    subject: "Welcome to Wispy — let's build your first chatbot",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#fafaf8;padding:40px 32px;border-radius:12px;">
        <div style="font-size:24px;font-weight:800;margin-bottom:8px;">💬 Wispy</div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;">Welcome, ${user.name}! 🎉</h2>
        <p style="color:#3a3a35;line-height:1.6;margin-bottom:16px;">Your 14-day free trial has started. Here's how to get your chatbot live in the next 5 minutes:</p>
        <ol style="color:#3a3a35;line-height:2;padding-left:20px;margin-bottom:24px;">
          <li>Create your first bot in the dashboard</li>
          <li>Add your business info and Q&As</li>
          <li>Copy the embed code</li>
          <li>Paste it on your website</li>
        </ol>
        <a href="${process.env.CLIENT_URL}/dashboard" style="display:inline-block;background:#1a9e5c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Go to dashboard →</a>
      </div>
    `,
  });
};

// ── New lead notification ─────────────────────────────────────────────────────
exports.sendLeadNotification = async (ownerEmail, lead, botName) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM || "Wispy <noreply@wispyaii.com>",
    to: ownerEmail,
    subject: `🎯 New lead from ${botName}${lead.name ? ` — ${lead.name}` : ""}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#fafaf8;padding:40px 32px;border-radius:12px;">
        <div style="font-size:24px;font-weight:800;margin-bottom:8px;">💬 Wispy</div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;color:#1a9e5c;">New lead captured!</h2>
        <p style="color:#3a3a35;margin-bottom:20px;">Your chatbot <strong>${botName}</strong> just captured a new lead:</p>
        <div style="background:#fff;border:1px solid #e2e2da;border-radius:10px;padding:20px;margin-bottom:24px;">
          ${lead.name ? `<p style="margin:0 0 8px;"><strong>Name:</strong> ${lead.name}</p>` : ""}
          ${lead.email ? `<p style="margin:0 0 8px;"><strong>Email:</strong> <a href="mailto:${lead.email}">${lead.email}</a></p>` : ""}
          ${lead.phone ? `<p style="margin:0 0 8px;"><strong>Phone:</strong> ${lead.phone}</p>` : ""}
          ${lead.topic ? `<p style="margin:0;"><strong>Interested in:</strong> ${lead.topic}</p>` : ""}
        </div>
        <a href="${process.env.CLIENT_URL}/dashboard/leads" style="display:inline-block;background:#1a9e5c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">View all leads →</a>
      </div>
    `,
  });
};

// ── Subscription confirmation ─────────────────────────────────────────────────
exports.sendSubscriptionEmail = async (user, planName, amount) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM || "Wispy <noreply@wispyaii.com>",
    to: user.email,
    subject: `✅ You're now on the Wispy ${planName} plan`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#fafaf8;padding:40px 32px;border-radius:12px;">
        <div style="font-size:24px;font-weight:800;margin-bottom:8px;">💬 Wispy</div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;">Subscription confirmed 🎉</h2>
        <p style="color:#3a3a35;line-height:1.6;margin-bottom:20px;">Hi ${user.name}, your <strong>${planName}</strong> plan is now active. You'll be charged $${amount}/month.</p>
        <a href="${process.env.CLIENT_URL}/dashboard" style="display:inline-block;background:#1a9e5c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Go to dashboard →</a>
      </div>
    `,
  });
};
