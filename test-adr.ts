import "dotenv/config";
import { createAdr } from "./src/lib/api/decyra.functions";
import { pgQuery } from "./src/integrations/database/local-auth.server"; // Wait, I can't easily run TanStack Server Functions directly.
