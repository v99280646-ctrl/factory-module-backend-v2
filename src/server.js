import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
async function main() {
    await connectDb();
    const app = createApp();
    app.listen(env.port, () => {
        console.log(`API running on http://localhost:${env.port}`);
    });
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
