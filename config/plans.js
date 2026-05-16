/**
 * Wispy Plan Configuration
 * Referenced by billingController, User model, and frontend pricing page.
 */

const PLANS = {
  trial: {
    name: "Free Trial",
    price: 0,
    maxBots: 1,
    maxConversationsPerMonth: 100,
    maxLeadsPerMonth: 50,
    maxKnowledgeEntries: 20,
    features: {
      urlScraping: false,
      fileUpload: false,
      customDomains: true,
      analytics: true,
      leadExport: false,
      removeBranding: false,
      prioritySupport: false,
      apiAccess: false,
      webhooks: false,
      multipleLanguages: false,
    },
  },

  starter: {
    name: "Starter",
    price: 99,
    maxBots: 3,
    maxConversationsPerMonth: 2000,
    maxLeadsPerMonth: 500,
    maxKnowledgeEntries: 100,
    features: {
      urlScraping: false,
      fileUpload: false,
      customDomains: true,
      analytics: true,
      leadExport: true,
      removeBranding: false,
      prioritySupport: false,
      apiAccess: false,
      webhooks: false,
      multipleLanguages: true,
    },
  },

  business: {
    name: "Business",
    price: 149,
    maxBots: 10,
    maxConversationsPerMonth: 10000,
    maxLeadsPerMonth: 2000,
    maxKnowledgeEntries: 200,
    features: {
      urlScraping: true,
      fileUpload: true,
      customDomains: true,
      analytics: true,
      leadExport: true,
      removeBranding: true,
      prioritySupport: false,
      apiAccess: true,
      webhooks: true,
      multipleLanguages: true,
    },
  },

  premium: {
    name: "Premium",
    price: 249,
    maxBots: null,              // null = Unlimited
    maxConversationsPerMonth: null,
    maxLeadsPerMonth: null,
    maxKnowledgeEntries: null,
    features: {
      urlScraping: true,
      fileUpload: true,
      customDomains: true,
      analytics: true,
      leadExport: true,
      removeBranding: true,
      prioritySupport: true,
      apiAccess: true,
      webhooks: true,
      multipleLanguages: true,
    },
  },
};

module.exports = PLANS;
