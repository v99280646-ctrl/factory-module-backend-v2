import dotenv from "dotenv";
dotenv.config();
export const env = {
    port: Number(process.env.PORT || 4000),
    mongoUri: process.env.MONGODB_URI || "",
    jwtSecret: process.env.JWT_SECRET || "",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    adminEmails: (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    nodeEnv: process.env.NODE_ENV || "development",
    brevoApiKey: process.env.BREVO_API_KEY || "",
    brevoDefaultSenderId: process.env.BREVO_DEFAULT_SENDER_ID || "",
    brevoSenderEmail: process.env.BREVO_SENDER_EMAIL || "",
    brevoSenderName: process.env.BREVO_SENDER_NAME || "",
    gupshupApiKey: process.env.GUPSHUP_API_KEY || "",
    gupshupSource: process.env.GUPSHUP_SOURCE || "",
    gupshupSrcName: process.env.GUPSHUP_SRC_NAME || "",
    gupshupCountryCode: process.env.GUPSHUP_COUNTRY_CODE || "+91",
};
