const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const KnowledgeEntrySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["qa", "url", "text", "file"], default: "qa" },
    question: { type: String }, // for Q&A pairs
    answer: { type: String }, // for Q&A pairs
    content: { type: String }, // for scraped/text content
    url: { type: String }, // source URL
    fileUrl: { type: String }, // S3 URL for uploaded files
    fileName: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const BotSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    botId: {
      type: String,
      default: () => `wsp_${uuidv4().replace(/-/g, "").slice(0, 16)}`,
      unique: true,
    },

    // ── Identity ──────────────────────────────────────────────────────────────
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    avatarEmoji: { type: String, default: "🤖" },
    welcomeMessage: {
      type: String,
      default: "Hi! 👋 How can I help you today?",
      maxlength: 200,
    },
    fallbackMessage: {
      type: String,
      default:
        "I'm not sure about that. Would you like me to connect you with a human?",
      maxlength: 200,
    },

    // ── Business context ──────────────────────────────────────────────────────
    businessName: { type: String, trim: true },
    businessType: { type: String, trim: true },
    businessHours: { type: String, trim: true },
    businessPhone: { type: String, trim: true },
    businessEmail: { type: String, trim: true },
    businessAddress: { type: String, trim: true },
    systemPrompt: { type: String, maxlength: 3000 }, // custom AI instructions

    // ── Knowledge base ────────────────────────────────────────────────────────
    knowledge: [KnowledgeEntrySchema],

    // ── Appearance ────────────────────────────────────────────────────────────
    theme: {
      primaryColor: { type: String, default: "#1a9e5c" },
      position: {
        type: String,
        enum: ["bottom-right", "bottom-left"],
        default: "bottom-right",
      },
      launcherText: { type: String, default: "Chat with us" },
      showBotAvatar: { type: Boolean, default: true },
      showBranding: { type: Boolean, default: true }, // "Powered by Wispy"
    },

    // ── Lead capture settings ─────────────────────────────────────────────────
    leadCapture: {
      enabled: { type: Boolean, default: true },
      askName: { type: Boolean, default: true },
      askEmail: { type: Boolean, default: true },
      askPhone: { type: Boolean, default: false },
      triggerAfter: { type: Number, default: 2 }, // messages before asking
      message: {
        type: String,
        default: "Could I get your name and email to follow up?",
      },
    },

    // ── Allowed domains ───────────────────────────────────────────────────────
    allowedDomains: [{ type: String }], // e.g. ['example.com', 'www.example.com']

    // ── AI settings ───────────────────────────────────────────────────────────
    aiModel: { type: String, default: "gpt-4o" },
    temperature: { type: Number, default: 0.7, min: 0, max: 1 },
    maxTokens: { type: Number, default: 300 },
    language: { type: String, default: "en" },

    // ── Stats ─────────────────────────────────────────────────────────────────
    stats: {
      totalConversations: { type: Number, default: 0 },
      totalMessages: { type: Number, default: 0 },
      totalLeads: { type: Number, default: 0 },
      avgResponseTime: { type: Number, default: 0 }, // ms
      satisfactionScore: { type: Number, default: 0 },
    },

    // ── Status ────────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    isLive: { type: Boolean, default: false }, // deployed on at least one domain
    lastTrainedAt: { type: Date },
  },
  { timestamps: true },
);

BotSchema.index({ user: 1, isDeleted: 1 });
BotSchema.index({ botId: 1 });

// Build system prompt from knowledge base + business context
BotSchema.methods.buildSystemPrompt = function () {
  const lines = [];

  lines.push(
    `You are ${this.name}, an AI assistant for ${this.businessName || "this business"}.`,
  );
  lines.push(`Your personality: helpful, friendly, professional, and concise.`);
  lines.push(
    `Always respond in ${this.language === "en" ? "English" : this.language}.`,
  );
  lines.push(
    `Keep responses short and direct — max 3 sentences unless a detailed answer is needed.`,
  );
  lines.push(
    `Never make up information. If you don't know, say so and offer to connect them with a human.`,
  );

  if (this.businessType) lines.push(`Business type: ${this.businessType}`);
  if (this.businessHours) lines.push(`Hours: ${this.businessHours}`);
  if (this.businessPhone) lines.push(`Phone: ${this.businessPhone}`);
  if (this.businessEmail) lines.push(`Email: ${this.businessEmail}`);
  if (this.businessAddress) lines.push(`Address: ${this.businessAddress}`);

  if (this.systemPrompt) {
    lines.push(`\nAdditional instructions:\n${this.systemPrompt}`);
  }

  // Inject Q&A knowledge
  const qaEntries = this.knowledge.filter(
    (k) => k.type === "qa" && k.isActive && k.question && k.answer,
  );
  if (qaEntries.length > 0) {
    lines.push("\nKnowledge base (use these to answer accurately):");
    qaEntries.forEach((e) => {
      lines.push(`Q: ${e.question}\nA: ${e.answer}`);
    });
  }

  // Inject text/URL knowledge
  const textEntries = this.knowledge.filter(
    (k) => ["text", "url"].includes(k.type) && k.isActive && k.content,
  );
  if (textEntries.length > 0) {
    lines.push("\nAdditional context:");
    textEntries.forEach((e) => {
      lines.push(e.content.substring(0, 3000)); // limit per entry
    });
  }

  lines.push(
    `\nIf asked to capture contact info, collect it naturally in conversation.`,
  );
  lines.push(
    `Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
  );

  return lines.join("\n");
};

module.exports = mongoose.model("Bot", BotSchema);
