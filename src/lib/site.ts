/** Public-facing details shown on the landing, legal and billing pages. */
export const site = {
  name: "BizFlow",
  get url() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  get supportEmail() {
    return process.env.SUPPORT_EMAIL || "support@example.com";
  },
  /** Legal entity named in the terms and privacy policy. */
  get company() {
    return process.env.LEGAL_ENTITY_NAME || "BizFlow";
  },
};
