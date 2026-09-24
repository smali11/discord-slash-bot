// Vercel serverless entrypoint. Vercel invokes the default-exported Express app
// as the request handler; vercel.json rewrites every path here.
import { app } from '../src/app.js';

export default app;
